//! Session-log commands (contract §3.3).
//!
//! Progressive enhancement is the rule here (§7-⑥): if no agent CLI has ever
//! run in this repository, or a log format changed under us, these commands
//! return empty results — never an error toast. The one exception is a command
//! handed a *specific* session file it cannot open, which is a real failure the
//! caller asked for by name.

use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::AppError;
use crate::git::commit::validate_commit_oid;
use crate::git::engine::DiffOutput;
use crate::verify::config::load_rule_config;
use crate::verify::paths::shared_state_dir;
use crate::verify::session::{self, correlate::CommitRef, SessionRoots};
use crate::verify::types::{SessionCommitLink, SessionSummary, VerificationReport};

use super::verify::commit_diff;

/// How far back correlation looks for candidate commits.
const CORRELATION_WALK: usize = 200;

const SESSION_CACHE_DIR: &str = "session-cache";

#[tauri::command]
pub async fn list_sessions_for_repo(
    repo_path: String,
    limit: Option<usize>,
) -> Result<Vec<SessionSummary>, AppError> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let cache = cache_dir(&path);
        session::summarize_sessions_for_repo(
            &path,
            &SessionRoots::from_home(),
            cache.as_deref(),
            limit,
        )
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))
}

/// `Ok(None)` when the file holds nothing recognisable. `Err` only when the
/// named file cannot be opened at all.
#[tauri::command]
pub async fn get_session_summary(session_path: String) -> Result<Option<SessionSummary>, AppError> {
    tokio::task::spawn_blocking(move || session::summarize_session_at(Path::new(&session_path)))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V19~V27 findings for one session.
#[tauri::command]
pub async fn verify_session(
    repo_path: String,
    session_path: String,
) -> Result<VerificationReport, AppError> {
    tokio::task::spawn_blocking(move || {
        tracing::debug!("[verify] session scan for {}", repo_path);
        let config = load_rule_config();
        match session::summarize_session_at(Path::new(&session_path))? {
            Some(summary) => Ok(session::rules::run_session_rules(&summary, &config)),
            // An unreadable session is not a clean session — an empty report
            // still carries the full `unchecked` accounting.
            None => Ok(VerificationReport::empty()),
        }
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V30 — which sessions plausibly produced these commits.
///
/// `Low` confidence links are returned, but the contract forbids the frontend
/// from rendering them as settled provenance.
#[tauri::command]
pub async fn correlate_sessions_to_commits(
    repo_path: String,
    oids: Vec<String>,
) -> Result<Vec<SessionCommitLink>, AppError> {
    for oid in &oids {
        validate_commit_oid(oid)?;
    }

    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let repo = Repository::open(&path)?;
        let commits = commit_refs(&repo, &oids)?;
        let cache = cache_dir(&path);
        let sessions = session::summarize_sessions_for_repo(
            &path,
            &SessionRoots::from_home(),
            cache.as_deref(),
            None,
        );
        Ok(session::correlate::correlate(&path, &sessions, &commits))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V30 — everything a session changed, as one diff.
///
/// The baseline is the first parent of the earliest commit correlated with the
/// session. Claude Code's `file-history-snapshot` baseline is not implemented,
/// so a session with no correlated commit yields an empty diff rather than a
/// guess: an inaccurate attribution is worse than none (§7-⑧).
#[tauri::command]
pub async fn get_session_cumulative_diff(
    repo_path: String,
    session_path: String,
) -> Result<DiffOutput, AppError> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let repo = Repository::open(&path)?;

        let Some(summary) = session::summarize_session_at(Path::new(&session_path))? else {
            return Ok(DiffOutput { files: Vec::new() });
        };

        let oids = recent_commit_ids(&repo, CORRELATION_WALK)?;
        let commits = commit_refs(&repo, &oids)?;
        let links = session::correlate::correlate(&path, std::slice::from_ref(&summary), &commits);

        // `commit_ids` comes back newest-first, so the oldest is the baseline.
        let Some(oldest) = links.first().and_then(|link| link.commit_ids.last()) else {
            return Ok(DiffOutput { files: Vec::new() });
        };

        let commit = repo.revparse_single(oldest)?.peel_to_commit()?;
        cumulative_diff(&repo, &commit)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Session summaries are cached in the worktree-shared state directory, so a
/// second worktree does not re-parse megabytes of log.
fn cache_dir(repo_path: &Path) -> Option<PathBuf> {
    let repo = Repository::open(repo_path).ok()?;
    match shared_state_dir(&repo) {
        Ok(dir) => Some(dir.join(SESSION_CACHE_DIR)),
        Err(e) => {
            tracing::warn!("[verify] no session cache directory: {}", e);
            None
        }
    }
}

/// Correlation inputs. `CommitInfo::timestamp` is in seconds and every verify
/// timestamp is in milliseconds — this is the conversion point.
fn commit_refs(repo: &Repository, oids: &[String]) -> Result<Vec<CommitRef>, AppError> {
    let mut refs = Vec::with_capacity(oids.len());

    for oid in oids {
        let Ok(commit) = repo.revparse_single(oid).and_then(|o| o.peel_to_commit()) else {
            tracing::debug!("[verify] skipping unresolvable commit {}", oid);
            continue;
        };
        let files = crate::verify::hygiene::commit_changed_paths(repo, &commit)?;
        refs.push(CommitRef {
            oid: commit.id().to_string(),
            timestamp_ms: commit.time().seconds() * 1000,
            files,
        });
    }

    Ok(refs)
}

fn recent_commit_ids(repo: &Repository, limit: usize) -> Result<Vec<String>, AppError> {
    if repo.head().is_err() {
        return Ok(Vec::new());
    }

    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    Ok(walk
        .take(limit)
        .filter_map(|id| id.ok())
        .map(|id| id.to_string())
        .collect())
}

/// From `baseline`'s first parent up to the working tree.
fn cumulative_diff(repo: &Repository, baseline: &git2::Commit<'_>) -> Result<DiffOutput, AppError> {
    if baseline.parent_count() == 0 {
        // A root commit has no "before"; the whole session is the commit itself.
        return commit_diff(repo, baseline);
    }

    let parent_tree = baseline.parent(0)?.tree()?;
    let diff = repo.diff_tree_to_workdir_with_index(Some(&parent_tree), None)?;
    crate::git::diff::convert_diff(&diff)
}
