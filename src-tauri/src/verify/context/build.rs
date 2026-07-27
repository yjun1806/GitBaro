// SPDX-License-Identifier: GPL-3.0-or-later
//! Building and refreshing the symbol index (design §2.2 · §3.3 · §3.5).
//!
//! Three things make this safe to run against a large repository:
//!
//! - **git enumerates the files, not `read_dir`.** The index plus the untracked
//!   statuses is exactly the set of files the user considers theirs, so
//!   `node_modules/`, `target/` and `dist/` disappear for free because they are
//!   already ignored. This is the difference between a 195-file walk and a
//!   40 000-file one, and it is the reason no hand-maintained exclude list
//!   exists here.
//! - **Two-tier invalidation.** `(size, mtime)` is the probe; the git blob hash
//!   is the confirmation. A touched-but-unchanged file refreshes its stamp
//!   without being reparsed, and a same-millisecond same-size overwrite is
//!   still caught.
//! - **Cancellation before every file** plus a wall-clock budget. Both finish
//!   with a *partial* index and `complete: false` — never an `Err`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use git2::{ObjectType, Oid, Repository, StatusOptions};
use serde::Serialize;

use crate::error::AppError;
use crate::verify::types::now_millis;

use super::cancel::CancelToken;
use super::extract::{extract_file, FileIdentity};
use super::index::RepoIndex;
use super::lang::{extension_of_path, language_of_path};
use super::model::FileStamp;
use super::{
    MAX_INDEXED_FILES, MAX_INDEX_MILLIS, MAX_SOURCE_BYTES, PROGRESS_STEP_FILES,
    PROGRESS_THROTTLE_MILLIS,
};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IndexPhase {
    Enumerating,
    Parsing,
    Writing,
    Done,
    Cancelled,
}

/// Progress payload. The command layer forwards it verbatim as a Tauri event;
/// keeping it a plain struct is what lets this module be tested without one.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    pub repo_path: String,
    pub phase: IndexPhase,
    pub files_done: usize,
    pub files_total: usize,
    pub symbols: usize,
    pub running: bool,
}

#[derive(Debug)]
pub struct BuildOutcome {
    pub index: RepoIndex,
    /// True when a cancel or the wall-clock budget ended the build early.
    pub cancelled: bool,
    pub parsed: usize,
    pub reused: usize,
    /// Paths whose record changed — the cache rewrites only their shards.
    pub dirty: BTreeSet<String>,
}

/// Build or refresh the index. Blocking and CPU bound: the command layer must
/// call it inside `tokio::task::spawn_blocking`.
pub fn build_index(
    repo_path: &Path,
    previous: Option<RepoIndex>,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(IndexProgress),
) -> Result<BuildOutcome, AppError> {
    let started = Instant::now();
    let repo = Repository::open(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::Verify("a bare repository has no files to index".to_string()))?
        .to_path_buf();

    let mut reporter = Reporter::new(repo_path, progress);
    reporter.send(IndexPhase::Enumerating, 0, 0, 0, true);

    let candidates = enumerate(&repo)?;
    let previous = previous.unwrap_or_default();
    let mut next = RepoIndex {
        complete: true,
        built_at: Some(now_millis()),
        ..RepoIndex::default()
    };

    let mut supported: Vec<String> = Vec::new();
    for path in candidates {
        match language_of_path(&path) {
            Some(_) => supported.push(path),
            None => {
                *next
                    .skipped_by_language
                    .entry(extension_of_path(&path))
                    .or_insert(0) += 1;
            }
        }
    }
    if supported.len() > MAX_INDEXED_FILES {
        next.skipped_by_budget += supported.len() - MAX_INDEXED_FILES;
        next.complete = false;
        supported.truncate(MAX_INDEXED_FILES);
    }

    let files_total = supported.len();
    next.files_total = files_total;
    reporter.send(IndexPhase::Parsing, 0, files_total, 0, true);

    let mut outcome_stats = (0_usize, 0_usize); // (parsed, reused)
    let mut dirty: BTreeSet<String> = BTreeSet::new();
    let mut cancelled = false;

    for (done, path) in supported.into_iter().enumerate() {
        // Check point 1 of design §3.5 — the one that matters in practice.
        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }
        if started.elapsed().as_millis() as u64 > MAX_INDEX_MILLIS {
            tracing::warn!(
                "[verify] symbol index hit the {} ms budget after {} file(s)",
                MAX_INDEX_MILLIS,
                done
            );
            cancelled = true;
            break;
        }

        match index_one(&workdir, &path, &previous, &mut next) {
            FileOutcome::Parsed => {
                outcome_stats.0 += 1;
                dirty.insert(path);
            }
            FileOutcome::Reused { stamp_refreshed } => {
                outcome_stats.1 += 1;
                if stamp_refreshed {
                    dirty.insert(path);
                }
            }
            FileOutcome::Skipped => {
                next.skipped_by_budget += 1;
                dirty.insert(path);
            }
        }

        reporter.throttled(
            IndexPhase::Parsing,
            done + 1,
            files_total,
            next.symbol_count(),
        );
    }

    // Entries whose file disappeared must go, or V8 keeps resolving names
    // against code that no longer exists.
    for stale in previous
        .files()
        .map(|file| file.path.clone())
        .filter(|path| next.file(path).is_none())
    {
        dirty.insert(stale);
    }

    if cancelled {
        next.complete = false;
        next.built_at = previous.built_at.or(next.built_at);
    }

    let phase = if cancelled {
        IndexPhase::Cancelled
    } else {
        IndexPhase::Done
    };
    reporter.send(
        phase,
        next.file_count(),
        files_total,
        next.symbol_count(),
        false,
    );

    tracing::debug!(
        "[verify] symbol index for {:?}: {} file(s), {} symbol(s), {} parsed, {} reused, complete={}",
        repo_path,
        next.file_count(),
        next.symbol_count(),
        outcome_stats.0,
        outcome_stats.1,
        next.complete
    );

    Ok(BuildOutcome {
        index: next,
        cancelled,
        parsed: outcome_stats.0,
        reused: outcome_stats.1,
        dirty,
    })
}

