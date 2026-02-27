use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::process::Command;

use crate::error::AppError;
use crate::git::engine::GitRemoteEngine;

// ── Worktree types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_main: bool,
    pub is_bare: bool,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
}

pub struct GitCliEngine {
    pub repo_path: PathBuf,
}

impl GitCliEngine {
    pub fn new(repo_path: &Path) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
        }
    }
}

// ── Local operations (hooks-aware) ──────────────────────────────────────────
// commit, switch_branch, stash 등 hooks가 실행되어야 하는 작업은
// git2 대신 git CLI를 통해 실행한다.

impl GitCliEngine {
    /// Run a local git command (no auth needed, hooks will execute).
    async fn run_local(&self, args: &[&str]) -> Result<std::process::Output, AppError> {
        tracing::info!(
            "[git] git {} (cwd: {})",
            args.join(" "),
            self.repo_path.display()
        );
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)?;
        log_output(&output);
        Ok(output)
    }

    /// Run a local git command and check for success. Returns stdout on success.
    async fn run_local_checked(&self, args: &[&str]) -> Result<String, AppError> {
        let output = self.run_local(args).await?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(AppError::GitCli {
                message: parse_git_error(&stderr),
                exit_code: output.status.code(),
            })
        }
    }

    /// Create a commit via git CLI so that hooks (pre-commit, commit-msg, post-commit) run.
    pub async fn commit(
        &self,
        message: &str,
        amend: bool,
        author: Option<(&str, &str)>,
    ) -> Result<String, AppError> {
        crate::git::commit::validate_message(message)?;

        let mut args = vec!["commit", "-m", message];
        if amend {
            args.push("--amend");
        }
        let author_str;
        if let Some((name, email)) = author {
            author_str = format!("{} <{}>", name, email);
            args.push("--author");
            args.push(&author_str);
        }
        self.run_local_checked(&args).await?;
        self.run_local_checked(&["rev-parse", "HEAD"]).await
    }

    /// Switch branch via git CLI so that post-checkout hook runs.
    pub async fn switch_branch(&self, name: &str) -> Result<(), AppError> {
        self.run_local_checked(&["checkout", name]).await?;
        Ok(())
    }

    /// Stash working changes via git CLI.
    pub async fn stash_save(&self, message: Option<&str>) -> Result<(), AppError> {
        let mut args = vec!["stash", "push"];
        if let Some(msg) = message {
            args.push("-m");
            args.push(msg);
        }
        self.run_local_checked(&args).await?;
        Ok(())
    }

    /// Pop the latest stash entry via git CLI (post-checkout hook may run).
    pub async fn stash_pop(&self) -> Result<(), AppError> {
        self.run_local_checked(&["stash", "pop"]).await?;
        Ok(())
    }

    /// Merge a branch into the current branch via git CLI so that hooks run.
    pub async fn merge_branch(&self, branch: &str, no_ff: bool) -> Result<(), AppError> {
        let mut args = vec!["merge"];
        if no_ff {
            args.push("--no-ff");
        }
        args.push("--");
        args.push(branch);
        self.run_local_checked(&args).await?;
        Ok(())
    }

    /// Squash-merge a branch into the current branch via git CLI.
    /// This stages the squashed changes but does NOT create a commit.
    pub async fn squash_merge(&self, branch: &str) -> Result<(), AppError> {
        self.run_local_checked(&["merge", "--squash", "--", branch]).await?;
        Ok(())
    }

    /// Rebase the current branch onto the given base via git CLI.
    pub async fn rebase_onto(&self, base: &str) -> Result<(), AppError> {
        self.run_local_checked(&["rebase", "--", base]).await?;
        Ok(())
    }
}

// ── Worktree operations ─────────────────────────────────────────────────────
// worktree는 로컬 전용 CLI 작업이다. git2(libgit2)는 worktree 지원이 제한적이므로
// git CLI를 직접 사용한다.

impl GitCliEngine {
    /// List all worktrees via `git worktree list --porcelain`.
    pub async fn list_worktrees(&self) -> Result<Vec<WorktreeEntry>, AppError> {
        let output = self.run_local_checked(&["worktree", "list", "--porcelain"]).await?;
        Ok(parse_worktree_porcelain(&output))
    }

