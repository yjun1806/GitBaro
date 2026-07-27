//! Test-run evidence and diff-coverage commands (contract §3.4).
//!
//! `run_test_command` is the only place in this subsystem that executes a
//! user-supplied string through a shell. The rules that keep that safe:
//!
//! - The command comes from user settings only. Text an agent produced —
//!   session logs, commit messages, diffs — is **never** executed. Detecting a
//!   test command in a log (V20) and running one are different things.
//! - `current_dir` is the repository path the caller named.
//! - A ten-minute timeout kills the process and records `passed: false`.
//! - Only the last 8 KiB of output is stored, and it is never re-logged: test
//!   output routinely contains tokens.

use std::path::{Path, PathBuf};

use git2::Repository;
use tauri::{AppHandle, Emitter};

use crate::error::AppError;
use crate::events::{VerifyTestProgressEvent, VERIFY_TEST_PROGRESS};
use crate::git::commit::validate_commit_oid;
use crate::verify::evidence;
use crate::verify::types::{CoverageResult, TestEvidence, TestEvidenceStatus};

use super::verify::{commit_diff, resolve_commit, working_tree_diff};

/// Progress lines are clipped before they cross the IPC boundary.
const MAX_PROGRESS_CHARS: usize = 2_048;

/// V11 — recorded evidence plus its freshness against the tree right now.
#[tauri::command]
pub async fn get_test_evidence(repo_path: String) -> Result<TestEvidenceStatus, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        evidence::evidence_status(&repo)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V11 — run the tests and bind the result to the current worktree hash.
///
/// A failing suite is not an error: it returns `Ok` with `passed: false`,
/// because a failure *is* evidence.
#[tauri::command]
pub async fn run_test_command(
    repo_path: String,
    command: String,
    app_handle: AppHandle,
) -> Result<TestEvidence, AppError> {
    let path = PathBuf::from(&repo_path);

    let resolved = evidence::resolve_test_command(&path, Some(&command)).ok_or_else(|| {
        AppError::Verify("No test command configured or detected for this repository".to_string())
    })?;

    let emit_path = repo_path.clone();
    let handle = app_handle.clone();
    let on_line = move |line: &str| {
        let clipped: String = line.chars().take(MAX_PROGRESS_CHARS).collect();
        let _ = handle.emit(
            VERIFY_TEST_PROGRESS,
            VerifyTestProgressEvent {
                repo_path: emit_path.clone(),
                line: clipped,
                running: true,
            },
        );
    };

    let result =
        evidence::run_and_record(&path, &resolved, evidence::DEFAULT_TEST_TIMEOUT, on_line).await;

    // The panel must leave its running state whether the run succeeded or not.
    let _ = app_handle.emit(
        VERIFY_TEST_PROGRESS,
        VerifyTestProgressEvent {
            repo_path,
            line: String::new(),
            running: false,
        },
    );

    result
}

/// V12 — coverage of the added lines only.
///
/// A missing or unparseable report is not an error: every changed file lands in
/// `unmapped_files` and the result is empty. "We cannot tell" must never render
/// as "covered".
#[tauri::command]
pub async fn get_diff_coverage(
    repo_path: String,
    oid: Option<String>,
    coverage_path: Option<String>,
) -> Result<CoverageResult, AppError> {
    if let Some(oid) = &oid {
        validate_commit_oid(oid)?;
    }

    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let repo = Repository::open(&path)?;
        let diff = match &oid {
            Some(oid) => commit_diff(&repo, &resolve_commit(&repo, oid)?)?,
            None => working_tree_diff(&repo, false)?,
        };

        let lookup =
            evidence::coverage_for_diff(Path::new(&repo_path), &diff, coverage_path.as_deref());
        if !matches!(lookup.status, evidence::CoverageStatus::Parsed) {
            tracing::debug!("[verify] coverage unavailable: {:?}", lookup.status);
        }
        Ok(lookup.result)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}
