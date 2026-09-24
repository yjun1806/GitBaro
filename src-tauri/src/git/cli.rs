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
    /// 작업 디렉토리가 사라진 워크트리. git은 `git worktree prune` 전까지
    /// 관리 파일을 남겨두므로 목록에는 계속 나타난다. 실제로는 쓸 수 없다.
    pub is_prunable: bool,
}

pub struct GitCliEngine {
    pub repo_path: PathBuf,
    app_handle: Option<tauri::AppHandle>,
    /// 사용자가 직접 실행한 작업이 아니라 앱이 주기적으로 도는 작업인지.
    /// 프론트엔드는 이 값을 보고 성공한 자동 작업을 활동 로그에서 제외한다.
    automatic: bool,
}

impl GitCliEngine {
    pub fn new(repo_path: &Path) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
            app_handle: None,
            automatic: false,
        }
    }

    pub fn with_app_handle(repo_path: impl Into<PathBuf>, app_handle: tauri::AppHandle) -> Self {
        Self {
            repo_path: repo_path.into(),
            app_handle: Some(app_handle),
            automatic: false,
        }
    }

    /// 이 엔진이 실행하는 작업을 자동 작업으로 표시한다.
    pub fn with_automatic(mut self, automatic: bool) -> Self {
        self.automatic = automatic;
        self
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
                    automatic: self.automatic,
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

    /// 명령이 출력을 남기지 못하고 실패했을 때(프로세스 spawn 실패, IO 오류 등)
    /// 완료 이벤트를 발행한다. 이걸 빠뜨리면 프론트엔드의 진행 중 목록에 항목이
    /// 영원히 남아 동기화 표시가 멈추지 않는다.
    fn emit_command_aborted(&self, id: &str, operation: &str, error: &AppError, duration_ms: u64) {
        if let Some(handle) = &self.app_handle {
            let _ = handle.emit(
                GIT_COMMAND_COMPLETE,
                GitCommandCompleteEvent {
                    id: id.to_string(),
                    operation: operation.to_string(),
                    success: false,
                    duration_ms,
                    stdout: String::new(),
                    stderr: error.to_string(),
                    exit_code: None,
                    result_summary: None,
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

    /// Absolute path of this worktree's git dir (where MERGE_HEAD etc. live).
    async fn git_dir(&self) -> Result<PathBuf, AppError> {
        let git_dir = self.run_local_checked(&["rev-parse", "--git-dir"]).await?;
        let p = PathBuf::from(&git_dir);
        Ok(if p.is_absolute() { p } else { self.repo_path.join(p) })
    }

    /// Report which multi-step operation is in progress by checking for the
    /// marker files git creates in the git dir.
    pub async fn operation_in_progress(&self) -> Result<Option<GitOperation>, AppError> {
        Ok(detect_operation(&self.git_dir().await?))
    }

    /// Abort the given operation, restoring the pre-operation state.
    pub async fn operation_abort(&self, op: GitOperation) -> Result<(), AppError> {
        match op {
            GitOperation::Merge => self.merge_abort().await,
            GitOperation::Rebase => self.rebase_abort().await,
            GitOperation::CherryPick => {
                self.run_local_checked(&["cherry-pick", "--abort"]).await?;
                Ok(())
            }
            GitOperation::Revert => {
                self.run_local_checked(&["revert", "--abort"]).await?;
                Ok(())
            }
            // A squash merge leaves no MERGE_HEAD, so `merge --abort` refuses.
            // `reset --merge` is what `merge --abort` runs under the hood; it
            // also clears SQUASH_MSG.
            GitOperation::Squash => {
                self.run_local_checked(&["reset", "--merge"]).await?;
                Ok(())
            }
        }
    }

    /// Continue the given operation after conflicts are resolved and staged.
    pub async fn operation_continue(&self, op: GitOperation) -> Result<(), AppError> {
        match op {
            // A squash is concluded the same way as a merge: commit with the
            // prepared message (SQUASH_MSG).
            GitOperation::Merge | GitOperation::Squash => self.merge_continue().await,
            GitOperation::Rebase => self.rebase_continue().await,
            GitOperation::CherryPick => {
                self.run_local_checked(&["-c", "core.editor=true", "cherry-pick", "--continue"])
                    .await?;
                Ok(())
            }
            GitOperation::Revert => {
                self.run_local_checked(&["-c", "core.editor=true", "revert", "--continue"])
                    .await?;
                Ok(())
            }
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
///   prunable [<reason>]  (optional — 작업 디렉토리가 사라진 경우)
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
        let mut is_prunable = false;

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
            } else if line == "prunable" || line.starts_with("prunable ") {
                is_prunable = true;
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
                is_prunable,
            });
            is_first = false;
        }
    }

    entries
}

// ── Multi-step operation state ───────────────────────────────────────────────

/// A multi-step git operation that stops for conflict resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitOperation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Squash,
}

/// Read the operation state from the marker files in `git_dir`.
fn detect_operation(git_dir: &Path) -> Option<GitOperation> {
    let has = |name: &str| git_dir.join(name).exists();
    if has("rebase-merge") || has("rebase-apply") {
        Some(GitOperation::Rebase)
    } else if has("MERGE_HEAD") {
        Some(GitOperation::Merge)
    } else if has("CHERRY_PICK_HEAD") {
        Some(GitOperation::CherryPick)
    } else if has("REVERT_HEAD") {
        Some(GitOperation::Revert)
    } else if has("SQUASH_MSG") {
        // `merge --squash` writes SQUASH_MSG and no MERGE_HEAD; git removes
        // it when the squash is committed or reset away.
        Some(GitOperation::Squash)
    } else {
        None
    }
}

// ── Preview operations (merge-based preview) ─────────────────────────────────
// 다른 branch의 변경사항을 임시 머지하여 dev 서버 핫리로드로 미리보기한다.
// stop_preview로 깔끔하게 원복한다.
//
// 미리보기 여부는 git dir의 표식 파일(PREVIEW_MARKER)로만 판단한다. MERGE_HEAD만
// 보고 판단하면 사용자가 직접 진행 중인 merge를 미리보기 잔여물로 오인해 중단한다.
// 표식에는 미리보기가 만든 MERGE_HEAD와 스태시 oid를 적어, 정리할 때 그 둘만 건드린다.

const PREVIEW_MARKER: &str = "gitbaro-preview";

/// Contents of the preview marker file.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewMarker {
    merge_head: String,
    stash_oid: Option<String>,
}

