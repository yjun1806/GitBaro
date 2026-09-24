use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::Emitter;
use tokio::io::AsyncReadExt;
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
    /// 저장소에 지정된 계정의 (이름, 이메일). 설정되면 이 엔진이 실행하는 모든
    /// 로컬 명령과 pull에 `GIT_AUTHOR_*`/`GIT_COMMITTER_*` 환경변수로 넘긴다.
    /// merge·revert·squash처럼 커밋을 만드는 명령이 전역 `user.*` 대신 이 계정으로
    /// 기록된다. rebase·cherry-pick은 원래 작성자를 그대로 두고 커미터만 바뀐다.
    identity: Option<(String, String)>,
}

impl GitCliEngine {
    pub fn new(repo_path: &Path) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
            app_handle: None,
            automatic: false,
            identity: None,
        }
    }

    pub fn with_app_handle(repo_path: impl Into<PathBuf>, app_handle: tauri::AppHandle) -> Self {
        Self {
            repo_path: repo_path.into(),
            app_handle: Some(app_handle),
            automatic: false,
            identity: None,
        }
    }

    /// 이 엔진이 실행하는 작업을 자동 작업으로 표시한다.
    pub fn with_automatic(mut self, automatic: bool) -> Self {
        self.automatic = automatic;
        self
    }

    /// 커밋을 만드는 명령에 쓸 저장소 계정 신원을 지정한다. `None`이면 git 설정을 따른다.
    pub fn with_identity(mut self, identity: Option<(String, String)>) -> Self {
        self.identity = identity;
        self
    }

    /// `identity`를 git이 읽는 작성자·커미터 환경변수로 바꾼다.
    fn identity_envs(&self) -> Vec<(&'static str, String)> {
        identity_envs(self.identity.as_ref().map(|(n, e)| (n.as_str(), e.as_str())))
    }

    /// 새 git 프로세스를 만든다. 저장소 경로·프롬프트 차단·계정 신원을 공통으로 건다.
    fn git_command(&self) -> Command {
        let mut cmd = Command::new("git");
        cmd.current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .envs(self.identity_envs());
        cmd
    }
}

