use serde::Serialize;

// Event name constants
pub const GIT_COMMAND_START: &str = "git:command-start";
pub const GIT_COMMAND_COMPLETE: &str = "git:command-complete";
pub const GIT_COMMAND_PROGRESS: &str = "git:command-progress";
pub const FS_CHANGE: &str = "fs:change";

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
    /// 사용자가 직접 실행한 작업이 아니라 앱이 주기적으로 도는 작업인지.
    /// 프론트엔드는 성공한 자동 작업을 활동 로그에서 제외한다.
    pub automatic: bool,
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
