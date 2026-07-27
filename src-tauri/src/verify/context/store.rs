// SPDX-License-Identifier: GPL-3.0-or-later
//! Tauri managed state for the symbol index (design §3.7).
//!
//! **Deliberate deviation from `CLAUDE.md`.** The project rule is "no long-lived
//! per-repository state; every command opens its own `git2::Repository`". That
//! rule still holds for git handles — but incremental indexing is *by
//! definition* state carried between calls, so the parsed index lives here.
//! The residency cap is two repositories (the active one and the one before it)
//! with LRU eviction, and durability is the disk snapshot's job, not this
//! struct's.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};

use super::build::BuildOutcome;
use super::cancel::CancelToken;
use super::index::RepoIndex;

/// At most the active repository plus the previous one.
const MAX_RESIDENT_REPOS: usize = 2;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IndexState {
    Idle,
    Building,
    Ready,
    Cancelled,
    Failed,
}

/// What the frontend needs to render an honest progress/coverage line.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SymbolIndexStatus {
    pub state: IndexState,
    pub files_indexed: usize,
    pub files_total: usize,
    pub symbols: usize,
    pub complete: bool,
    /// Epoch milliseconds.
    pub built_at: Option<i64>,
    /// Extension → count of files outside the language scope (§7-⑤).
    pub skipped_by_language: Vec<(String, usize)>,
    pub skipped_by_budget: usize,
    /// Files that parsed with an ERROR node. A high ratio means the grammar is
    /// behind the language, not that the code is broken.
    pub parse_failed: usize,
}

impl SymbolIndexStatus {
    pub fn idle() -> Self {
        Self {
            state: IndexState::Idle,
            files_indexed: 0,
            files_total: 0,
            symbols: 0,
            complete: false,
            built_at: None,
            skipped_by_language: Vec::new(),
            skipped_by_budget: 0,
            parse_failed: 0,
        }
    }

    fn from_index(state: IndexState, index: &RepoIndex) -> Self {
        Self {
            state,
            files_indexed: index.file_count(),
            files_total: index.files_total.max(index.file_count()),
            symbols: index.symbol_count(),
            complete: index.complete,
            built_at: index.built_at,
            skipped_by_language: index
                .skipped_by_language
                .iter()
                .map(|(ext, count)| (ext.clone(), *count))
                .collect(),
            skipped_by_budget: index.skipped_by_budget,
            parse_failed: index.parse_failed,
        }
    }
}

fn replace_index(handle: &RwLock<RepoIndex>, next: RepoIndex) {
    match handle.write() {
        Ok(mut index) => *index = next,
        Err(e) => tracing::warn!("[verify] symbol index lock poisoned: {}", e),
    }
}

struct Entry {
    path: PathBuf,
    index: Arc<RwLock<RepoIndex>>,
    cancel: CancelToken,
    state: IndexState,
}

#[derive(Default)]
pub struct SymbolIndexStore {
    entries: Mutex<VecDeque<Entry>>,
}

impl SymbolIndexStore {
    /// A snapshot handle for the rules to read. `None` when nothing has been
    /// built for this repository — which the rules must treat as "unchecked",
    /// never as "clean".
    pub fn index_of(&self, repo_path: &Path) -> Option<Arc<RwLock<RepoIndex>>> {
        let mut entries = self.entries.lock().ok()?;
        let position = entries.iter().position(|entry| entry.path == repo_path)?;
        let index = entries[position].index.clone();
        // Touch for LRU.
        if let Some(entry) = entries.remove(position) {
            entries.push_front(entry);
        }
        Some(index)
    }

    pub fn status(&self, repo_path: &Path) -> SymbolIndexStatus {
        let Ok(entries) = self.entries.lock() else {
            return SymbolIndexStatus::idle();
        };
        let Some(entry) = entries.iter().find(|entry| entry.path == repo_path) else {
            return SymbolIndexStatus::idle();
        };
        let Ok(index) = entry.index.read() else {
            return SymbolIndexStatus::idle();
        };
        SymbolIndexStatus::from_index(entry.state, &index)
    }

    /// Claim the build slot. `None` means a build is already running for this
    /// repository and the caller must not start a second one.
    ///
    /// Any build for a *different* repository is cancelled: only one repository
    /// is active at a time, and the user is looking at this one.
    pub fn begin(&self, repo_path: &Path, seed: Option<RepoIndex>) -> Option<CancelToken> {
        let mut entries = self.entries.lock().ok()?;
        for entry in entries.iter_mut() {
            if entry.path != repo_path && entry.state == IndexState::Building {
                entry.cancel.cancel();
            }
        }

        if let Some(entry) = entries.iter_mut().find(|entry| entry.path == repo_path) {
            if entry.state == IndexState::Building {
                return None;
            }
            entry.state = IndexState::Building;
            entry.cancel = CancelToken::new();
            return Some(entry.cancel.clone());
        }

        let cancel = CancelToken::new();
        entries.push_front(Entry {
            path: repo_path.to_path_buf(),
            index: Arc::new(RwLock::new(seed.unwrap_or_default())),
            cancel: cancel.clone(),
            state: IndexState::Building,
        });
        while entries.len() > MAX_RESIDENT_REPOS {
            if let Some(evicted) = entries.pop_back() {
                evicted.cancel.cancel();
            }
        }
        Some(cancel)
    }

