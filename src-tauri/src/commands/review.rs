//! Review state, push gate, and evidence ledger commands (contract §3.2).
//!
//! The review modules are synchronous and touch `git2`, so every command here
//! is a thin `spawn_blocking` wrapper. Two things are deliberately *not* done:
//!
//! - The frontend never computes a diff hash. `mark_file_reviewed` takes a path
//!   and the backend derives the diff text, so a mark can only ever describe
//!   content the backend actually saw.
//! - The push gate returns counts. It does not block, disable, or refuse
//!   anything (§V34) — a gate people learn to bypass is worse than none.

use std::collections::BTreeMap;

use git2::Repository;

use crate::error::AppError;
use crate::git::commit::{subject_line, validate_commit_oid};
use crate::verify::config::load_rule_config;
use crate::verify::review;
use crate::verify::types::{
    CommitReviewState, EvidenceLedgerEntry, FileReviewEntry, PushGateSummary, ReviewQueue,
};

use super::verify::{commit_report, light_commit_report, resolve_commit};

/// Upper bound on the commits a push gate will analyse. Pushing more than this
/// at once is rare, and the summary stays useful without walking forever.
const MAX_GATE_COMMITS: usize = 100;

// ── V13: file review state ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_file_review_states(
    repo_path: String,
    paths: Vec<String>,
    staged: bool,
) -> Result<Vec<FileReviewEntry>, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        let mut hashes: BTreeMap<String, String> = BTreeMap::new();
        for path in &paths {
            let text = file_diff_text(&repo, path, staged)?;
            hashes.insert(path.clone(), crate::verify::digest::diff_hash(&text));
        }
        review::file_review_states(&repo, &hashes)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// The current diff hash is computed here, never supplied by the caller.
#[tauri::command]
pub async fn mark_file_reviewed(
    repo_path: String,
    path: String,
    staged: bool,
) -> Result<FileReviewEntry, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        let text = file_diff_text(&repo, &path, staged)?;
        review::mark_file_reviewed(&repo, &path, &text)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn unmark_file_reviewed(repo_path: String, path: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        review::unmark_file_reviewed(&repo, &path)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

// ── V29: commit review state ─────────────────────────────────────────────────

#[tauri::command]
pub async fn get_commit_review_states(
    repo_path: String,
    oids: Vec<String>,
) -> Result<Vec<CommitReviewState>, AppError> {
    for oid in &oids {
        validate_commit_oid(oid)?;
    }

    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        review::get_commit_review_states(&repo, &oids)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn mark_commit_reviewed(
    repo_path: String,
    oid: String,
) -> Result<CommitReviewState, AppError> {
    validate_commit_oid(&oid)?;

    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        review::mark_commit_reviewed(&repo, &oid)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn unmark_commit_reviewed(repo_path: String, oid: String) -> Result<(), AppError> {
    validate_commit_oid(&oid)?;

    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        review::unmark_commit_reviewed(&repo, &oid)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn get_review_queue(
    repo_path: String,
    limit: Option<usize>,
) -> Result<ReviewQueue, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        review::review_queue(&repo, limit)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

// ── V34: push gate (display only) ────────────────────────────────────────────

/// Summarises the commits `branch` would push to `remote`. **Never blocks.**
#[tauri::command]
pub async fn get_push_gate_summary(
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<PushGateSummary, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        let config = load_rule_config();
        let base = std::path::Path::new(&repo_path);

        let oids = commits_ahead(&repo, &remote, &branch)?;
        let mut inputs = Vec::with_capacity(oids.len());

        for oid in &oids {
            let commit = resolve_commit(&repo, oid)?;
            let files_changed = crate::verify::hygiene::commit_changed_paths(&repo, &commit)?.len();
            // The batch-cheap report: a gate that takes ten seconds to open is
            // a gate nobody opens.
            let report = light_commit_report(&repo, base, oid, &config)?;

            inputs.push(review::PushGateInput {
                commit_id: oid.clone(),
                summary: subject_line(commit.message().unwrap_or("")).to_string(),
                files_changed,
                max_severity: report.max_severity(),
                finding_count: report.findings.len(),
            });
        }

        let reviewed = review::reviewed_commit_map(&repo)?;
        Ok(review::push_gate_summary(&inputs, &reviewed))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

// ── V33: evidence ledger (opt-in, local only) ────────────────────────────────

#[tauri::command]
pub async fn get_ledger_enabled(repo_path: String) -> Result<bool, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        Ok(review::is_ledger_enabled(&repo))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn set_ledger_enabled(repo_path: String, enabled: bool) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        review::set_ledger_enabled(&repo, enabled)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// A commit with no note reads as `Ok(None)`, not an error.
#[tauri::command]
pub async fn read_evidence_ledger(
    repo_path: String,
    oid: String,
) -> Result<Option<EvidenceLedgerEntry>, AppError> {
    validate_commit_oid(&oid)?;

    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        review::read_evidence_ledger(&repo, &oid)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// The backend recomputes the report and records it. The frontend never
/// composes ledger content. Strictly local — nothing is ever pushed.
#[tauri::command]
pub async fn record_evidence_ledger(
    repo_path: String,
    oid: String,
) -> Result<EvidenceLedgerEntry, AppError> {
    validate_commit_oid(&oid)?;

    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        let config = load_rule_config();
        let report = commit_report(&repo, std::path::Path::new(&repo_path), &oid, &config)?;
        let entry = review::ledger_entry_from_report(&repo, &oid, &report)?;
        review::write_evidence_ledger(&repo, &entry)?;
        Ok(entry)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// The patch text of one path, in the form the review hash is taken over.
///
/// The exact bytes do not matter as long as they are reproducible: V13 only
/// asks "is this the same diff I marked?".
fn file_diff_text(repo: &Repository, path: &str, staged: bool) -> Result<String, AppError> {
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(path);

    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };

    let mut text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        if matches!(line.origin(), '+' | '-' | ' ') {
            text.push(line.origin());
        }
        text.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;

    Ok(text)
}

/// Commit ids on `branch` that `remote` does not have yet, newest first.
///
/// A remote-tracking ref that does not exist means "nothing is pushed yet", so
/// the whole branch is ahead — which is exactly what the gate should show.
fn commits_ahead(repo: &Repository, remote: &str, branch: &str) -> Result<Vec<String>, AppError> {
    if branch.trim().is_empty() {
        return Err(AppError::Verify("No branch given".to_string()));
    }

    let local = repo
        .revparse_single(branch)
        .and_then(|obj| obj.peel_to_commit())?;

    let mut walk = repo.revwalk()?;
    walk.push(local.id())?;

    let upstream = format!("refs/remotes/{}/{}", remote, branch);
    if let Ok(commit) = repo
        .revparse_single(&upstream)
        .and_then(|obj| obj.peel_to_commit())
    {
        walk.hide(commit.id())?;
    } else {
        tracing::debug!(
            "[verify] {} not found — treating the branch as fully ahead",
            upstream
        );
    }

    Ok(walk
        .take(MAX_GATE_COMMITS)
        .filter_map(|id| id.ok())
        .map(|id| id.to_string())
        .collect())
}