    /// Add a new worktree via `git worktree add`.
    pub async fn add_worktree(
        &self,
        path: &str,
        branch: Option<&str>,
        new_branch: Option<&str>,
    ) -> Result<(), AppError> {
        let mut args = vec!["worktree", "add"];
        let nb_flag;
        if let Some(nb) = new_branch {
            nb_flag = nb.to_string();
            args.push("-b");
            args.push(&nb_flag);
        }
        args.push(path);
        if let Some(b) = branch {
            args.push(b);
        }
        self.run_local_checked(&args).await?;
        Ok(())
    }

    /// Remove a worktree via `git worktree remove`.
    pub async fn remove_worktree(&self, path: &str, force: bool) -> Result<(), AppError> {
        let mut args = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.push(path);
        self.run_local_checked(&args).await?;
        Ok(())
    }
}

/// Parse `git worktree list --porcelain` output into WorktreeEntry list.
///
/// Format: blocks separated by blank lines, each containing:
///   worktree <path>
///   HEAD <hash>
///   branch refs/heads/<name>  (or `detached`)
///   bare  (optional)
///   locked [<reason>]  (optional)
fn parse_worktree_porcelain(output: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut is_first = true;

    for block in output.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        let mut path = String::new();
        let mut head = String::new();
        let mut branch: Option<String> = None;
        let mut is_bare = false;
        let mut is_locked = false;
        let mut lock_reason: Option<String> = None;

        for line in block.lines() {
            let line = line.trim();
            if let Some(p) = line.strip_prefix("worktree ") {
                path = p.to_string();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = b.strip_prefix("refs/heads/").map(|s| s.to_string())
                    .or_else(|| Some(b.to_string()));
            } else if line == "bare" {
                is_bare = true;
            } else if line == "locked" {
                is_locked = true;
            } else if let Some(reason) = line.strip_prefix("locked ") {
                is_locked = true;
                lock_reason = Some(reason.to_string());
            }
            // `detached` line → branch stays None
        }

        if !path.is_empty() {
            let is_main = is_first;
            entries.push(WorktreeEntry {
                path,
                head,
                branch,
                is_main,
                is_bare,
                is_locked,
                lock_reason,
            });
            is_first = false;
        }
    }

    entries
}

// ── Preview operations (merge-based preview) ─────────────────────────────────
// 다른 branch의 변경사항을 임시 머지하여 dev 서버 핫리로드로 미리보기한다.
// stop_preview로 깔끔하게 원복한다.

impl GitCliEngine {
    /// Start previewing another branch by performing a no-commit merge.
    /// If the working tree is dirty, stashes changes first.
    pub async fn start_preview(&self, branch: &str) -> Result<(), AppError> {
        // 1. dirty 상태면 stash
        let status = self.run_local_checked(&["status", "--porcelain"]).await?;
        let was_dirty = !status.is_empty();
        if was_dirty {
            self.run_local_checked(&["stash", "push", "-m", "gitbaro-preview"]).await?;
        }

        // 2. no-commit merge
        let result = self.run_local(&["merge", "--no-commit", "--no-ff", branch]).await?;
        if !result.status.success() {
            // 머지 실패 시 abort 후 stash 복원
            let _ = self.run_local(&["merge", "--abort"]).await;
            if was_dirty {
                let _ = self.run_local(&["stash", "pop"]).await;
            }
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(AppError::GitCli {
                message: parse_git_error(&stderr),
                exit_code: result.status.code(),
            });
        }

        Ok(())
    }

    /// Stop an active preview by aborting the merge and restoring stash.
    pub async fn stop_preview(&self) -> Result<(), AppError> {
        // 1. merge abort
        self.run_local_checked(&["merge", "--abort"]).await?;

        // 2. gitbaro-preview stash가 있으면 pop
        let stash_list = self.run_local_checked(&["stash", "list"]).await?;
        if stash_list.contains("gitbaro-preview") {
            self.run_local_checked(&["stash", "pop"]).await?;
        }

        Ok(())
    }

