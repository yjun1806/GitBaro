use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

use crate::error::AppError;
use crate::events::{
    GitCommandCompleteEvent, GitCommandProgressEvent, GitCommandStartEvent, OperationSummary,
    GIT_COMMAND_COMPLETE, GIT_COMMAND_PROGRESS, GIT_COMMAND_START,
};
use crate::git::engine::GitRemoteEngine;
use crate::git::output_parser;

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
    pub is_dirty: bool,
}

pub struct GitCliEngine {
    pub repo_path: PathBuf,
    app_handle: Option<tauri::AppHandle>,
}

impl GitCliEngine {
    pub fn new(repo_path: &Path) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
            app_handle: None,
        }
    }

    pub fn with_app_handle(repo_path: impl Into<PathBuf>, app_handle: tauri::AppHandle) -> Self {
        Self {
            repo_path: repo_path.into(),
            app_handle: Some(app_handle),
        }
    }
}

// ── Local operations (hooks-aware) ──────────────────────────────────────────
// commit, switch_branch, stash 등 hooks가 실행되어야 하는 작업은
// git2 대신 git CLI를 통해 실행한다.

impl GitCliEngine {
    fn emit_command_start(&self, id: &str, args: &[&str], operation: &str, started_at: i64) {
        if let Some(handle) = &self.app_handle {
            let _ = handle.emit(
                GIT_COMMAND_START,
                GitCommandStartEvent {
                    id: id.to_string(),
                    command: format!("git {}", args.join(" ")),
                    operation: operation.to_string(),
                    repo_path: self.repo_path.to_string_lossy().to_string(),
                    started_at,
                },
            );
        }
    }

    fn emit_command_complete(
        &self,
        id: &str,
        operation: &str,
        output: &std::process::Output,
        duration_ms: u64,
        summary: Option<OperationSummary>,
    ) {
        if let Some(handle) = &self.app_handle {
            let _ = handle.emit(
                GIT_COMMAND_COMPLETE,
                GitCommandCompleteEvent {
                    id: id.to_string(),
                    operation: operation.to_string(),
                    success: output.status.success(),
                    duration_ms,
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    exit_code: output.status.code(),
                    result_summary: summary,
                },
            );
        }
    }

    fn emit_progress(&self, id: &str, operation: &str, message: &str, percent: Option<u32>) {
        if let Some(handle) = &self.app_handle {
            let _ = handle.emit(
                GIT_COMMAND_PROGRESS,
                GitCommandProgressEvent {
                    id: id.to_string(),
                    operation: operation.to_string(),
                    message: message.to_string(),
                    percent,
                },
            );
        }
    }

    /// Run a local git command (no auth needed, hooks will execute).
    async fn run_local(&self, args: &[&str]) -> Result<std::process::Output, AppError> {
        let operation = args.first().copied().unwrap_or("unknown");
        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();

        tracing::info!(
            "[git] git {} (cwd: {})",
            args.join(" "),
            self.repo_path.display()
        );

        self.emit_command_start(&id, args, operation, started_at);

        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);

        let duration_ms = start.elapsed().as_millis() as u64;
        self.emit_command_complete(&id, operation, &output, duration_ms, None);

