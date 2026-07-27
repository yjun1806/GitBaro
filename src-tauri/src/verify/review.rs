//! V13 · V29 · V33 · V34 — review state and the evidence ledger.
//!
//! Everything here is bookkeeping the reviewer can see. Nothing here blocks an
//! operation: the push gate (V34) reports counts and stops there, and the
//! git-notes ledger (V33) is opt-in and strictly local.
//!
//! Storage follows `state/app_state.rs`: JSON documents that fall back to their
//! default when missing or corrupt, written atomically (temp file + rename) so a
//! crash cannot leave a half-written document behind. The documents live inside
//! the repository's own git directory (`verify::paths`), which git already
//! ignores, so no `.gitignore` has to be touched.
//!
//! | Concern | Document | Location |
//! |---|---|---|
//! | V13 file marks | `file-review.json` | worktree-local |
//! | V29 commit marks | `commit-review.json` | worktree-shared |
//! | V33 ledger toggle | `ledger.json` | worktree-shared |
//! | V33 ledger entries | `refs/notes/gitbaro-verification` | git notes (local only) |

mod commits;
mod files;
mod ledger;
mod push_gate;
mod store;

#[cfg(test)]
mod test_support;

pub use commits::{
    get_commit_review_states, load_commit_reviews, mark_commit_reviewed, queue_from_walk,
    reviewed_commit_map, review_queue, unmark_commit_reviewed, DEFAULT_QUEUE_LIMIT, MAX_QUEUE_WALK,
};
pub use files::{
    file_review_entry, file_review_states, load_file_marks, mark_file_reviewed,
    resolve_file_status, unmark_file_reviewed,
};
pub use ledger::{
    is_ledger_enabled, ledger_entry_from_report, read_evidence_ledger, set_ledger_enabled,
    write_evidence_ledger, NOTES_REF,
};
pub use push_gate::{push_gate_summary, PushGateInput, TANGLED_FILE_THRESHOLD};

use git2::{Repository, Signature};
use tracing::warn;

use crate::error::AppError;

const UNKNOWN_REVIEWER: &str = "unknown";

/// Epoch milliseconds — the time unit every verify type uses.
pub(crate) fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// `Name <email>` from the repository's git identity.
///
/// Attribution is the point of a review mark, but an unset `user.name` must not
/// stop someone from marking a file read, so this degrades instead of failing.
pub(crate) fn reviewer_identity(repo: &Repository) -> String {
    match repo.signature() {
        Ok(sig) => identity_of(&sig),
        Err(e) => {
            warn!("[verify] no git identity for review attribution: {}", e);
            UNKNOWN_REVIEWER.to_string()
        }
    }
}

/// The same identity, but mandatory: an anonymous ledger entry is not evidence.
pub(crate) fn require_signature(repo: &Repository) -> Result<Signature<'static>, AppError> {
    repo.signature().map_err(|e| {
        AppError::Verify(format!(
            "git user.name and user.email must be set to record a verification ledger entry: {}",
            e
        ))
    })
}

pub(crate) fn identity_of(sig: &Signature<'_>) -> String {
    format!(
        "{} <{}>",
        sig.name().unwrap_or(UNKNOWN_REVIEWER),
        sig.email().unwrap_or("")
    )
}