/// 계정 신원을 작성자·커미터 환경변수 목록으로 바꾼다. `create_commit`이
/// `--author`와 `GIT_COMMITTER_*`로 거는 것과 같은 신원이 된다.
pub(crate) fn identity_envs(identity: Option<(&str, &str)>) -> Vec<(&'static str, String)> {
    match identity {
        Some((name, email)) => vec![
            ("GIT_AUTHOR_NAME", name.to_string()),
            ("GIT_AUTHOR_EMAIL", email.to_string()),
            ("GIT_COMMITTER_NAME", name.to_string()),
            ("GIT_COMMITTER_EMAIL", email.to_string()),
        ],
        None => Vec::new(),
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

        let output = self
            .git_command()
            .args(args)
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

        let mut cmd = self.git_command();
        cmd.args(args);
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

        let output = self
            .git_command()
            .args(args)
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
            Err(git_failure(&output))
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
            return Err(git_failure(&output));
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
            Err(git_failure(&output))
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
        let automatic = self.automatic;

        let stderr_task = tokio::spawn(async move {
            let Some(mut stderr) = stderr_handle else { return };
            let temp_engine = GitCliEngine {
                repo_path,
                app_handle,
                automatic,
                identity: None,
            };
            let mut splitter = ProgressSplitter::default();
            let mut buf = [0u8; 8192];
            loop {
                // 바이트 단위로 읽는다. 줄 단위(`lines()`)로 읽으면 UTF-8이 아닌 줄에서
                // 오류가 나 읽기가 멈추고, 파이프가 차서 git이 멈출 수 있다.
                let n = match stderr.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                for segment in splitter.push(&buf[..n]) {
                    record_progress_segment(&temp_engine, &stderr_clone, &self_id, &self_op, segment);
                }
            }
            if let Some(segment) = splitter.finish() {
                record_progress_segment(&temp_engine, &stderr_clone, &self_id, &self_op, segment);
            }
        });

        let output = child.wait_with_output().await.map_err(map_io_err)?;
        let _ = stderr_task.await;

        let collected = collected_stderr
            .lock()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default();
        let mut final_output = output;
        if !collected.is_empty() {
            final_output.stderr = collected.into_bytes();
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
        // `branch`는 `local` 또는 `local:upstream` 형태의 refspec이다.
        let local_branch = branch.split(':').next().unwrap_or(branch);
        let summary = output_parser::parse_push_output(
            &String::from_utf8_lossy(&output.stderr),
            local_branch,
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
        rebase: Option<bool>,
    ) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;

        // 방식은 호출부가 정한다(`SyncTarget::pull_rebase`). `pull.rebase`를 설정하지
        // 않은 사용자에게는 `--no-rebase`가 넘어와 "Need to specify how to reconcile
        // divergent branches" 실패를 막고, 설정한 사용자에게는 `None`이 넘어와
        // 명령줄 플래그가 설정을 덮어쓰지 않는다(GitHub Desktop과 같은 방식).
        let mut pull_args: Vec<&str> = vec!["pull"];
        pull_args.extend(pull_mode_flag(rebase));
        pull_args.extend([remote, branch]);
        let mut args = vec!["-c", "credential.helper="];
        args.extend(&pull_args);

        let id = Uuid::new_v4().to_string();
        let start = Instant::now();
        let started_at = chrono::Utc::now().timestamp_millis();
        let display_args = pull_args;

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());
        self.emit_command_start(&id, &display_args, "pull", started_at);

        // pull은 merge 커밋을 만들 수 있으므로 저장소 계정 신원을 건다(git_command).
        let mut cmd = self.git_command();
        cmd.args(args).env("GIT_ASKPASS", askpass.path());
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

// ── Progress stream helpers ─────────────────────────────────────────────────

/// git 진행률 출력의 한 조각. `\r`로 끝나면 같은 줄을 덮어쓰는 중간 진행률이고,
/// `\n`으로 끝나면 확정된 줄이다.
#[derive(Debug, PartialEq, Eq)]
struct ProgressSegment {
    text: String,
    is_final_line: bool,
}

/// stderr 바이트를 `\r`/`\n` 기준으로 잘라 조각으로 돌려준다. 잘못된 UTF-8은
/// 대체 문자로 바꿔 계속 읽는다.
#[derive(Default)]
struct ProgressSplitter {
    pending: Vec<u8>,
    /// 직전에 `\r`로 끝난 조각. 곧바로 `\n`이 오면(`\r\n`) 이 조각이 확정된 줄이다.
    last_overwritten: Option<String>,
}

impl ProgressSplitter {
    fn push(&mut self, chunk: &[u8]) -> Vec<ProgressSegment> {
        let mut segments = Vec::new();
        for &byte in chunk {
            match byte {
                b'\r' => {
                    let text = self.take_pending();
                    if !text.is_empty() {
                        self.last_overwritten = Some(text.clone());
                        segments.push(ProgressSegment { text, is_final_line: false });
                    }
                }
                b'\n' => {
                    let text = self.take_pending();
                    let text = if text.is_empty() {
                        self.last_overwritten.take().unwrap_or_default()
                    } else {
                        text
                    };
                    self.last_overwritten = None;
                    if !text.is_empty() {
                        segments.push(ProgressSegment { text, is_final_line: true });
                    }
                }
                _ => self.pending.push(byte),
            }
        }
        segments
    }

    fn take_pending(&mut self) -> String {
        let bytes = std::mem::take(&mut self.pending);
        String::from_utf8_lossy(&bytes).trim().to_string()
    }

    /// 줄바꿈 없이 끝난 마지막 조각.
    fn finish(self) -> Option<ProgressSegment> {
        let text = String::from_utf8_lossy(&self.pending).trim().to_string();
        (!text.is_empty()).then_some(ProgressSegment { text, is_final_line: true })
    }
}

/// 진행률 조각을 이벤트로 내보내고, 확정된 줄만 오류 해석용 stderr에 모은다.
/// 중간 진행률(`\r`)까지 모으면 stderr가 진행률 줄로 가득 찬다.
fn record_progress_segment(
    engine: &GitCliEngine,
    collected: &Mutex<Vec<String>>,
    id: &str,
    operation: &str,
    segment: ProgressSegment,
) {
    if segment.is_final_line {
        if let Ok(mut lines) = collected.lock() {
            lines.push(segment.text.clone());
        }
    }
    let percent = parse_progress_percent(&segment.text);
    engine.emit_progress(id, operation, &segment.text, percent);
}

/// "Receiving objects: 45% (123/273)" → 45
fn parse_progress_percent(line: &str) -> Option<u32> {
    let pos = line.find('%')?;
    line[..pos]
        .rsplit(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|n| n.parse::<u32>().ok())
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

/// Check command output and convert non-zero exit to an `AppError`.
fn check_output(output: std::process::Output) -> Result<(), AppError> {
    if output.status.success() {
        Ok(())
    } else {
        Err(git_failure(&output))
    }
}

/// `git pull`에 넘길 병합 방식 플래그. `None`이면 넘기지 않고 git 설정을 따른다.
fn pull_mode_flag(rebase: Option<bool>) -> Option<&'static str> {
    rebase.map(|rebase| if rebase { "--rebase" } else { "--no-rebase" })
}

/// 실패한 git 명령의 출력을 `AppError`로 바꾼다. stderr와 stdout을 함께 본다.
/// merge 충돌 문구(`CONFLICT ...`)는 stdout에만 찍히기 때문이다.
/// 충돌이면 `AppError::MergeConflict`로 돌려 화면이 문구 비교 없이 알아채게 한다.
pub(crate) fn git_failure(output: &std::process::Output) -> AppError {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    git_failure_from_text(&stderr, &stdout, output.status.code())
}

fn git_failure_from_text(stderr: &str, stdout: &str, exit_code: Option<i32>) -> AppError {
    let message = parse_git_output_error(stderr, stdout);
    if is_conflict_output(stderr, stdout) {
        AppError::MergeConflict(message)
    } else {
        AppError::GitCli { message, exit_code }
    }
}

/// stderr만으로 오류 문구를 고른다. stdout이 없는 호출부를 위한 형태.
pub(crate) fn parse_git_error(stderr: &str) -> String {
    parse_git_output_error(stderr, "")
}

/// 출력 줄을 `\r`까지 나눠 정리한다. 진행률 뒤에 오류가 붙는 경우가 있다
/// (`Rebasing (1/1)\rerror: could not apply ...`).
fn output_lines<'a>(stderr: &'a str, stdout: &'a str) -> Vec<&'a str> {
    stderr
        .lines()
        .chain(stdout.lines())
        .flat_map(|line| line.split('\r'))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect()
}

fn is_conflict_line(line: &str) -> bool {
    line.starts_with("CONFLICT (")
        || line.starts_with("Automatic merge failed")
        || line.starts_with("error: could not apply")
        || line.starts_with("Could not apply")
}

fn is_conflict_output(stderr: &str, stdout: &str) -> bool {
    output_lines(stderr, stdout).into_iter().any(is_conflict_line)
}

/// 인증 실패를 뜻하는 git·GitHub 문구가 들어 있는지. 명령 출력 전체와
/// 이미 고른 오류 문구 양쪽에 쓴다.
pub(crate) fn is_auth_failure_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    const PATTERNS: [&str; 10] = [
        "authentication failed",
        "invalid username or token",
        "invalid username or password",
        "could not read username",
        "could not read password",
        "invalid credentials",
        "bad credentials",
        "returned error: 401",
        "returned error: 403",
        "password authentication is not supported",
    ];
    PATTERNS.iter().any(|p| lower.contains(p))
        || (lower.contains("permission to") && lower.contains("denied to"))
}

/// 사람이 읽을 오류 한 줄을 고른다. 우선순위:
/// 1. merge 충돌 (`CONFLICT (...)`)
/// 2. push 거부 (`! [rejected]`) — 거부 이유를 설명하는 첫 hint 문장과 함께
/// 3. 인증 실패 문구 (출력 어디에 있든) — `is_auth_error`가 알아볼 수 있도록
/// 4. 처음 나오는 `fatal:`/`error:` 줄
/// 5. 그 밖의 첫 줄 (hint·`To`/`From` 머리줄 제외)
fn parse_git_output_error(stderr: &str, stdout: &str) -> String {
    let lines = output_lines(stderr, stdout);

    if let Some(line) = lines.iter().find(|l| l.starts_with("CONFLICT (")) {
        return line.to_string();
    }

    if let Some(rejected) = lines
        .iter()
        .find(|l| l.starts_with("! [rejected]") || l.starts_with("! [remote rejected]"))
    {
        let rejected = collapse_whitespace(rejected.trim_start_matches("! "));
        return match first_hint_sentence(&lines) {
            Some(reason) => format!("{} ({})", reason, rejected),
            None => rejected,
        };
    }

    if lines.iter().any(|l| is_auth_failure_text(l)) {
        let auth_line = lines
            .iter()
            .find(|l| l.starts_with("fatal:") && is_auth_failure_text(l))
            .or_else(|| lines.iter().find(|l| is_auth_failure_text(l)));
        if let Some(line) = auth_line {
            return strip_git_prefix(line).to_string();
        }
    }

    if let Some(line) = lines
        .iter()
        .find(|l| l.starts_with("fatal:") || l.starts_with("error:"))
    {
        return strip_git_prefix(line).to_string();
    }

    lines
        .iter()
        .find(|l| {
            !l.starts_with("hint:") && !l.starts_with("To ") && !l.starts_with("From ")
        })
        .or_else(|| lines.first())
        .map(|l| strip_git_prefix(l).to_string())
        .unwrap_or_default()
}

fn strip_git_prefix(line: &str) -> &str {
    ["fatal: ", "error: ", "remote: "]
        .iter()
        .find_map(|p| line.strip_prefix(p))
        .unwrap_or(line)
        .trim()
}

fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 첫 hint 문단을 이어 붙여 첫 문장만 돌려준다.
/// "hint: Updates were rejected because the tip of your current branch is behind
///  hint: its remote counterpart. ..." → "Updates were rejected ... counterpart."
fn first_hint_sentence(lines: &[&str]) -> Option<String> {
    let start = lines.iter().position(|l| l.starts_with("hint:"))?;
    let paragraph: Vec<&str> = lines[start..]
        .iter()
        .map_while(|l| l.strip_prefix("hint:"))
        .map(str::trim)
        .take_while(|l| !l.is_empty())
        .collect();
    let text = paragraph.join(" ");
    let sentence = match text.find(". ") {
        Some(end) => &text[..=end],
        None => text.as_str(),
    };
    let sentence = sentence.trim();
    (!sentence.is_empty()).then(|| sentence.to_string())
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

    // ── Error parsing (real captured git output, git 2.54) ──────────────────

    const PUSH_REJECTED_STDERR: &str = "\
To github.com:owner/repo.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'github.com:owner/repo.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
";

    const PULL_DIVERGENT_STDERR: &str = "\
From github.com:owner/repo
 * branch            main       -> FETCH_HEAD
hint: You have divergent branches and need to specify how to reconcile them.
hint: You can do so by running one of the following commands sometime before
hint: your next pull:
hint:
hint:   git config pull.rebase false  # merge
fatal: Need to specify how to reconcile divergent branches.
";

    const MERGE_CONFLICT_STDOUT: &str = "\
Auto-merging f
CONFLICT (content): Merge conflict in f
Automatic merge failed; fix conflicts and then commit the result.
";

    const REBASE_CONFLICT_STDERR: &str = "Rebasing (1/1)\rerror: could not apply d654f3a... a
hint: Resolve all conflicts manually, mark them as resolved with
hint: \"git add/rm <conflicted_files>\", then run \"git rebase --continue\".
Could not apply d654f3a... # a
";

    /// GitHub가 만료·폐기된 토큰에 돌려주는 출력. 첫 줄이 `remote:`로 시작한다.
    const EXPIRED_TOKEN_STDERR: &str = "\
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/owner/repo.git/'
";

    fn failure(stderr: &str, stdout: &str) -> AppError {
        git_failure_from_text(stderr, stdout, Some(1))
    }

    fn message_of(err: &AppError) -> String {
        match err {
            AppError::GitCli { message, .. } | AppError::MergeConflict(message) => message.clone(),
            other => other.to_string(),
        }
    }

    #[test]
    fn push_rejection_explains_why_instead_of_showing_the_to_line() {
        let msg = parse_git_error(PUSH_REJECTED_STDERR);
        assert_eq!(
            msg,
            "Updates were rejected because the remote contains work that you do not have locally. \
             ([rejected] main -> main (fetch first))"
        );
    }

    #[test]
    fn remote_rejection_keeps_the_server_reason() {
        let stderr = "To github.com:o/r.git\n ! [remote rejected] main -> main (push declined due to email privacy restrictions)\nerror: failed to push some refs to 'github.com:o/r.git'\n";
        assert_eq!(
            parse_git_error(stderr),
            "[remote rejected] main -> main (push declined due to email privacy restrictions)"
        );
    }

    #[test]
    fn divergent_pull_reports_the_fatal_line() {
        assert_eq!(
            parse_git_error(PULL_DIVERGENT_STDERR),
            "Need to specify how to reconcile divergent branches."
        );
    }

    #[test]
    fn merge_conflict_on_stdout_becomes_a_typed_conflict() {
        let err = failure("", MERGE_CONFLICT_STDOUT);
        assert!(matches!(err, AppError::MergeConflict(_)), "{:?}", err);
        assert_eq!(message_of(&err), "CONFLICT (content): Merge conflict in f");
    }

    #[test]
    fn pull_merge_conflict_is_a_conflict_even_with_fetch_noise_on_stderr() {
        let stderr = "From github.com:o/r\n * branch            main       -> FETCH_HEAD\n";
        let err = failure(stderr, MERGE_CONFLICT_STDOUT);
        assert!(matches!(err, AppError::MergeConflict(_)));
    }

    #[test]
    fn rebase_conflict_is_a_typed_conflict() {
        let stdout = "Auto-merging f\nCONFLICT (content): Merge conflict in f\n";
        let err = failure(REBASE_CONFLICT_STDERR, stdout);
        assert!(matches!(err, AppError::MergeConflict(_)));
        assert_eq!(message_of(&err), "CONFLICT (content): Merge conflict in f");
    }

    #[test]
    fn error_after_carriage_return_progress_is_found() {
        let err = failure(REBASE_CONFLICT_STDERR, "");
        assert!(matches!(err, AppError::MergeConflict(_)));
        assert_eq!(message_of(&err), "could not apply d654f3a... a");
    }

    #[test]
    fn non_conflict_failure_stays_git_cli() {
        let stderr = "error: Your local changes to the following files would be overwritten by merge:\n\tf\nPlease commit your changes or stash them before you merge.\nAborting\n";
        let err = failure(stderr, "Updating abc..def\n");
        assert!(matches!(err, AppError::GitCli { .. }));
        assert_eq!(
            message_of(&err),
            "Your local changes to the following files would be overwritten by merge:"
        );
    }

    #[test]
    fn expired_token_message_keeps_auth_wording() {
        let msg = parse_git_error(EXPIRED_TOKEN_STDERR);
        assert_eq!(msg, "Authentication failed for 'https://github.com/owner/repo.git/'");
        assert!(is_auth_failure_text(&msg));
    }

    #[test]
    fn auth_wording_on_a_remote_line_is_kept_when_fatal_is_generic() {
        let stderr = "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 400\n";
        let msg = parse_git_error(stderr);
        assert!(is_auth_failure_text(&msg), "{}", msg);
    }

    #[test]
    fn http_403_and_permission_denied_are_auth_failures() {
        let msg = parse_git_error("remote: Permission to o/r.git denied to someone.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403\n");
        assert!(is_auth_failure_text(&msg), "{}", msg);
        assert!(is_auth_failure_text("could not read Username for 'https://github.com': terminal prompts disabled"));
        assert!(!is_auth_failure_text("pathspec 'a403b' did not match any file(s) known to git"));
    }

    #[test]
    fn falls_back_to_first_meaningful_line() {
        assert_eq!(parse_git_error("hint: something\nsomething odd happened\n"), "something odd happened");
        assert_eq!(parse_git_error(""), "");
    }

    #[test]
    fn pull_mode_flag_is_omitted_only_when_unrequested() {
        assert_eq!(pull_mode_flag(Some(false)), Some("--no-rebase"));
        assert_eq!(pull_mode_flag(Some(true)), Some("--rebase"));
        assert_eq!(pull_mode_flag(None), None);
    }

    #[test]
    fn identity_sets_author_and_committer() {
        let envs = identity_envs(Some(("octo", "octo@users.noreply.github.com")));
        let keys: Vec<&str> = envs.iter().map(|(k, _)| *k).collect();
        assert_eq!(
            keys,
            ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]
        );
        assert!(identity_envs(None).is_empty());
    }

    // ── Progress reader ─────────────────────────────────────────────────────

    #[test]
    fn progress_splitter_survives_invalid_utf8() {
        let mut splitter = ProgressSplitter::default();
        let mut out = splitter.push(b"remote: caf\xe9 \xff\n");
        out.extend(splitter.push(b"Receiving objects: 100% (3/3), done.\n"));
        assert_eq!(out.len(), 2);
        assert!(out[0].text.starts_with("remote: caf"));
        assert_eq!(out[1].text, "Receiving objects: 100% (3/3), done.");
        assert!(out.iter().all(|s| s.is_final_line));
    }

    #[test]
    fn progress_splitter_treats_carriage_return_as_overwrite() {
        let mut splitter = ProgressSplitter::default();
        let out = splitter.push(b"Receiving objects:  45% (1/3)\rReceiving objects: 100% (3/3), done.\n");
        assert_eq!(
            out,
            vec![
                ProgressSegment { text: "Receiving objects:  45% (1/3)".into(), is_final_line: false },
                ProgressSegment { text: "Receiving objects: 100% (3/3), done.".into(), is_final_line: true },
            ]
        );
        assert_eq!(parse_progress_percent(&out[0].text), Some(45));
    }

    #[test]
    fn progress_splitter_keeps_crlf_lines_and_split_chunks() {
        let mut splitter = ProgressSplitter::default();
        let mut out = splitter.push(b"remote: Invalid username");
        out.extend(splitter.push(b" or token.\r\nfatal: Authentication failed"));
        let last = splitter.finish();
        assert_eq!(out.len(), 2);
        assert_eq!(out[1], ProgressSegment { text: "remote: Invalid username or token.".into(), is_final_line: true });
        assert_eq!(last, Some(ProgressSegment { text: "fatal: Authentication failed".into(), is_final_line: true }));
    }

    // ── Pull / merge against real repositories ──────────────────────────────

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// 원격(bare)과 서로 갈라진 클론 하나를 만든다. `conflicting`이면 같은 줄을 고친다.
    fn diverged_clone(name: &str, conflicting: bool) -> (PathBuf, PathBuf) {
        let tmp = std::env::temp_dir().join(format!("gitbaro-cli-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        git(&tmp, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
        for clone in ["a", "b"] {
            git(&tmp, &["clone", "-q", "remote.git", clone]);
            let dir = tmp.join(clone);
            git(&dir, &["config", "user.name", "Global"]);
            git(&dir, &["config", "user.email", "global@example.com"]);
            if clone == "a" {
                std::fs::write(dir.join("f"), "base\n").unwrap();
                git(&dir, &["add", "f"]);
                git(&dir, &["commit", "-qm", "init"]);
                git(&dir, &["push", "-q", "origin", "main"]);
            }
        }
        let b = tmp.join("b");
        git(&b, &["pull", "-q", "origin", "main"]);
        std::fs::write(b.join(if conflicting { "f" } else { "g" }), "from b\n").unwrap();
        git(&b, &["add", "-A"]);
        git(&b, &["commit", "-qm", "b"]);
        git(&b, &["push", "-q", "origin", "main"]);

        let a = tmp.join("a");
        std::fs::write(a.join("f"), "from a\n").unwrap();
        git(&a, &["commit", "-qam", "a"]);
        (tmp, a)
    }

    #[tokio::test]
    async fn pull_merges_divergent_branches_as_the_repo_account() {
        let (tmp, a) = diverged_clone("pull-ok", false);
        let engine = GitCliEngine::new(&a)
            .with_identity(Some(("octo".into(), "octo@example.com".into())));

        let result = engine.pull("origin", "refs/heads/main", "unused-token", Some(false)).await;
        let author = git(&a, &["log", "-1", "--format=%an <%ae>|%cn <%ce>|%P"]);
        let _ = std::fs::remove_dir_all(&tmp);

        result.expect("갈라진 브랜치 pull이 실패함");
        let parts: Vec<&str> = author.split('|').collect();
        assert_eq!(parts[0], "octo <octo@example.com>");
        assert_eq!(parts[1], "octo <octo@example.com>");
        assert_eq!(parts[2].split(' ').count(), 2, "merge 커밋이 아님");
    }

    /// 방식을 넘기지 않으면 사용자의 `pull.rebase=true`를 따라 rebase해야 한다.
    #[tokio::test]
    async fn pull_without_a_mode_follows_pull_rebase_config() {
        let (tmp, a) = diverged_clone("pull-config", false);
        git(&a, &["config", "pull.rebase", "true"]);
        let engine = GitCliEngine::new(&a);

        let result = engine.pull("origin", "refs/heads/main", "unused-token", None).await;
        let parents = git(&a, &["log", "-1", "--format=%P"]);
        let _ = std::fs::remove_dir_all(&tmp);

        result.expect("pull.rebase=true pull이 실패함");
        assert_eq!(parents.split(' ').count(), 1, "rebase 대신 merge 커밋이 생김");
    }

    #[tokio::test]
    async fn pull_conflict_surfaces_as_merge_conflict() {
        let (tmp, a) = diverged_clone("pull-conflict", true);
        let engine = GitCliEngine::new(&a);

        let result = engine.pull("origin", "refs/heads/main", "unused-token", Some(false)).await;
        let merging = a.join(".git/MERGE_HEAD").exists();
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(matches!(result, Err(AppError::MergeConflict(_))), "{:?}", result);
        assert!(merging);
    }

    #[tokio::test]
    async fn merge_conflict_from_local_merge_is_typed() {
        let (tmp, a) = diverged_clone("merge-conflict", true);
        git(&a, &["fetch", "-q", "origin"]);
        let engine = GitCliEngine::new(&a);

        let result = engine.merge_branch("origin/main", true).await;
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(matches!(result, Err(AppError::MergeConflict(_))), "{:?}", result);
    }
}
