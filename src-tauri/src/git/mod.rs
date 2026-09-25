pub mod binary;
pub mod branch;
pub mod cli;
pub mod commit;
pub mod diff;
pub mod engine;
pub mod libgit;
pub mod merge;
pub mod output_parser;
pub mod remote;
pub mod stash;
pub mod status;
pub mod unpushed;
pub mod walk;
pub mod worktree_base;

// Convenient re-exports for callers
pub use engine::{
    AuthorInfo, BlameLine, BranchInfo, CommitInfo, ConflictFile, DiffHunk, DiffLine,
    DiffOutput, DiffSpec, FileDiff, FileStatus, GitEngine, GitRemoteEngine, LogOptions,
    MergeResult, RemoteInfo, StashEntry, StatusEntry,
};
// W1-T4
pub mod new_commits;
// W4-T2
pub mod merge_base;