impl PreviewMarker {
    fn to_file_contents(&self) -> String {
        format!(
            "{}\n{}\n",
            self.merge_head,
            self.stash_oid.as_deref().unwrap_or("")
        )
    }

    fn from_file_contents(contents: &str) -> Option<Self> {
        let mut lines = contents.lines().map(str::trim);
        let merge_head = lines.next().filter(|l| !l.is_empty())?.to_string();
        let stash_oid = lines.next().filter(|l| !l.is_empty()).map(String::from);
        Some(Self { merge_head, stash_oid })
    }
}

impl GitCliEngine {
    /// Current `refs/stash` oid, if any stash exists.
    async fn stash_top_oid(&self) -> Result<Option<String>, AppError> {
        let out = self
            .run_local(&["rev-parse", "--verify", "-q", "refs/stash"])
            .await?;
        let oid = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok((out.status.success() && !oid.is_empty()).then_some(oid))
    }

    /// Pop the stash entry whose commit is `oid` (not whatever is on top).
    /// Returns false when that entry no longer exists.
    async fn stash_pop_oid(&self, oid: &str) -> Result<bool, AppError> {
        let list = self.run_local_checked(&["stash", "list", "--format=%H"]).await?;
        let Some(index) = list.lines().position(|l| l.trim() == oid) else {
            return Ok(false);
        };
        let entry = format!("stash@{{{}}}", index);
        self.run_local_checked(&["stash", "pop", &entry]).await?;
        Ok(true)
    }

