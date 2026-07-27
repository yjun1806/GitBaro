// SPDX-License-Identifier: GPL-3.0-or-later
//! Sub-commit bisect — V36 (`verify/bisect.rs`).
//!
//! `command` and `prepare_command` reach `/bin/sh -c`, so the same rule as
//! `run_test_command` applies and is stricter here: they may come **only from
//! user settings**. Text an agent produced — a commit message, a diff, a session
//! log — is never executed. The scratch checkout is a temporary directory; the
//! user's repository is never written to.
//!
//! `v36.subCommitBisect` stays `Planned` in the registry, and honestly so: this
//! is a user-driven investigation tool that emits no `Finding`, and a scratch
//! tree has no `node_modules` or `target/`, so on most real projects the search
//! ends at `ParentAlreadyFails` unless `prepare_command` is set. The machinery
//! is complete; its usefulness is unproven.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use crate::error::AppError;
use crate::git::commit::validate_commit_oid;
use crate::verify::bisect::{run_bisect, BisectReport, BisectRequest};

/// Upper bounds the caller may lower but not raise, so a mistyped setting cannot
/// leave a shell loop running for a day.
const MAX_RUN_TIMEOUT_SECS: u64 = 1_800;
const MAX_TOTAL_TIMEOUT_SECS: u64 = 7_200;
const MAX_RUNS_CEILING: usize = 128;

/// Narrow a commit to the minimal subset of its file changes that still fails
/// `command`.
///
/// An inconclusive search is a successful call: the verdict explains why. `Err`
/// is reserved for a commit that cannot be planned at all (a merge, an
/// oversized payload, an unreadable tree).
#[tauri::command]
pub async fn run_sub_commit_bisect(
    repo_path: String,
    oid: String,
    command: String,
    prepare_command: Option<String>,
    run_timeout_secs: Option<u64>,
    total_timeout_secs: Option<u64>,
    max_runs: Option<usize>,
) -> Result<BisectReport, AppError> {
    validate_commit_oid(&oid)?;
    if command.trim().is_empty() {
        return Err(AppError::Verify(
            "A verification command is required to bisect a commit".to_string(),
        ));
    }

    let mut request = BisectRequest::new(PathBuf::from(&repo_path), oid.clone(), command);
    request.prepare_command = prepare_command.filter(|c| !c.trim().is_empty());
    if let Some(secs) = run_timeout_secs {
        request.run_timeout = Duration::from_secs(secs.clamp(1, MAX_RUN_TIMEOUT_SECS));
    }
    if let Some(secs) = total_timeout_secs {
        request.total_timeout = Duration::from_secs(secs.clamp(1, MAX_TOTAL_TIMEOUT_SECS));
    }
    if let Some(runs) = max_runs {
        request.max_runs = runs.clamp(1, MAX_RUNS_CEILING);
    }

    tracing::info!("[verify] sub-commit bisect starting for {}", oid);
    run_bisect(request, Arc::new(AtomicBool::new(false))).await
}
