use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::git::cli::GitCliEngine;
use crate::git::engine::{
    BlameLine, BranchInfo, CommitInfo, DiffOutput, DiffSpec, GitEngine, GitRemoteEngine,
    LogOptions, MergeResult, RemoteInfo, StashEntry, StatusEntry,
};
use crate::git::libgit::LibGitEngine;
use crate::git::remote::list_remotes;

/// Unified repository handle combining libgit2 (local ops) and CLI (network ops).
pub struct GitRepository {
    pub local: LibGitEngine,
    pub remote: GitCliEngine,
    pub path: PathBuf,
}

impl GitRepository {
    /// Open an existing repository at `path`.
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let local = LibGitEngine::open(path)?;
        let remote = GitCliEngine::new(path);
        Ok(Self {
            local,
            remote,
            path: path.to_path_buf(),
        })
    }

    /// List all configured remotes.
    pub fn remotes(&self) -> Result<Vec<RemoteInfo>, AppError> {
        list_remotes(&self.local.repo.borrow())
    }

    /// Check whether the working tree has uncommitted changes.
    pub fn is_dirty(&self) -> Result<bool, AppError> {
        let statuses = self.local.status()?;
        Ok(!statuses.is_empty())
    }

    // ── Local engine delegation ───────────────────────────────────────────────

    pub fn status(&self) -> Result<Vec<StatusEntry>, AppError> {
        self.local.status()
    }

    pub fn diff(&self, spec: &DiffSpec) -> Result<DiffOutput, AppError> {
        self.local.diff(spec)
    }

    pub fn commit(&self, message: &str, amend: bool) -> Result<String, AppError> {
        self.local.commit(message, amend)
    }

    pub fn log(&self, opts: &LogOptions) -> Result<Vec<CommitInfo>, AppError> {
        self.local.log(opts)
    }

    pub fn branches(&self) -> Result<Vec<BranchInfo>, AppError> {
        self.local.branches()
    }

    pub fn create_branch(&self, name: &str, from: Option<&str>) -> Result<(), AppError> {
        self.local.create_branch(name, from)
    }

    pub fn switch_branch(&self, name: &str) -> Result<(), AppError> {
        self.local.switch_branch(name)
    }

    pub fn delete_branch(&self, name: &str, force: bool) -> Result<(), AppError> {
        self.local.delete_branch(name, force)
    }

    pub fn current_branch(&self) -> Result<Option<String>, AppError> {
        self.local.current_branch()
    }

    pub fn stage_files(&self, paths: &[String]) -> Result<(), AppError> {
        self.local.stage_files(paths)
    }

    pub fn unstage_files(&self, paths: &[String]) -> Result<(), AppError> {
        self.local.unstage_files(paths)
    }

    pub fn discard_changes(&self, paths: &[String]) -> Result<(), AppError> {
        self.local.discard_changes(paths)
    }

    pub fn stash_save(&self, message: Option<&str>) -> Result<(), AppError> {
        self.local.stash_save(message)
    }

    pub fn stash_pop(&self) -> Result<(), AppError> {
        self.local.stash_pop()
    }

    pub fn stash_list(&self) -> Result<Vec<StashEntry>, AppError> {
        self.local.stash_list()
    }

    pub fn merge_branch(&self, branch: &str) -> Result<MergeResult, AppError> {
        self.local.merge_branch(branch)
    }

    pub fn blame(&self, path: &str) -> Result<Vec<BlameLine>, AppError> {
        self.local.blame(path)
    }

    // ── Remote engine delegation (async) ─────────────────────────────────────

    pub async fn clone_repo(&self, url: &str, path: &Path, token: &str) -> Result<(), AppError> {
        self.remote.clone_repo(url, path, token).await
    }

    pub async fn fetch(&self, remote_name: &str, token: &str) -> Result<(), AppError> {
        self.remote.fetch(remote_name, token).await
    }

    pub async fn push(
        &self,
        remote_name: &str,
        branch: &str,
        token: &str,
        force: bool,
    ) -> Result<(), AppError> {
        self.remote.push(remote_name, branch, token, force).await
    }

    pub async fn pull(
        &self,
        remote_name: &str,
        branch: &str,
        token: &str,
        rebase: bool,
    ) -> Result<(), AppError> {
        self.remote.pull(remote_name, branch, token, rebase).await
    }
}
