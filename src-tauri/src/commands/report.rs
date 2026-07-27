//! Session report commands (session-report §3.1).
//!
//! Two commands, and that is the whole surface. The page this feeds needed
//! seven round-trips before — list sessions, summarise one, verify it,
//! correlate it, diff it, blast-radius it, ask about the index — and an N+1 on
//! a page is how a narrative turns back into a pile of panels.
//!
//! Both commands are quiet by design (§7-⑥): a repository where no agent has
//! ever run returns an empty list, not an error. That empty list is what the
//! frontend gate reads to decide whether any verification UI exists at all.

use std::path::{Path, PathBuf};

use git2::Repository;
use tauri::State;

use crate::error::AppError;
use crate::verify::context::SymbolIndexStore;
use crate::verify::paths::shared_state_dir;
use crate::verify::report::model::{SessionDigest, SessionReport};
use crate::verify::report::{build_report, digests_for};
use crate::verify::session::{self, SessionRoots};

/// Shared with `commands/session.rs` on purpose: both read the same summary
/// cache, so a report never re-parses a log the list already folded.
const SESSION_CACHE_DIR: &str = "session-cache";

/// Sessions belonging to this repository, newest first.
///
/// **The only data source for the "is there anything to show?" gate.** No
/// session directory, or nothing parseable inside it, is an empty `Vec` — not
/// an error, and never a placeholder panel.
#[tauri::command]
pub async fn list_session_digests(
    repo_path: String,
    limit: Option<usize>,
    // Declared for contract stability: the digest list is deliberately cheap
    // and never touches the symbol index.
    _store: State<'_, SymbolIndexStore>,
) -> Result<Vec<SessionDigest>, AppError> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let cache = cache_dir(&path);
        let summaries = session::summarize_sessions_for_repo(
            &path,
            &SessionRoots::from_home(),
            cache.as_deref(),
            limit,
        );
        if summaries.is_empty() {
            return Vec::new();
        }
        match Repository::open(&path) {
            Ok(repo) => digests_for(&repo, &path, &summaries),
            Err(e) => {
                tracing::debug!("[report] no repository at {}: {}", path.display(), e);
                Vec::new()
            }
        }
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))
}

/// The whole report for one session.
///
/// `Ok(None)` means the file held nothing recognisable — the frontend renders
/// nothing at all. `Err` only when the named file cannot be opened, which is a
/// failure the caller asked for by name.
#[tauri::command]
pub async fn get_session_report(
    repo_path: String,
    session_path: String,
    store: State<'_, SymbolIndexStore>,
) -> Result<Option<SessionReport>, AppError> {
    let path = PathBuf::from(&repo_path);
    // Snapshot before the blocking hop: `State` does not outlive this frame,
    // and the report is forbidden from *building* an index anyway.
    let index = store.snapshot(&path);
    let index_state = store.status(&path).state;

    tokio::task::spawn_blocking(move || {
        let Some(summary) = session::summarize_session_at(Path::new(&session_path))? else {
            return Ok(None);
        };
        let repo = Repository::open(&path)?;
        Ok(Some(build_report(
            &repo,
            &path,
            &summary,
            index.as_ref(),
            index_state,
        )))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// Session summaries live in the worktree-shared state directory so a second
/// worktree does not re-parse megabytes of log.
fn cache_dir(repo_path: &Path) -> Option<PathBuf> {
    let repo = Repository::open(repo_path).ok()?;
    match shared_state_dir(&repo) {
        Ok(dir) => Some(dir.join(SESSION_CACHE_DIR)),
        Err(e) => {
            tracing::warn!("[report] no session cache directory: {}", e);
            None
        }
    }
}