    /// Start previewing another branch by performing a no-commit merge.
    /// Local changes (including untracked files) are stashed first.
    /// Returns false when there is nothing to preview (already up to date);
    /// in that case the working tree is left as it was.
    pub async fn start_preview(&self, branch: &str) -> Result<bool, AppError> {
        let git_dir = self.git_dir().await?;
        if detect_operation(&git_dir).is_some() || git_dir.join(PREVIEW_MARKER).exists() {
            return Err(AppError::GitCli {
                message: "Another operation is in progress".to_string(),
                exit_code: None,
            });
        }

        // 1. dirty 상태면 스태시하고, 새로 생긴 스태시의 oid를 기록한다.
        let status = self.run_local_checked(&["status", "--porcelain"]).await?;
        let stash_oid = if status.is_empty() {
            None
        } else {
            let before = self.stash_top_oid().await?;
            self.run_local_checked(&["stash", "push", "-u", "-m", "gitbaro-preview"])
                .await?;
            let after = self.stash_top_oid().await?;
            if after.is_none() || after == before {
                return Err(AppError::GitCli {
                    message: "Failed to stash local changes".to_string(),
                    exit_code: None,
                });
            }
            after
        };
        let restore_stash = || async {
            if let Some(oid) = &stash_oid {
                let _ = self.stash_pop_oid(oid).await;
            }
        };

        // 2. no-commit merge
        let result = self
            .run_local(&["merge", "--no-commit", "--no-ff", "--", branch])
            .await?;
        if !result.status.success() {
            // 방금 시작한 merge만 되돌린다 (시작 전엔 진행 중인 작업이 없음을 확인했다).
            if git_dir.join("MERGE_HEAD").exists() {
                let _ = self.run_local(&["merge", "--abort"]).await;
            }
            restore_stash().await;
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(AppError::GitCli {
                message: parse_git_error(&stderr),
                exit_code: result.status.code(),
            });
        }

        // "Already up to date": merge가 시작되지 않았으니 미리보기도 없다.
        let merge_head = std::fs::read_to_string(git_dir.join("MERGE_HEAD")).ok();
        let Some(merge_head) = merge_head.map(|h| h.trim().to_string()) else {
            restore_stash().await;
            return Ok(false);
        };

        let marker = PreviewMarker { merge_head, stash_oid };
        std::fs::write(git_dir.join(PREVIEW_MARKER), marker.to_file_contents())?;
        Ok(true)
    }

    /// Stop an active preview: abort the preview merge and restore the exact
    /// stash it created. Does nothing when no preview marker exists, and never
    /// aborts a merge that the preview did not start.
    pub async fn stop_preview(&self) -> Result<(), AppError> {
        let git_dir = self.git_dir().await?;
        let marker_path = git_dir.join(PREVIEW_MARKER);
        let Ok(contents) = std::fs::read_to_string(&marker_path) else {
            return Ok(());
        };
        let Some(marker) = PreviewMarker::from_file_contents(&contents) else {
            std::fs::remove_file(&marker_path)?;
            return Ok(());
        };

        let current_merge_head = std::fs::read_to_string(git_dir.join("MERGE_HEAD"))
            .ok()
            .map(|h| h.trim().to_string());
        match current_merge_head {
            Some(head) if head == marker.merge_head => {
                self.run_local_checked(&["merge", "--abort"]).await?;
            }
            // 사용자가 시작한 다른 merge가 진행 중이면 건드리지 않는다.
            // 미리보기 스태시는 스태시 목록에 그대로 남는다.
            Some(_) => {
                std::fs::remove_file(&marker_path)?;
                return Ok(());
            }
            // 미리보기 merge가 이미 끝났다(중단·커밋). 스태시만 복원한다.
            None => {}
        }

        if let Some(oid) = &marker.stash_oid {
            if detect_operation(&git_dir).is_none() {
                self.stash_pop_oid(oid).await?;
            }
        }
        std::fs::remove_file(&marker_path)?;
        Ok(())
    }

    /// Whether a preview started by GitBaro is active (the marker exists).
    pub async fn is_previewing(&self) -> Result<bool, AppError> {
        Ok(self.git_dir().await?.join(PREVIEW_MARKER).exists())
    }
}

#[cfg(test)]
mod operation_tests {
    use super::*;
    use std::process::Command as StdCommand;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    struct TempRepo(PathBuf);

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = StdCommand::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// git이 실패해도 되는 명령(충돌을 일으키는 merge 등).
    fn git_may_fail(dir: &Path, args: &[&str]) {
        let _ = StdCommand::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output();
    }

    fn write(dir: &Path, name: &str, contents: &str) {
        std::fs::write(dir.join(name), contents).unwrap();
    }