enum FileOutcome {
    Parsed,
    Reused { stamp_refreshed: bool },
    Skipped,
}

fn index_one(
    workdir: &Path,
    path: &str,
    previous: &RepoIndex,
    next: &mut RepoIndex,
) -> FileOutcome {
    let absolute = workdir.join(path);
    let Ok(metadata) = std::fs::metadata(&absolute) else {
        return FileOutcome::Skipped; // staged-then-deleted, or a broken symlink
    };
    if !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES {
        return FileOutcome::Skipped;
    }
    let stamp = FileStamp {
        size: metadata.len(),
        mtime_ms: mtime_millis(&metadata),
    };

    let cached = previous.file(path);
    if let Some(cached) = cached {
        // Tier 1: identical stamp — the file is not even opened.
        if cached.stamp == stamp {
            next.insert(cached.clone());
            return FileOutcome::Reused {
                stamp_refreshed: false,
            };
        }
    }

    let content_id = match Oid::hash_file(ObjectType::Blob, &absolute) {
        Ok(oid) => oid.to_string(),
        Err(e) => {
            tracing::debug!("[verify] could not hash {:?}: {}", absolute, e);
            return FileOutcome::Skipped;
        }
    };

    // Tier 2: same bytes under a new stamp — refresh the stamp, do not reparse.
    if let Some(cached) = cached {
        if cached.content_id == content_id {
            let mut refreshed = cached.clone();
            refreshed.stamp = stamp;
            next.insert(refreshed);
            return FileOutcome::Reused {
                stamp_refreshed: true,
            };
        }
    }

    let Ok(source) = std::fs::read_to_string(&absolute) else {
        return FileOutcome::Skipped; // not UTF-8: not source we can parse
    };
    let Some(language) = language_of_path(path) else {
        return FileOutcome::Skipped;
    };
    let identity = FileIdentity {
        path: path.to_string(),
        content_id,
        stamp,
    };
    match extract_file(identity, &source, language) {
        Some(file) => {
            next.insert(file);
            FileOutcome::Parsed
        }
        None => FileOutcome::Skipped,
    }
}

fn mtime_millis(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as i64)
        .unwrap_or(0)
}

/// Tracked paths from the index (so staged new files are seen) plus untracked,
/// non-ignored paths from the status walk.
fn enumerate(repo: &Repository) -> Result<Vec<String>, AppError> {
    let mut paths: BTreeSet<String> = BTreeSet::new();

    for entry in repo.index()?.iter() {
        if let Ok(path) = String::from_utf8(entry.path.clone()) {
            paths.insert(path);
        }
    }

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false)
        .exclude_submodules(true);
    match repo.statuses(Some(&mut options)) {
        Ok(statuses) => {
            for entry in statuses.iter() {
                if entry.status().is_wt_deleted() || entry.status().is_index_deleted() {
                    if let Some(path) = entry.path() {
                        paths.remove(path);
                    }
                    continue;
                }
                if let Some(path) = entry.path() {
                    paths.insert(path.to_string());
                }
            }
        }
        Err(e) => tracing::warn!("[verify] status walk failed: {} — indexing tracked files only", e),
    }

    Ok(paths.into_iter().collect())
}

