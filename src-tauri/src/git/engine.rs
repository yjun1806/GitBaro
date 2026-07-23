use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

// ── Status ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub status: FileStatus,
    pub original_path: Option<String>, // for renames
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    Conflicted,
    // index vs workdir combined
    IndexAdded,
    IndexModified,
    IndexDeleted,
    IndexRenamed,
}

// ── Diff ──────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffSpec {
    pub path: Option<String>,
    pub staged: bool,
    pub old_rev: Option<String>,
    pub new_rev: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffOutput {
    pub files: Vec<FileDiff>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub origin: char, // '+', '-', ' '
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

// ── Commit ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub summary: String,
    pub author: AuthorInfo,
    pub committer: AuthorInfo,
    pub timestamp: i64,
    pub parent_ids: Vec<String>,
    /// Refs (tags/branches) that point at this commit. Populated by `log()` and
    /// `get_commit_history` (both via `build_ref_map`); empty elsewhere.
    pub refs: Vec<RefLabel>,
}

/// A tag or branch label pointing at a commit, shown in the history list.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    /// Display name, e.g. "main", "origin/main", "v1.0.0".
    pub name: String,
    pub kind: RefKind,
    /// True when this is the local branch currently checked out (HEAD).
    pub is_head: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Tag,
    LocalBranch,
    RemoteBranch,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuthorInfo {
    pub name: String,
    pub email: String,
    pub timestamp: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogOptions {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub branch: Option<String>,
    pub path: Option<String>,
}

// ── Branch ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub commit_id: String,
}

// ── Remote ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub push_url: Option<String>,
}

// ── Stash ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub commit_id: String,
    pub branch_name: Option<String>,
    pub timestamp: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StashShowResult {
    pub entry: StashEntry,
    pub files: Vec<StashFileSummary>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StashFileSummary {
    pub path: String,
    pub status: String,
    pub insertions: usize,
    pub deletions: usize,
}

// ── Merge ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum MergeResult {
    Clean { commit_id: String },
    FastForward { commit_id: String },
    Conflict(Vec<ConflictFile>),
    AlreadyUpToDate,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub base: Option<String>,
}

// ── Merge Pre-Check ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergePreCheckResult {
    pub can_fast_forward: bool,
    pub has_conflicts: bool,
    pub conflict_files: Vec<String>,
}

// ── Branch Compare ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchCompareResult {
    pub base_branch: String,
    pub compare_branch: String,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub ahead_commits: Vec<CommitInfo>,
    pub behind_commits: Vec<CommitInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum MergeStrategy {
    Merge,
    Squash,
    Rebase,
}

// ── Blame ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line_no: u32,
    pub content: String,
    pub commit_id: String,
    pub author: AuthorInfo,
    pub summary: String,
}

// ── Traits ────────────────────────────────────────────────────────────────────

pub trait GitEngine {
    fn status(&self) -> Result<Vec<StatusEntry>, AppError>;
    fn diff(&self, spec: &DiffSpec) -> Result<DiffOutput, AppError>;
    fn commit(&self, message: &str, amend: bool) -> Result<String, AppError>;
    fn log(&self, opts: &LogOptions) -> Result<Vec<CommitInfo>, AppError>;
    fn branches(&self) -> Result<Vec<BranchInfo>, AppError>;
    fn create_branch(&self, name: &str, from: Option<&str>) -> Result<(), AppError>;
    fn switch_branch(&self, name: &str) -> Result<(), AppError>;
    fn delete_branch(&self, name: &str, force: bool) -> Result<(), AppError>;
    fn current_branch(&self) -> Result<Option<String>, AppError>;
    fn stage_files(&self, paths: &[String]) -> Result<(), AppError>;
    fn unstage_files(&self, paths: &[String]) -> Result<(), AppError>;
    fn discard_changes(&self, paths: &[String]) -> Result<(), AppError>;
    fn stash_save(&self, message: Option<&str>) -> Result<(), AppError>;
    fn stash_pop(&self) -> Result<(), AppError>;
    fn stash_list(&self) -> Result<Vec<StashEntry>, AppError>;
    fn merge_branch(&self, branch: &str) -> Result<MergeResult, AppError>;
    fn blame(&self, path: &str) -> Result<Vec<BlameLine>, AppError>;
}

pub trait GitRemoteEngine {
    fn clone_repo(
        &self,
        url: &str,
        path: &Path,
        token: &str,
    ) -> impl std::future::Future<Output = Result<(), AppError>> + Send;

    fn fetch(
        &self,
        remote: &str,
        token: &str,
    ) -> impl std::future::Future<Output = Result<(), AppError>> + Send;

    fn push(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        force: bool,
    ) -> impl std::future::Future<Output = Result<(), AppError>> + Send;

    fn pull(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        rebase: bool,
    ) -> impl std::future::Future<Output = Result<(), AppError>> + Send;
}
