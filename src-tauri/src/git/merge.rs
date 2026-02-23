use serde::{Deserialize, Serialize};

pub use crate::git::engine::{ConflictFile, MergeResult};

/// Check if a merge result has conflicts.
pub fn has_conflicts(result: &MergeResult) -> bool {
    matches!(result, MergeResult::Conflict(_))
}

/// Extract conflict files from a merge result.
pub fn conflict_files(result: &MergeResult) -> Vec<&ConflictFile> {
    match result {
        MergeResult::Conflict(files) => files.iter().collect(),
        _ => vec![],
    }
}

/// Summary of a merge result as human-readable string.
pub fn merge_summary(result: &MergeResult) -> String {
    match result {
        MergeResult::Clean { commit_id } => format!("Merged cleanly: {}", &commit_id[..8]),
        MergeResult::FastForward { commit_id } => {
            format!("Fast-forwarded to: {}", &commit_id[..8])
        }
        MergeResult::Conflict(files) => {
            format!("Merge conflict in {} file(s)", files.len())
        }
        MergeResult::AlreadyUpToDate => "Already up to date".to_string(),
    }
}

/// Conflict side selector.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum ConflictSide {
    Ours,
    Theirs,
    Base,
}