    /// Install a finished build. A cancelled build still installs its partial
    /// index — discarding it would make cancelling worse than waiting.
    pub fn finish(&self, repo_path: &Path, outcome: BuildOutcome) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        let Some(entry) = entries.iter_mut().find(|entry| entry.path == repo_path) else {
            return;
        };
        entry.state = if outcome.cancelled {
            IndexState::Cancelled
        } else {
            IndexState::Ready
        };
        let handle = entry.index.clone();
        drop(entries);
        replace_index(&handle, outcome.index);
    }

    pub fn fail(&self, repo_path: &Path) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(entry) = entries.iter_mut().find(|entry| entry.path == repo_path) {
                entry.state = IndexState::Failed;
            }
        }
    }

    /// Ask a running build to stop. Returns the status after the request; the
    /// build itself finishes asynchronously.
    pub fn cancel(&self, repo_path: &Path) -> SymbolIndexStatus {
        if let Ok(entries) = self.entries.lock() {
            if let Some(entry) = entries.iter().find(|entry| entry.path == repo_path) {
                entry.cancel.cancel();
            }
        }
        self.status(repo_path)
    }

    /// A read-only copy for a rule scan. Cloning is what keeps the rules free of
    /// lock lifetimes; the cost is bounded by the residency cap.
    pub fn snapshot(&self, repo_path: &Path) -> Option<RepoIndex> {
        let handle = self.index_of(repo_path)?;
        let guard = handle.read().ok()?;
        Some(guard.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::index::fixture::index_from_sources;
    use std::collections::BTreeSet;

    fn outcome(index: RepoIndex, cancelled: bool) -> BuildOutcome {
        BuildOutcome {
            index,
            cancelled,
            parsed: 0,
            reused: 0,
            dirty: BTreeSet::new(),
        }
    }

    fn sample() -> RepoIndex {
        index_from_sources(&[("src/a.ts", "export function alpha() {}")])
    }

    #[test]
    fn an_unknown_repository_reports_idle() {
        let store = SymbolIndexStore::default();
        let status = store.status(Path::new("/nope"));
        assert_eq!(status.state, IndexState::Idle);
        assert!(!status.complete);
        assert!(store.index_of(Path::new("/nope")).is_none());
    }

    #[test]
    fn a_finished_build_becomes_readable() {
        let store = SymbolIndexStore::default();
        let repo = Path::new("/repo/a");
        assert!(store.begin(repo, None).is_some());
        assert_eq!(store.status(repo).state, IndexState::Building);

        store.finish(repo, outcome(sample(), false));
        let status = store.status(repo);
        assert_eq!(status.state, IndexState::Ready);
        assert_eq!(status.files_indexed, 1);
        assert_eq!(store.snapshot(repo).expect("snapshot").symbol_count(), 1);
    }

    #[test]
    fn a_second_build_for_the_same_repository_is_refused() {
        let store = SymbolIndexStore::default();
        let repo = Path::new("/repo/a");
        assert!(store.begin(repo, None).is_some());
        assert!(
            store.begin(repo, None).is_none(),
            "a running build must not be duplicated"
        );
    }

    #[test]
    fn switching_repositories_cancels_the_previous_build() {
        let store = SymbolIndexStore::default();
        let first = store.begin(Path::new("/repo/a"), None).expect("first");
        let _second = store.begin(Path::new("/repo/b"), None).expect("second");
        assert!(first.is_cancelled(), "the inactive build was cancelled");
    }

    #[test]
    fn a_cancelled_build_keeps_its_partial_index() {
        let store = SymbolIndexStore::default();
        let repo = Path::new("/repo/a");
        store.begin(repo, None).expect("begin");

        let mut partial = sample();
        partial.complete = false;
        store.finish(repo, outcome(partial, true));

        let status = store.status(repo);
        assert_eq!(status.state, IndexState::Cancelled);
        assert!(!status.complete);
        assert_eq!(status.files_indexed, 1, "partial work is kept");
    }

    #[test]
    fn residency_is_capped_at_two_repositories() {
        let store = SymbolIndexStore::default();
        for repo in ["/repo/a", "/repo/b", "/repo/c"] {
            let path = Path::new(repo);
            store.begin(path, None).expect("begin");
            store.finish(path, outcome(sample(), false));
        }
        assert!(store.index_of(Path::new("/repo/a")).is_none(), "LRU evicted");
        assert!(store.index_of(Path::new("/repo/b")).is_some());
        assert!(store.index_of(Path::new("/repo/c")).is_some());
    }
}
