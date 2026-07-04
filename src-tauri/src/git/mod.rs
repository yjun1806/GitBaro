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

// Convenient re-exports for callers
pub use engine::{
    AuthorInfo, BlameLine, BranchInfo, CommitInfo, ConflictFile, DiffHunk, DiffLine,
    DiffOutput, DiffSpec, FileDiff, FileStatus, GitEngine, GitRemoteEngine, LogOptions,
    MergeResult, RemoteInfo, StashEntry, StatusEntry,
};