        Ok(output)
    }

    /// Run a local git command with extra environment variables (e.g. committer
    /// identity). Emits start/complete events like `run_local`.
    async fn run_local_with_env(
        &self,
        args: &[&str],
        envs: &[(&str, String)],
    ) -> Result<std::process::Output, AppError> {
        let operation = args.first().copied().unwrap_or("unknown");
        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();

        tracing::info!(
            "[git] git {} (cwd: {})",
            args.join(" "),
            self.repo_path.display()
        );

        self.emit_command_start(&id, args, operation, started_at);

        let mut cmd = Command::new("git");
        cmd.args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0");
        for (key, value) in envs {
            cmd.env(*key, value.as_str());
        }
        let output = cmd.output().await.map_err(map_io_err)?;

        log_output(&output);

        let duration_ms = start.elapsed().as_millis() as u64;
        self.emit_command_complete(&id, operation, &output, duration_ms, None);

        Ok(output)
    }

    /// Run a local git command with a custom summary builder, emitting a richer event.
    async fn run_local_with_summary<F>(
        &self,
        args: &[&str],
        summary_fn: F,
    ) -> Result<std::process::Output, AppError>
    where
        F: FnOnce(&std::process::Output) -> Option<OperationSummary>,
    {
        let operation = args.first().copied().unwrap_or("unknown");
        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();

        tracing::info!(
            "[git] git {} (cwd: {})",
            args.join(" "),
            self.repo_path.display()
        );

        self.emit_command_start(&id, args, operation, started_at);

        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);

        let duration_ms = start.elapsed().as_millis() as u64;
        let summary = summary_fn(&output);
        self.emit_command_complete(&id, operation, &output, duration_ms, summary);

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

    /// Fast-forward a local branch to `target_oid` via `git branch -f`.
    /// git refuses to move a branch that is checked out in any worktree, so
    /// such branches are safely skipped (surfaced as an error for the caller to
    /// log). Runs no hooks and does not touch any working tree.
    pub async fn fast_forward_branch(&self, name: &str, target_oid: &str) -> Result<(), AppError> {
        self.run_local_checked(&["branch", "-f", name, target_oid]).await?;
        Ok(())
    }

    /// Create a commit via git CLI so that hooks (pre-commit, commit-msg, post-commit) run.
    ///
    /// When an `author` is provided (per-repository GitHub account), both the
    /// author *and* committer identity are set to that account. `--author` alone
    /// only sets the author; the committer field would otherwise fall back to the
    /// global `git config user.*`, leaking the global identity into GitHub — which
    /// defeats GitBaro's per-repo account isolation. GitHub Desktop sets the
    /// `GIT_COMMITTER_*` environment variables for exactly this reason.
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
        let mut envs: Vec<(&str, String)> = Vec::new();
        if let Some((name, email)) = author {
            author_str = format!("{} <{}>", name, email);
            args.push("--author");
            args.push(&author_str);
            envs.push(("GIT_COMMITTER_NAME", name.to_string()));
            envs.push(("GIT_COMMITTER_EMAIL", email.to_string()));
        }
        let output = self.run_local_with_env(&args, &envs).await?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::GitCli {
                message: parse_git_error(&stderr),
                exit_code: output.status.code(),
            });
        }
        self.run_local_checked(&["rev-parse", "HEAD"]).await
    }

    /// Discard working-tree changes for specific paths via git CLI.
    /// Restores the given paths from the index (`git checkout -- <paths>`).
    pub async fn discard_paths(&self, paths: &[String]) -> Result<(), AppError> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut args = vec!["checkout", "--"];
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(path_refs);
        self.run_local_checked(&args).await?;
        Ok(())
    }

    /// Switch branch via git CLI so that post-checkout hook runs.
    pub async fn switch_branch(&self, name: &str) -> Result<(), AppError> {
        // NOTE: `--` cannot be used here — `git checkout -- <name>` restores a
        // pathspec instead of switching branch. `validate_branch_name` rejects
        // leading '-' and other option-injection characters instead.
        crate::git::branch::validate_branch_name(name)?;
        self.run_local_checked(&["checkout", name]).await?;
        Ok(())
    }

    /// Check out a remote-tracking branch by creating a local branch that
    /// tracks it, mirroring GitHub Desktop:
    ///   git checkout <start_point> -b <local_name> --
    /// Branching from a remote-tracking start point makes git set the upstream
    /// automatically, so the branch lands in a synced (not "publishable") state.
    /// `start_point` comes from the branch list (a real remote ref), not user
    /// input, so only the new local name is validated for option injection.
    pub async fn checkout_tracking_branch(
        &self,
        start_point: &str,
        local_name: &str,
    ) -> Result<(), AppError> {
        crate::git::branch::validate_branch_name(local_name)?;
        self.run_local_checked(&["checkout", start_point, "-b", local_name, "--"])
            .await?;
        Ok(())
    }

    /// Check out a specific commit as a detached HEAD. Runs post-checkout hook.
    /// `oid` must be a validated hex commit id (see `validate_commit_oid`), so no
    /// `--` separator is needed to guard against option injection.
    pub async fn checkout_commit(&self, oid: &str) -> Result<(), AppError> {
        self.run_local_checked(&["checkout", oid]).await?;
        Ok(())
    }

    /// Move HEAD (and optionally index/working tree) to `oid`.
    /// `mode` is one of "soft" | "mixed" | "hard"; unknown values fall back to
    /// "mixed" (git's default). `oid` must be a validated hex commit id.
    pub async fn reset_to_commit(&self, oid: &str, mode: &str) -> Result<(), AppError> {
        let flag = match mode {
            "soft" => "--soft",
            "hard" => "--hard",
            _ => "--mixed",
        };
        self.run_local_checked(&["reset", flag, oid]).await?;
        Ok(())
    }

    /// Create a new commit that undoes `oid`. `--no-edit` keeps the default
    /// revert message. `oid` must be a validated hex commit id.
    pub async fn revert_commit(&self, oid: &str) -> Result<(), AppError> {
        self.run_local_checked(&["revert", "--no-edit", oid]).await?;
        Ok(())
    }

    /// Apply the changes introduced by `oid` on top of the current branch.
    /// `oid` must be a validated hex commit id.
    pub async fn cherry_pick_commit(&self, oid: &str) -> Result<(), AppError> {
        self.run_local_checked(&["cherry-pick", oid]).await?;
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

    /// Apply a stash entry by index without removing it.
    pub async fn stash_apply(&self, index: usize) -> Result<(), AppError> {
        let ref_str = crate::git::stash::stash_ref(index);
        self.run_local_checked(&["stash", "apply", &ref_str]).await?;
        Ok(())
    }

    /// Drop (delete) a stash entry by index.
    pub async fn stash_drop(&self, index: usize) -> Result<(), AppError> {
        let ref_str = crate::git::stash::stash_ref(index);
        self.run_local_checked(&["stash", "drop", &ref_str]).await?;
        Ok(())
    }

    /// Pop a stash entry by index (apply + drop).
    pub async fn stash_pop_index(&self, index: usize) -> Result<(), AppError> {
        let ref_str = crate::git::stash::stash_ref(index);
        self.run_local_checked(&["stash", "pop", &ref_str]).await?;
        Ok(())
    }

    /// Stash only specific paths (partial stash).
    pub async fn stash_push_paths(
        &self,
        message: Option<&str>,
        paths: &[String],
    ) -> Result<(), AppError> {
        let mut args = vec!["stash", "push"];
        if let Some(msg) = message {
            args.push("-m");
            args.push(msg);
        }
        args.push("--");
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(path_refs);
        self.run_local_checked(&args).await?;
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
        let output = self.run_local_with_summary(&args, |out| {
            let stdout = String::from_utf8_lossy(&out.stdout);
            output_parser::parse_merge_output(&stdout, branch)
        })
        .await?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(AppError::GitCli {
                message: parse_git_error(&stderr),
                exit_code: output.status.code(),
            })
        }
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

    /// Rename a branch via git CLI.
    pub async fn rename_branch(&self, old_name: &str, new_name: &str) -> Result<(), AppError> {
        crate::git::branch::validate_branch_name(old_name)?;
        crate::git::branch::validate_branch_name(new_name)?;
        self.run_local_checked(&["branch", "-m", old_name, new_name]).await?;
        Ok(())
    }

    /// Abort an in-progress merge (`git merge --abort`), restoring the pre-merge state.
    pub async fn merge_abort(&self) -> Result<(), AppError> {
        self.run_local_checked(&["merge", "--abort"]).await?;
        Ok(())
    }

    /// Continue an in-progress merge after conflicts are resolved and staged.
    /// Commits the merge without opening an editor.
    pub async fn merge_continue(&self) -> Result<(), AppError> {
        self.run_local_checked(&["commit", "--no-edit"]).await?;
        Ok(())
    }

    /// Abort an in-progress rebase (`git rebase --abort`).
    pub async fn rebase_abort(&self) -> Result<(), AppError> {
        self.run_local_checked(&["rebase", "--abort"]).await?;
        Ok(())
    }

    /// Continue an in-progress rebase after conflicts are resolved and staged.
    pub async fn rebase_continue(&self) -> Result<(), AppError> {
        // -c core.editor=true prevents git from opening an interactive editor.
        self.run_local_checked(&["-c", "core.editor=true", "rebase", "--continue"])
            .await?;
        Ok(())
    }

    /// Report whether a merge or rebase is in progress by checking for the
    /// marker files git creates in the git dir.
    pub async fn operation_in_progress(&self) -> Result<Option<&'static str>, AppError> {
        let git_dir = self.run_local_checked(&["rev-parse", "--git-dir"]).await?;
        let git_dir_path = {
            let p = PathBuf::from(&git_dir);
            if p.is_absolute() { p } else { self.repo_path.join(p) }
        };
        if git_dir_path.join("MERGE_HEAD").exists() {
            Ok(Some("merge"))
        } else if git_dir_path.join("rebase-merge").exists()
            || git_dir_path.join("rebase-apply").exists()
        {
            Ok(Some("rebase"))
        } else {
            Ok(None)
        }
    }

    /// Get recently checked-out branches from reflog.
    pub async fn get_reflog_branches(&self, limit: usize) -> Result<Vec<String>, AppError> {
        let output = self.run_local_checked(&["reflog", "show", "--format=%gs", "-n", "200"]).await?;
        let mut seen = std::collections::HashSet::new();
        let mut result = Vec::new();

        for line in output.lines() {
            // Match "checkout: moving from X to Y"
            if let Some(rest) = line.strip_prefix("checkout: moving from ") {
                if let Some(idx) = rest.find(" to ") {
                    let target = &rest[idx + 4..];
                    let target = target.trim();
                    if !target.is_empty() && seen.insert(target.to_string()) {
                        result.push(target.to_string());
                        if result.len() >= limit {
                            break;
                        }
                    }
                }
            }
        }

        // Filter out branches that no longer exist
        let existing_output = self.run_local_checked(&["branch", "--format=%(refname:short)"]).await
            .unwrap_or_default();
        let existing: std::collections::HashSet<&str> = existing_output.lines().collect();
        result.retain(|name| existing.contains(name.as_str()));

        Ok(result)
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
        base_branch: Option<&str>,
    ) -> Result<(), AppError> {
        let mut args = vec!["worktree", "add"];
        let nb_flag;
        if let Some(nb) = new_branch {
            nb_flag = nb.to_string();
            args.push("-b");
            args.push(&nb_flag);
        }
        // `--` ends option parsing so a path/branch beginning with `-` cannot be
        // interpreted as a flag.
        args.push("--");
        args.push(path);
        if let Some(base) = base_branch {
            args.push(base);
        } else if let Some(b) = branch {
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
        args.push("--");
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
                is_dirty: false,
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

impl GitCliEngine {
    /// 원격 작업을 spawn + stderr 스트리밍으로 실행.
    /// app_handle이 None이면 기존 .output() 방식으로 폴백한다.
    async fn run_remote_with_progress(
        &self,
        cmd: &mut Command,
        id: &str,
        operation: &str,
    ) -> Result<std::process::Output, AppError> {
        if self.app_handle.is_none() {
            return cmd.output().await.map_err(map_io_err);
        }

        cmd.stderr(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(map_io_err)?;

        let stderr_handle = child.stderr.take();
        let collected_stderr = Arc::new(Mutex::new(Vec::<String>::new()));
        let stderr_clone = Arc::clone(&collected_stderr);
        let self_id = id.to_string();
        let self_op = operation.to_string();
        let app_handle = self.app_handle.clone();
        let repo_path = self.repo_path.clone();

        let stderr_task = tokio::spawn(async move {
            if let Some(stderr) = stderr_handle {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();

                let temp_engine = GitCliEngine {
                    repo_path,
                    app_handle,
                };

                while let Ok(Some(line)) = lines.next_line().await {
                    let segments: Vec<&str> = line.split('\r').collect();
                    let last_segment = segments.last().copied().unwrap_or("").trim();

                    if last_segment.is_empty() {
                        continue;
                    }

                    stderr_clone.lock().unwrap().push(last_segment.to_string());

                    // Parse percent: "Receiving objects: 45% (123/273)"
                    let percent = last_segment.find('%').and_then(|pos| {
                        let before = &last_segment[..pos];
                        before
                            .rsplit(|c: char| !c.is_ascii_digit())
                            .next()
                            .and_then(|n| n.parse::<u32>().ok())
                    });

                    temp_engine.emit_progress(&self_id, &self_op, last_segment, percent);
                }
            }
        });

        let output = child.wait_with_output().await.map_err(map_io_err)?;
        let _ = stderr_task.await;

        let collected = collected_stderr.lock().unwrap();
        let mut final_output = output;
        if !collected.is_empty() {
            final_output.stderr = collected.join("\n").into_bytes();
        }

        Ok(final_output)
    }
}

impl GitRemoteEngine for GitCliEngine {
    async fn clone_repo(&self, url: &str, path: &Path, token: &str) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;
        let path_str = path.to_string_lossy().into_owned();
        let args = [
            "-c",
            "credential.helper=",
            "-c",
            "protocol.ext.allow=never",
            "clone",
            "--",
            url,
            &path_str,
        ];

        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();
        let display_args = ["clone", "--", url, &path_str];

        tracing::info!("[git] git {}", args.join(" "));
        self.emit_command_start(&id, &display_args, "clone", started_at);

        let mut cmd = Command::new("git");
        cmd.args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path());
        let output = self.run_remote_with_progress(&mut cmd, &id, "clone").await?;

        log_output(&output);
        let duration_ms = start.elapsed().as_millis() as u64;
        self.emit_command_complete(&id, "clone", &output, duration_ms, None);
        check_output(output)
    }

    async fn fetch(&self, remote: &str, token: &str) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;
        let args = ["-c", "credential.helper=", "fetch", "--prune", remote];

        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();
        let display_args = ["fetch", "--prune", remote];

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());
        self.emit_command_start(&id, &display_args, "fetch", started_at);

        let mut cmd = Command::new("git");
        cmd.args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path());
        let output = self.run_remote_with_progress(&mut cmd, &id, "fetch").await?;

        log_output(&output);
        let duration_ms = start.elapsed().as_millis() as u64;
        let summary = output_parser::parse_fetch_output(&String::from_utf8_lossy(&output.stderr));
        self.emit_command_complete(&id, "fetch", &output, duration_ms, summary);
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

        let mut args = vec!["-c", "credential.helper=", "push", "--set-upstream"];
        if force {
            // --force-with-lease refuses to overwrite remote work the local repo
            // hasn't seen, unlike the blunt --force. Matches GitHub Desktop.
            args.push("--force-with-lease");
        }
        args.push(remote);
        args.push(branch);

        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();
        let mut display_args = vec!["push", "--set-upstream"];
        if force {
            display_args.push("--force-with-lease");
        }
        display_args.push(remote);
        display_args.push(branch);

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());
        self.emit_command_start(&id, &display_args, "push", started_at);

        let mut cmd = Command::new("git");
        cmd.args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path());
        let output = self.run_remote_with_progress(&mut cmd, &id, "push").await?;

        log_output(&output);
        let duration_ms = start.elapsed().as_millis() as u64;
        let summary = output_parser::parse_push_output(
            &String::from_utf8_lossy(&output.stderr),
            branch,
            remote,
        );
        self.emit_command_complete(&id, "push", &output, duration_ms, summary);
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

        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();
        let mut display_args = vec!["pull"];
        if rebase {
            display_args.push("--rebase");
        }
        display_args.push(remote);
        display_args.push(branch);

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());
        self.emit_command_start(&id, &display_args, "pull", started_at);

        let mut cmd = Command::new("git");
        cmd.args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path());
        let output = self.run_remote_with_progress(&mut cmd, &id, "pull").await?;

        log_output(&output);
        let duration_ms = start.elapsed().as_millis() as u64;
        let summary = output_parser::parse_pull_output(
            &String::from_utf8_lossy(&output.stdout),
            &String::from_utf8_lossy(&output.stderr),
        );
        self.emit_command_complete(&id, "pull", &output, duration_ms, summary);
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

        // Create the file with owner-only permissions BEFORE writing the token,
        // so there is never a window where the token-bearing script is
        // world/group-readable (avoids the write-then-chmod TOCTOU).
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let path_clone = path.clone();
            let script_bytes = script.into_bytes();
            tokio::task::spawn_blocking(move || {
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o700)
                    .open(&path_clone)?;
                file.write_all(&script_bytes)
            })
            .await
            .map_err(|e| AppError::Channel(e.to_string()))??;
        }
        #[cfg(not(unix))]
        {
            tokio::fs::write(&path, &script).await?;
        }

        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }

}

/// Best-effort cleanup of stale askpass scripts left behind by a previous
/// process that was force-killed before `Drop` could run. Called once at
/// startup. Only removes files in the per-user temp dir matching our prefix and
/// NOT belonging to the current process.
pub(crate) fn sweep_stale_askpass() {
    let current_pid = std::process::id().to_string();
    let prefix = "gitbaro-askpass-";
    let dir = std::env::temp_dir();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if let Some(rest) = name.strip_prefix(prefix) {
                // rest = "<pid>-<nanos>"; skip files owned by this process.
                let file_pid = rest.split('-').next().unwrap_or("");
                if file_pid != current_pid {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
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
pub(crate) fn parse_git_error(stderr: &str) -> String {
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