    /// Check if a merge is currently in progress (.git/MERGE_HEAD exists).
    pub async fn is_merging(&self) -> Result<bool, AppError> {
        let git_dir = self.run_local_checked(&["rev-parse", "--git-dir"]).await?;
        let git_dir_path = {
            let p = PathBuf::from(&git_dir);
            if p.is_absolute() { p } else { self.repo_path.join(p) }
        };
        let merge_head = git_dir_path.join("MERGE_HEAD");
        Ok(merge_head.exists())
    }
}

// ── Remote operations (auth-aware) ──────────────────────────────────────────

impl GitRemoteEngine for GitCliEngine {
    async fn clone_repo(&self, url: &str, path: &Path, token: &str) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;
        let path_str = path.to_string_lossy().into_owned();
        let args = ["-c", "credential.helper=", "clone", "--", url, &path_str];

        tracing::info!("[git] git {}", args.join(" "));

        let output = Command::new("git")
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }

    async fn fetch(&self, remote: &str, token: &str) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;
        let args = ["-c", "credential.helper=", "fetch", "--prune", remote];

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }

    async fn push(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        force: bool,
    ) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

        let mut args = vec!["-c", "credential.helper=", "push"];
        if force {
            args.push("--force");
        }
        args.push(remote);
        args.push(&refspec);

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }

    async fn pull(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        rebase: bool,
    ) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;

        let mut args = vec!["-c", "credential.helper=", "pull"];
        if rebase {
            args.push("--rebase");
        }
        args.push(remote);
        args.push(branch);

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }
}

// ── GIT_ASKPASS helper ────────────────────────────────────────────────────────

/// Temporary GIT_ASKPASS script that provides OAuth credentials.
///
/// Modeled after GitHub Desktop's credential approach:
/// - Uses remote name (not URL) so git updates tracking refs automatically.
/// - Clears existing credential helpers (`-c credential.helper=`) to prevent
///   interference, then GIT_ASKPASS provides the token.
/// - Token never appears in process arguments (unlike URL embedding).
/// - Script is cleaned up on drop.
struct AskpassScript {
    path: PathBuf,
}

impl AskpassScript {
    async fn create(token: &str) -> Result<Self, AppError> {
        let path = std::env::temp_dir().join(format!(
            "gitbaro-askpass-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));

        // Git calls GIT_ASKPASS with a prompt like "Username for ..." or "Password for ...".
        let script = format!(
            "#!/bin/sh\ncase \"$1\" in\n*sername*) echo 'x-access-token' ;;\n*assword*) echo '{}' ;;\nesac",
            token
        );

        tokio::fs::write(&path, &script).await?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).await?;
        }

        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for AskpassScript {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/// Map an IO error from spawning git, detecting "not found" specially.
fn map_io_err(e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::GitCliNotFound
    } else {
        AppError::Io(e)
    }
}

/// Log stdout/stderr from a git command for debugging.
fn log_output(output: &std::process::Output) {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stdout.trim().is_empty() {
        tracing::info!("[git] stdout: {}", stdout.trim());
    }
    if !stderr.trim().is_empty() {
        if output.status.success() {
            tracing::info!("[git] stderr: {}", stderr.trim());
        } else {
            tracing::error!("[git] stderr: {}", stderr.trim());
        }
    }
    tracing::info!("[git] exit: {}", output.status);
}

/// Check command output and convert non-zero exit to `AppError::GitCli`.
fn check_output(output: std::process::Output) -> Result<(), AppError> {
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        Err(AppError::GitCli {
            message: parse_git_error(&stderr),
            exit_code: output.status.code(),
        })
    }
}

/// Strip "error: " / "fatal: " prefixes from git stderr output.
fn parse_git_error(stderr: &str) -> String {
    for line in stderr.lines() {
        let trimmed = line.trim();
        if let Some(msg) = trimmed.strip_prefix("error: ") {
            return msg.to_string();
        }
        if let Some(msg) = trimmed.strip_prefix("fatal: ") {
            return msg.to_string();
        }
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    stderr.trim().to_string()
}