/// Throttled progress reporting. The first event, the last event and every
/// phase transition always go out; the rest are rate limited so the event
/// stream itself never becomes the bottleneck.
struct Reporter<'a> {
    repo_path: String,
    sink: &'a mut dyn FnMut(IndexProgress),
    last_sent: Option<Instant>,
    last_phase: Option<IndexPhase>,
}

impl<'a> Reporter<'a> {
    fn new(repo_path: &Path, sink: &'a mut dyn FnMut(IndexProgress)) -> Self {
        Self {
            repo_path: repo_path.to_string_lossy().to_string(),
            sink,
            last_sent: None,
            last_phase: None,
        }
    }

    fn send(
        &mut self,
        phase: IndexPhase,
        files_done: usize,
        files_total: usize,
        symbols: usize,
        running: bool,
    ) {
        (self.sink)(IndexProgress {
            repo_path: self.repo_path.clone(),
            phase,
            files_done,
            files_total,
            symbols,
            running,
        });
        self.last_sent = Some(Instant::now());
        self.last_phase = Some(phase);
    }

    fn throttled(
        &mut self,
        phase: IndexPhase,
        files_done: usize,
        files_total: usize,
        symbols: usize,
    ) {
        let due = match self.last_sent {
            Some(at) => at.elapsed().as_millis() as u64 >= PROGRESS_THROTTLE_MILLIS,
            None => true,
        };
        // The file step matters when parsing is *fast*: a repository of tiny
        // files would otherwise finish inside one throttle window and report
        // nothing between "starting" and "done".
        let stepped = files_done.is_multiple_of(PROGRESS_STEP_FILES);
        if due || stepped || self.last_phase != Some(phase) {
            self.send(phase, files_done, files_total, symbols, true);
        }
    }
}

/// Where the shard cache lives for `repo`. Worktree-local on purpose: the index
/// describes *this* checkout's file contents, and a linked worktree is looking
/// at a different branch.
pub fn cache_dir(repo: &Repository) -> Result<PathBuf, AppError> {
    Ok(crate::verify::paths::worktree_state_dir(repo)?.join("symbol-index"))
}

#[cfg(test)]
pub(crate) mod testutil {
    use std::path::{Path, PathBuf};

    /// A throwaway git repository with a working tree.
    pub struct TempRepo {
        pub path: PathBuf,
    }

    impl TempRepo {
        pub fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "gitbaro-ctx-{}-{}-{}",
                tag,
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp repo dir");
            git2::Repository::init(&path).expect("git init");
            Self { path }
        }

