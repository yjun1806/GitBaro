use serde::Serialize;

// Event name constants
pub const GIT_COMMAND_START: &str = "git:command-start";
pub const GIT_COMMAND_COMPLETE: &str = "git:command-complete";
pub const GIT_COMMAND_PROGRESS: &str = "git:command-progress";
pub const FS_CHANGE: &str = "fs:change";
pub const VERIFY_TEST_PROGRESS: &str = "verify:test-progress";
/// Symbol-index build progress. The payload is `verify::context::IndexProgress`,
/// which is already `Serialize` + camelCase and is forwarded verbatim.
pub const VERIFY_INDEX_PROGRESS: &str = "verify:index-progress";

/// Streams a running test command's output to the verification panel (V11).
/// Only the last line is carried — the full output stays in the evidence tail.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTestProgressEvent {
    pub repo_path: String,
    /// Last output line, cut at 2048 characters.
    pub line: String,
    pub running: bool,
}

/// Emitted when the working tree of a watched repository changes (debounced).
/// The frontend uses this to invalidate the status query instead of polling.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangeEvent {
    pub repo_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandStartEvent {
    pub id: String,
    pub command: String,
    pub operation: String,
    pub repo_path: String,
    pub started_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandCompleteEvent {
    pub id: String,
    pub operation: String,
    pub success: bool,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub result_summary: Option<OperationSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandProgressEvent {
    pub id: String,
    pub operation: String,
    pub message: String,
    pub percent: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum OperationSummary {
    #[serde(rename_all = "camelCase")]
    Fetch {
        updated_branches: Vec<BranchUpdate>,
        new_branches: Vec<String>,
        deleted_branches: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Push {
        branch: String,
        commit_count: u32,
        remote: String,
    },
    #[serde(rename_all = "camelCase")]
    Pull {
        merge_type: String,
        files_changed: u32,
        has_conflicts: bool,
    },
    #[serde(rename_all = "camelCase")]
    Merge {
        merge_type: String,
        files_changed: u32,
        has_conflicts: bool,
        source_branch: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchUpdate {
    pub name: String,
    pub old_oid: String,
    pub new_oid: String,
}