    /// main에 a.txt, `feature` 브랜치에서 a.txt를 다르게 고친 저장소.
    /// main도 a.txt를 고쳐 두어 merge하면 충돌이 난다.
    fn conflicting_repo() -> TempRepo {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir()
            .join(format!("gitbaro-op-{}-{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "t@t"]);
        git(&dir, &["config", "user.name", "t"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);
        write(&dir, "a.txt", "base\n");
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);
        git(&dir, &["checkout", "-qb", "feature"]);
        write(&dir, "a.txt", "feature\n");
        git(&dir, &["commit", "-qam", "feature change"]);
        git(&dir, &["checkout", "-q", "main"]);
        write(&dir, "a.txt", "main\n");
        git(&dir, &["commit", "-qam", "main change"]);
        TempRepo(dir)
    }

    fn head(dir: &Path) -> String {
        git(dir, &["rev-parse", "HEAD"])
    }

    #[tokio::test]
    async fn user_merge_is_not_mistaken_for_a_preview() {
        let repo = conflicting_repo();
        git_may_fail(&repo.0, &["merge", "feature"]);
        assert!(repo.0.join(".git/MERGE_HEAD").exists());

        let engine = GitCliEngine::new(&repo.0);
        assert!(!engine.is_previewing().await.unwrap());
        engine.stop_preview().await.unwrap();

        assert!(repo.0.join(".git/MERGE_HEAD").exists(), "사용자 merge가 중단됨");
        assert_eq!(
            engine.operation_in_progress().await.unwrap(),
            Some(GitOperation::Merge)
        );
    }

    #[tokio::test]
    async fn preview_restores_its_own_stash_including_untracked_files() {
        let repo = conflicting_repo();
        // 미리보기와 무관한 기존 스태시
        write(&repo.0, "other.txt", "other\n");
        git(&repo.0, &["stash", "push", "-u", "-m", "user stash"]);
        // 충돌 없는 미리보기 대상 브랜치
        git(&repo.0, &["checkout", "-qb", "clean"]);
        write(&repo.0, "b.txt", "b\n");
        git(&repo.0, &["add", "b.txt"]);
        git(&repo.0, &["commit", "-qm", "add b"]);
        git(&repo.0, &["checkout", "-q", "main"]);
        // 미리보기 전 로컬 변경: 추적되지 않은 파일
        write(&repo.0, "wip.txt", "wip\n");
        let before = head(&repo.0);

        let engine = GitCliEngine::new(&repo.0);
        assert!(engine.start_preview("clean").await.unwrap());
        assert!(engine.is_previewing().await.unwrap());
        assert!(!repo.0.join("wip.txt").exists(), "untracked 파일도 스태시돼야 함");
        assert!(repo.0.join("b.txt").exists());

        engine.stop_preview().await.unwrap();
        assert!(!engine.is_previewing().await.unwrap());
        assert_eq!(head(&repo.0), before);
        assert!(!repo.0.join("b.txt").exists());
        assert_eq!(std::fs::read_to_string(repo.0.join("wip.txt")).unwrap(), "wip\n");
        let stashes = git(&repo.0, &["stash", "list", "--format=%s"]);
        assert_eq!(stashes.lines().count(), 1);
        assert!(stashes.contains("user stash"), "기존 스태시가 꺼내짐: {stashes}");
    }

    #[tokio::test]
    async fn already_up_to_date_is_not_a_preview() {
        let repo = conflicting_repo();
        write(&repo.0, "wip.txt", "wip\n");
        let engine = GitCliEngine::new(&repo.0);

        // main은 main~1을 이미 포함한다.
        assert!(!engine.start_preview("main~1").await.unwrap());
        assert!(!engine.is_previewing().await.unwrap());
        assert!(repo.0.join("wip.txt").exists());
        assert!(git(&repo.0, &["stash", "list"]).is_empty());
    }

    #[tokio::test]
    async fn preview_refuses_to_start_during_a_user_merge() {
        let repo = conflicting_repo();
        git_may_fail(&repo.0, &["merge", "feature"]);
        let engine = GitCliEngine::new(&repo.0);

        assert!(engine.start_preview("feature").await.is_err());
        assert!(repo.0.join(".git/MERGE_HEAD").exists());
    }

    #[tokio::test]
    async fn cherry_pick_conflict_is_detected_and_aborted() {
        let repo = conflicting_repo();
        let before = head(&repo.0);
        git_may_fail(&repo.0, &["cherry-pick", "feature"]);
        let engine = GitCliEngine::new(&repo.0);

        let op = engine.operation_in_progress().await.unwrap();
        assert_eq!(op, Some(GitOperation::CherryPick));
        engine.operation_abort(GitOperation::CherryPick).await.unwrap();
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
        assert_eq!(head(&repo.0), before);
    }

    #[tokio::test]
    async fn revert_conflict_is_detected_and_continued() {
        let repo = conflicting_repo();
        // main~1 ("init")을 되돌리면 이후 수정과 충돌한다.
        write(&repo.0, "a.txt", "main again\n");
        git(&repo.0, &["commit", "-qam", "main again"]);
        git_may_fail(&repo.0, &["revert", "--no-edit", "HEAD~1"]);
        let engine = GitCliEngine::new(&repo.0);

        assert_eq!(
            engine.operation_in_progress().await.unwrap(),
            Some(GitOperation::Revert)
        );
        write(&repo.0, "a.txt", "resolved\n");
        git(&repo.0, &["add", "a.txt"]);
        engine.operation_continue(GitOperation::Revert).await.unwrap();
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
    }

    #[tokio::test]
    async fn squash_conflict_is_detected_and_aborted() {
        let repo = conflicting_repo();
        let before = head(&repo.0);
        git_may_fail(&repo.0, &["merge", "--squash", "feature"]);
        let engine = GitCliEngine::new(&repo.0);

        assert_eq!(
            engine.operation_in_progress().await.unwrap(),
            Some(GitOperation::Squash)
        );
        engine.operation_abort(GitOperation::Squash).await.unwrap();
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
        assert_eq!(head(&repo.0), before);
        assert_eq!(std::fs::read_to_string(repo.0.join("a.txt")).unwrap(), "main\n");
    }

    #[test]
    fn preview_marker_round_trips() {
        let with_stash = PreviewMarker {
            merge_head: "abc".into(),
            stash_oid: Some("def".into()),
        };
        let without = PreviewMarker { merge_head: "abc".into(), stash_oid: None };
        for m in [with_stash, without] {
            assert_eq!(PreviewMarker::from_file_contents(&m.to_file_contents()), Some(m));
        }
        assert_eq!(PreviewMarker::from_file_contents(""), None);
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
        let automatic = self.automatic;

        let stderr_task = tokio::spawn(async move {
            if let Some(stderr) = stderr_handle {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();

                let temp_engine = GitCliEngine {
                    repo_path,
                    app_handle,
                    automatic,
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

    /// Best-effort dry-run push that enumerates local tags which would be newly
    /// created on the remote. Mirrors GitHub Desktop's `fetchTagsToPush`: it
    /// never mutates the remote (`--dry-run`) and parses porcelain output.
    ///
    /// On any failure (auth, network, unexpected exit) it returns an empty list
    /// so the real push still proceeds with the branch. When the token is stale,
    /// the caller retries the whole `push` with a fresh token, which re-runs this
    /// detection successfully.
    async fn detect_tags_to_push(&self, remote: &str, branch: &str, token: &str) -> Vec<String> {
        let askpass = match AskpassScript::create(token).await {
            Ok(a) => a,
            Err(e) => {
                tracing::warn!("[git] tag detection skipped (askpass): {}", e);
                return Vec::new();
            }
        };

        let args = [
            "-c",
            "credential.helper=",
            "push",
            remote,
            branch,
            "--follow-tags",
            "--dry-run",
            "--no-verify",
            "--porcelain",
        ];
        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let mut cmd = Command::new("git");
        cmd.args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            // Force stable, non-localized porcelain summaries (e.g. "[new tag]").
            .env("LC_ALL", "C");

        let output = match cmd.output().await {
            Ok(o) => o,
            Err(e) => {
                tracing::warn!("[git] tag detection failed to run: {}", e);
                return Vec::new();
            }
        };

        // git push exit codes: 0 = ok, 1 = some refs rejected (still parseable).
        // Anything else (e.g. 128 auth/network) means no reliable tag list.
        let code = output.status.code().unwrap_or(-1);
        if code != 0 && code != 1 {
            tracing::warn!(
                "[git] tag detection dry-run exited {} — pushing without tags. stderr: {}",
                code,
                String::from_utf8_lossy(&output.stderr).trim()
            );
            return Vec::new();
        }

        output_parser::parse_tags_to_push(&String::from_utf8_lossy(&output.stdout))
    }

    /// List tag names that exist on the remote (`git ls-remote --tags`). Used to
    /// distinguish local-only tags from pushed ones in the history timeline.
    /// Requires network + auth; the caller handles token-refresh retry.
    pub async fn list_remote_tags(
        &self,
        remote: &str,
        token: &str,
    ) -> Result<Vec<String>, AppError> {
        let askpass = AskpassScript::create(token).await?;
        let args = ["-c", "credential.helper=", "ls-remote", "--tags", remote];
        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let mut cmd = Command::new("git");
        cmd.args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path());
        let output = cmd.output().await.map_err(map_io_err)?;

        log_output(&output);
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        check_output(output)?;
        Ok(output_parser::parse_remote_tags(&stdout))
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
        // `?`로 곧장 반환하면 완료 이벤트가 발행되지 않아 진행 중 표시가 멈추지 않는다.
        // 자동 fetch는 성공 시 로그에 남지 않으므로 이 경우 추적할 단서도 사라진다.
        let output = match self.run_remote_with_progress(&mut cmd, &id, "fetch").await {
            Ok(output) => output,
            Err(e) => {
                self.emit_command_aborted(&id, "fetch", &e, start.elapsed().as_millis() as u64);
                return Err(e);
            }
        };

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
        // Enumerate the new tags this push should carry, like GitHub Desktop, then
        // name them explicitly. Never `--tags` (which blindly pushes every local tag).
        let tags = self.detect_tags_to_push(remote, branch, token).await;

        let askpass = AskpassScript::create(token).await?;

        let mut args = vec!["-c", "credential.helper=", "push", "--set-upstream"];
        if force {
            // --force-with-lease refuses to overwrite remote work the local repo
            // hasn't seen, unlike the blunt --force. Matches GitHub Desktop.
            args.push("--force-with-lease");
        }
        args.push(remote);
        args.push(branch);
        for tag in &tags {
            args.push(tag);
        }

        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();
        let mut display_args = vec!["push", "--set-upstream"];
        if force {
            display_args.push("--force-with-lease");
        }
        display_args.push(remote);
        display_args.push(branch);
        for tag in &tags {
            display_args.push(tag);
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    /// 실제 `git worktree list --porcelain` 출력. 작업 디렉토리를 지운 워크트리는
    /// 목록에서 사라지지 않고 `prunable` 라인이 붙어서 그대로 남는다.
    const PRUNABLE_OUTPUT: &str = "\
worktree /repos/alpha
HEAD 5f9d7f256d0204210a1f16bd3c43b7e907342968
branch refs/heads/main

worktree /repos/alpha-worktrees/feat
HEAD 5f9d7f256d0204210a1f16bd3c43b7e907342968
branch refs/heads/feat
prunable gitdir file points to non-existent location
";

    #[test]
    fn marks_worktree_with_missing_directory_as_prunable() {
        let entries = parse_worktree_porcelain(PRUNABLE_OUTPUT);

        assert_eq!(entries.len(), 2);
        assert!(!entries[0].is_prunable);
        assert!(entries[1].is_prunable);
        assert_eq!(entries[1].path, "/repos/alpha-worktrees/feat");
    }

    #[test]
    fn keeps_healthy_worktrees_unmarked() {
        let output = "\
worktree /repos/alpha
HEAD abc123
branch refs/heads/main

worktree /repos/alpha-worktrees/feat
HEAD def456
branch refs/heads/feat
";
        let entries = parse_worktree_porcelain(output);

        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|e| !e.is_prunable));
        assert!(entries[0].is_main);
        assert!(!entries[1].is_main);
    }

    /// 이유 없는 `prunable` 단독 라인도 git이 쓸 수 있다.
    #[test]
    fn accepts_bare_prunable_line() {
        let output = "worktree /repos/alpha-worktrees/feat\nHEAD abc123\ndetached\nprunable\n";
        let entries = parse_worktree_porcelain(output);

        assert_eq!(entries.len(), 1);
        assert!(entries[0].is_prunable);
        assert_eq!(entries[0].branch, None);
    }

    /// `locked`와 `prunable`은 서로 다른 상태다. 접두사가 겹치지 않는지 확인한다.
    #[test]
    fn distinguishes_locked_from_prunable() {
        let output = "worktree /repos/alpha-worktrees/feat\nHEAD abc123\nbranch refs/heads/feat\nlocked in use elsewhere\n";
        let entries = parse_worktree_porcelain(output);

        assert!(entries[0].is_locked);
        assert!(!entries[0].is_prunable);
        assert_eq!(entries[0].lock_reason.as_deref(), Some("in use elsewhere"));
    }
}