        pub fn write(&self, relative: &str, contents: &str) {
            let full = self.path.join(relative);
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).expect("create parent");
            }
            std::fs::write(full, contents).expect("write file");
        }

        pub fn remove(&self, relative: &str) {
            let _ = std::fs::remove_file(self.path.join(relative));
        }

        pub fn root(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::TempRepo;
    use super::*;

    fn build(repo: &TempRepo, previous: Option<RepoIndex>, cancel: &CancelToken) -> BuildOutcome {
        build_index(repo.root(), previous, cancel, &mut |_| {}).expect("build")
    }

    #[test]
    fn a_first_build_indexes_every_supported_file() {
        let repo = TempRepo::new("first");
        repo.write("src/a.ts", "export function alpha() { return 1; }\n");
        repo.write("src/b.rs", "pub fn beta() {}\n");
        repo.write("README.md", "# hi\n");

        let outcome = build(&repo, None, &CancelToken::new());
        assert!(outcome.index.complete);
        assert_eq!(outcome.index.file_count(), 2);
        assert_eq!(outcome.parsed, 2);
        assert_eq!(outcome.reused, 0);
        assert_eq!(outcome.index.skipped_by_language.get("md"), Some(&1));
    }

    #[test]
    fn gitignored_directories_never_reach_the_parser() {
        let repo = TempRepo::new("ignored");
        repo.write(".gitignore", "node_modules/\n");
        repo.write("src/a.ts", "export function alpha() {}\n");
        repo.write("node_modules/pkg/index.js", "module.exports = 1;\n");

        let outcome = build(&repo, None, &CancelToken::new());
        assert_eq!(outcome.index.file_count(), 1);
        assert!(outcome.index.file("node_modules/pkg/index.js").is_none());
    }

    #[test]
    fn an_unchanged_repository_reparses_nothing() {
        let repo = TempRepo::new("warm");
        repo.write("src/a.ts", "export function alpha() { return 1; }\n");
        repo.write("src/b.ts", "export function beta() { return 2; }\n");

        let first = build(&repo, None, &CancelToken::new());
        assert_eq!(first.parsed, 2);

        let second = build(&repo, Some(first.index), &CancelToken::new());
        assert_eq!(second.parsed, 0, "a warm build must not reparse");
        assert_eq!(second.reused, 2);
        assert!(second.dirty.is_empty());
    }

    #[test]
    fn a_touched_but_identical_file_refreshes_the_stamp_without_reparsing() {
        let repo = TempRepo::new("touch");
        let source = "export function alpha() { return 1; }\n";
        repo.write("src/a.ts", source);
        let first = build(&repo, None, &CancelToken::new());

        // Same bytes, new mtime — tier 1 misses, tier 2 saves the parse.
        std::thread::sleep(std::time::Duration::from_millis(15));
        repo.write("src/a.ts", source);

        let second = build(&repo, Some(first.index), &CancelToken::new());
        assert_eq!(second.parsed, 0, "identical content must not be reparsed");
        assert_eq!(second.reused, 1);
    }

    #[test]
    fn edited_content_is_reparsed_and_marked_dirty() {
        let repo = TempRepo::new("edit");
        repo.write("src/a.ts", "export function alpha() { return 1; }\n");
        let first = build(&repo, None, &CancelToken::new());

        repo.write("src/a.ts", "export function alpha() { return 99; }\n");
        let second = build(&repo, Some(first.index), &CancelToken::new());
        assert_eq!(second.parsed, 1);
        assert!(second.dirty.contains("src/a.ts"));
    }

    #[test]
    fn a_deleted_file_leaves_the_index() {
        let repo = TempRepo::new("delete");
        repo.write("src/a.ts", "export function alpha() {}\n");
        repo.write("src/b.ts", "export function beta() {}\n");
        let first = build(&repo, None, &CancelToken::new());
        assert_eq!(first.index.file_count(), 2);

        repo.remove("src/b.ts");
        let second = build(&repo, Some(first.index), &CancelToken::new());
        assert!(second.index.file("src/b.ts").is_none());
        assert!(second.dirty.contains("src/b.ts"));
    }

    #[test]
    fn oversized_files_are_skipped_and_counted() {
        let repo = TempRepo::new("big");
        repo.write("src/small.ts", "export function alpha() {}\n");
        let huge = format!(
            "export const blob = \"{}\";\n",
            "x".repeat(MAX_SOURCE_BYTES as usize + 16)
        );
        repo.write("src/huge.ts", &huge);

        let outcome = build(&repo, None, &CancelToken::new());
        assert_eq!(outcome.index.file_count(), 1);
        assert_eq!(outcome.index.skipped_by_budget, 1);
    }

    #[test]
    fn cancellation_stops_the_walk_and_is_not_an_error() {
        let repo = TempRepo::new("cancel");
        for i in 0..40 {
            repo.write(&format!("src/f{i}.ts"), "export function alpha() {}\n");
        }
        let cancel = CancelToken::new();
        cancel.cancel();

        let outcome = build(&repo, None, &cancel);
        assert!(outcome.cancelled);
        assert!(!outcome.index.complete, "a cancelled index is never complete");
        assert_eq!(outcome.index.file_count(), 0, "cancel is checked per file");
    }

    #[test]
    fn cancellation_midway_keeps_what_was_already_parsed() {
        let repo = TempRepo::new("cancel-mid");
        let total = PROGRESS_STEP_FILES * 2 + 20;
        for i in 0..total {
            repo.write(&format!("src/f{i}.ts"), "export function alpha() {}\n");
        }
        let cancel = CancelToken::new();
        let trip = cancel.clone();
        let outcome = build_index(repo.root(), None, &cancel, &mut |progress| {
            if progress.files_done >= PROGRESS_STEP_FILES {
                trip.cancel();
            }
        })
        .expect("cancellation is not an error");

        assert!(outcome.cancelled);
        assert!(!outcome.index.complete, "a partial index says so");
        assert!(
            outcome.index.file_count() >= PROGRESS_STEP_FILES,
            "work done before the cancel is kept ({} files)",
            outcome.index.file_count()
        );
        assert!(
            outcome.index.file_count() < total,
            "the walk stopped early ({} of {total} files)",
            outcome.index.file_count()
        );
    }

    #[test]
    fn progress_reports_the_first_and_last_event() {
        let repo = TempRepo::new("progress");
        repo.write("src/a.ts", "export function alpha() {}\n");

        let mut events = Vec::new();
        build_index(repo.root(), None, &CancelToken::new(), &mut |progress| {
            events.push((progress.phase, progress.running));
        })
        .expect("build");

        assert_eq!(events.first().map(|e| e.0), Some(IndexPhase::Enumerating));
        assert_eq!(events.last(), Some(&(IndexPhase::Done, false)));
    }
}
