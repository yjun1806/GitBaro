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
use crate::git::worktree_base::{base_config_key, WorktreeBase};

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
    /// 이 워크트리 브랜치가 갈라져 나온 브랜치. 메인·detached 워크트리는 `None`.
    pub base: Option<WorktreeBase>,
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

    /// Run a read-only git query that the app makes for its own bookkeeping
    /// (not something the user asked for). It emits no activity events, so an
    /// expected non-zero exit — e.g. `rev-parse --verify` on a missing ref —
    /// does not show up as a failed command in the activity log.
    async fn run_local_probe(&self, args: &[&str]) -> Result<std::process::Output, AppError> {
        tracing::debug!(
            "[git] git {} (cwd: {})",
            args.join(" "),
            self.repo_path.display()
        );
        Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)
    }

    /// `run_local_probe` that requires success and returns the trimmed stdout.
    async fn run_local_probe_checked(&self, args: &[&str]) -> Result<String, AppError> {
        let output = self.run_local_probe(args).await?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(git_failure(&output))
        }
    }

    /// Run a checkout that should leave HEAD on `refs/heads/<branch>`.
    ///
    /// git runs the post-checkout hook after HEAD has already moved, and a
    /// failing hook makes `git checkout` exit non-zero even though the switch
    /// happened. Reporting that as a failed switch would make callers undo
    /// work (e.g. pop a stash onto the new branch) for a switch that did take
    /// place, so when HEAD is on the target branch the switch counts as done.
    /// The failed command, with the hook's output, stays in the activity log.
    async fn run_branch_checkout(&self, args: &[&str], branch: &str) -> Result<(), AppError> {
        let output = self.run_local(args).await?;
        if output.status.success() {
            return Ok(());
        }
        let head = self.run_local_probe(&["symbolic-ref", "-q", "HEAD"]).await?;
        let head_ref = String::from_utf8_lossy(&head.stdout).trim().to_string();
        if head.status.success() && head_ref == format!("refs/heads/{}", branch) {
            tracing::warn!(
                "[git] git {} exited {:?} after switching to {} (post-checkout hook failed)",
                args.join(" "),
                output.status.code(),
                branch
            );
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(AppError::GitCli {
            message: parse_git_error(&stderr),
            exit_code: output.status.code(),
        })
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

    /// Fast-forward the checked-out branch to its upstream (`git merge --ff-only`).
    /// git refuses rather than creating a merge commit when the branches have
    /// diverged, and refuses when the move would overwrite local changes, so a
    /// race with an editor or agent cannot lose work. Runs the post-merge hook.
    pub async fn fast_forward_to_upstream(&self) -> Result<(), AppError> {
        self.run_local_checked(&["merge", "--ff-only", "@{upstream}"]).await?;
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
        self.run_with_pathspecs(&["checkout", "--"], paths).await
    }

    /// Restore both the index and the working tree of `paths` to HEAD
    /// (`git checkout HEAD -- <paths>`). Used to discard staged changes.
    pub async fn restore_paths_from_head(&self, paths: &[String]) -> Result<(), AppError> {
        self.run_with_pathspecs(&["checkout", "HEAD", "--"], paths).await?;
        self.clear_stale_squash_msg().await;
        Ok(())
    }

    /// Drop `paths` from the index, leaving the working-tree files alone
    /// (`git rm --cached`). Used for files that only exist in the index.
    pub async fn remove_paths_from_index(&self, paths: &[String]) -> Result<(), AppError> {
        self.run_with_pathspecs(&["rm", "--cached", "-q", "-r", "--ignore-unmatch", "--"], paths)
            .await?;
        self.clear_stale_squash_msg().await;
        Ok(())
    }

    /// Stage `paths` exactly like `git add -A -- <paths>`: new and modified
    /// files are added, deleted files are removed from the index. Going
    /// through git (not libgit2) applies clean/LFS filters, handles
    /// submodules and symlinks, and respects sparse checkout.
    pub async fn stage_paths(&self, paths: &[String]) -> Result<(), AppError> {
        // Clear a leftover SQUASH_MSG first: once this adds to the index, a
        // stale one would pass for a squash in progress (see `operation_in`).
        self.clear_stale_squash_msg().await;
        self.run_with_pathspecs(&["add", "-A", "--"], paths).await
    }

    /// Unstage `paths` (`git reset -q -- <paths>`). Without an explicit
    /// commit, git resets against HEAD, or against an empty tree when HEAD is
    /// unborn, so this also works before the first commit.
    pub async fn unstage_paths(&self, paths: &[String]) -> Result<(), AppError> {
        self.run_with_pathspecs(&["reset", "-q", "--"], paths).await?;
        self.clear_stale_squash_msg().await;
        Ok(())
    }

    /// Remove SQUASH_MSG when nothing is staged. git leaves the file behind
    /// when a squash is undone path by path (`reset -- <paths>`,
    /// `restore --staged`), and once something unrelated is staged again the
    /// leftover would be reported as a squash in progress, whose Abort
    /// (`reset --merge`) throws that staged work away. With the index equal
    /// to HEAD there is no squash left, so the file only carries a stale
    /// message. Best effort: a failure here must not fail the caller.
    async fn clear_stale_squash_msg(&self) {
        let result = async {
            let git_dir = self.git_dir().await?;
            if detect_operation(&git_dir) == Some(GitOperation::Squash)
                && self.index_matches_head().await?
            {
                match std::fs::remove_file(git_dir.join("SQUASH_MSG")) {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                    _ => {}
                }
            }
            Ok::<(), AppError>(())
        }
        .await;
        if let Err(e) = result {
            tracing::warn!("[git] could not clear a stale SQUASH_MSG: {}", e);
        }
    }

    /// Run `git <prefix> <paths...>` with literal pathspecs (so `*`, `[`, `:`
    /// in file names are not treated as globs or magic), splitting very long
    /// path lists across several invocations to stay under ARG_MAX.
    async fn run_with_pathspecs(&self, prefix: &[&str], paths: &[String]) -> Result<(), AppError> {
        const MAX_PATH_BYTES_PER_CALL: usize = 64 * 1024;
        let literal = [("GIT_LITERAL_PATHSPECS", "1".to_string())];

        let mut start = 0;
        while start < paths.len() {
            let mut end = start;
            let mut bytes = 0;
            while end < paths.len() && (end == start || bytes + paths[end].len() < MAX_PATH_BYTES_PER_CALL) {
                bytes += paths[end].len() + 1;
                end += 1;
            }
            let mut args: Vec<&str> = prefix.to_vec();
            args.extend(paths[start..end].iter().map(String::as_str));
            let output = self.run_local_with_env(&args, &literal).await?;
            check_output(output)?;
            start = end;
        }
        Ok(())
    }

    /// Switch branch via git CLI so that post-checkout hook runs.
    pub async fn switch_branch(&self, name: &str) -> Result<(), AppError> {
        // NOTE: `--` cannot be used here — `git checkout -- <name>` restores a
        // pathspec instead of switching branch. `validate_branch_name` rejects
        // leading '-' and other option-injection characters instead.
        crate::git::branch::validate_branch_name(name)?;
        self.run_branch_checkout(&["checkout", name], name).await
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
        self.run_branch_checkout(&["checkout", start_point, "-b", local_name, "--"], local_name)
            .await
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
    ///
    /// git refuses to revert a merge commit without a mainline, so for merges
    /// we pass `-m 1`: undo what the merge brought in relative to the branch
    /// it was merged into (same as GitHub Desktop).
    pub async fn revert_commit(&self, oid: &str) -> Result<(), AppError> {
        let mut args = vec!["revert", "--no-edit"];
        if self.is_merge_commit(oid).await? {
            args.extend(["-m", "1"]);
        }
        args.push(oid);
        self.run_local_checked(&args).await?;
        Ok(())
    }

    /// Apply the changes introduced by `oid` on top of the current branch.
    /// `oid` must be a validated hex commit id. Merge commits are rejected:
    /// replaying a whole merge as one commit is rarely what the user wants,
    /// and git would fail anyway without a mainline.
    pub async fn cherry_pick_commit(&self, oid: &str) -> Result<(), AppError> {
        if self.is_merge_commit(oid).await? {
            return Err(AppError::GitCli {
                message: "Cannot cherry-pick a merge commit".to_string(),
                exit_code: None,
            });
        }
        self.run_local_checked(&["cherry-pick", oid]).await?;
        Ok(())
    }

    /// Whether `oid` has more than one parent.
    async fn is_merge_commit(&self, oid: &str) -> Result<bool, AppError> {
        let line = self
            .run_local_probe_checked(&["rev-list", "--parents", "-n", "1", oid])
            .await?;
        // "<oid> <parent1> <parent2> ..."
        Ok(line.split_whitespace().count() > 2)
    }

    /// The commit `refs/stash` points at (the newest stash), or None when the
    /// stash list is empty.
    async fn stash_head_oid(&self) -> Result<Option<String>, AppError> {
        let output = self
            .run_local_probe(&["rev-parse", "-q", "--verify", "refs/stash"])
            .await?;
        let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok((output.status.success() && !oid.is_empty()).then_some(oid))
    }

    /// Stash working changes via git CLI, untracked files included.
    ///
    /// Returns the oid of the stash this call created, or None when there was
    /// nothing to stash — git then prints "No local changes to save" and still
    /// exits 0, so the exit code alone cannot tell the two apart.
    pub async fn stash_save(&self, message: Option<&str>) -> Result<Option<String>, AppError> {
        let mut args = vec!["stash", "push", "--include-untracked"];
        if let Some(msg) = message {
            args.push("-m");
            args.push(msg);
        }
        self.run_stash_push(&args, &[]).await
    }

    /// Run a `git stash push` and report the stash it created, if any.
    async fn run_stash_push(
        &self,
        args: &[&str],
        envs: &[(&str, String)],
    ) -> Result<Option<String>, AppError> {
        let before = self.stash_head_oid().await?;
        check_output(self.run_local_with_env(args, envs).await?)?;
        let after = self.stash_head_oid().await?;
        Ok(if after != before { after } else { None })
    }

    /// Pop the stash entry whose commit is `oid`, wherever it now sits in the
    /// stash list. Fails without touching anything when no entry matches.
    pub async fn stash_pop_oid(&self, oid: &str) -> Result<(), AppError> {
        crate::git::commit::validate_commit_oid(oid)?;
        let index = self
            .stash_index_of(oid)
            .await?
            .ok_or_else(|| AppError::GitCli {
                message: format!("Stash {} not found", oid),
                exit_code: None,
            })?;
        self.stash_pop_index(index).await
    }

    /// Where the stash entry whose commit is `oid` now sits in the stash list,
    /// or None when no entry matches.
    async fn stash_index_of(&self, oid: &str) -> Result<Option<usize>, AppError> {
        let list = self.run_local_probe(&["stash", "list", "--format=%H"]).await?;
        if !list.status.success() {
            return Err(AppError::GitCli {
                message: parse_git_error(&String::from_utf8_lossy(&list.stderr)),
                exit_code: list.status.code(),
            });
        }
        Ok(String::from_utf8_lossy(&list.stdout)
            .lines()
            .position(|line| line.trim() == oid))
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

    /// Stash only specific paths (partial stash). `--include-untracked` lets the
    /// pathspec name new files too; without it one untracked path fails the
    /// whole batch with "did not match any file(s) known to git".
    pub async fn stash_push_paths(
        &self,
        message: Option<&str>,
        paths: &[String],
    ) -> Result<Option<String>, AppError> {
        let mut args = vec!["stash", "push", "--include-untracked"];
        if let Some(msg) = message {
            args.push("-m");
            args.push(msg);
        }
        args.push("--");
        args.extend(paths.iter().map(|s| s.as_str()));
        self.run_stash_push(&args, &[("GIT_LITERAL_PATHSPECS", "1".to_string())])
            .await
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
    /// If the squash stops on conflicts, `message` replaces git's SQUASH_MSG so
    /// that continuing after the conflicts commits with the same message a
    /// conflict-free squash would get.
    pub async fn squash_merge(&self, branch: &str, message: &str) -> Result<(), AppError> {
        let result = self.run_local_checked(&["merge", "--squash", "--", branch]).await;
        if result.is_err() {
            let squash_msg = self.git_dir().await?.join("SQUASH_MSG");
            if squash_msg.exists() {
                std::fs::write(&squash_msg, format!("{}\n", message))?;
            }
        }
        result.map(|_| ())
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
        // Without an editor git keeps `#` lines, so the "# Conflicts:" list it
        // appends to the prepared message would end up in the commit.
        self.run_local_checked(&["commit", "--no-edit", "--cleanup=strip"]).await?;
        Ok(())
    }

    /// Whether the index has nothing staged relative to HEAD. Unmerged
    /// (conflicted) entries count as staged changes.
    async fn index_matches_head(&self) -> Result<bool, AppError> {
        let output = self.run_local_probe(&["diff", "--cached", "--quiet"]).await?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            code => Err(AppError::GitCli {
                message: parse_git_error(&String::from_utf8_lossy(&output.stderr)),
                exit_code: code,
            }),
        }
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
        let git_dir = self.run_local_probe_checked(&["rev-parse", "--git-dir"]).await?;
        let p = PathBuf::from(&git_dir);
        Ok(if p.is_absolute() { p } else { self.repo_path.join(p) })
    }

    /// Report which multi-step operation is in progress by checking for the
    /// marker files git creates in the git dir.
    pub async fn operation_in_progress(&self) -> Result<Option<GitOperation>, AppError> {
        self.operation_in(&self.git_dir().await?).await
    }

    async fn operation_in(&self, git_dir: &Path) -> Result<Option<GitOperation>, AppError> {
        match detect_operation(git_dir) {
            // git leaves SQUASH_MSG behind when a squash is undone by some
            // commands (e.g. `restore --staged`). With nothing staged there is
            // no squash left to continue or abort.
            Some(GitOperation::Squash) if self.index_matches_head().await? => Ok(None),
            op => Ok(op),
        }
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
            GitOperation::CherryPick => self.sequencer_continue("cherry-pick").await,
            GitOperation::Revert => self.sequencer_continue("revert").await,
        }
    }

    /// Continue a cherry-pick or revert. When the resolution left nothing to
    /// commit (the change is already on this branch), git refuses `--continue`
    /// and the commit is skipped instead, as GitHub Desktop does.
    async fn sequencer_continue(&self, command: &str) -> Result<(), AppError> {
        let step = if self.index_matches_head().await? { "--skip" } else { "--continue" };
        self.run_local_checked(&["-c", "core.editor=true", command, step]).await?;
        Ok(())
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

        // 새 브랜치를 특정 브랜치에서 만들었으면 그 이름을 기록해 둔다. reflog 는 만료되고
        // 시작점을 해시로 남길 수도 있어서, 앱이 아는 값을 우선한다. 기록 실패는
        // 워크트리 생성 자체를 실패로 만들 일이 아니므로 경고만 남긴다.
        if let (Some(nb), Some(base)) = (new_branch, base_branch) {
            let key = base_config_key(nb);
            if let Err(e) = self.run_local_checked(&["config", &key, base]).await {
                tracing::warn!("[git] failed to record base branch for {}: {}", nb, e);
            }
        }
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
                base: None,
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
        // `merge --squash` writes SQUASH_MSG and no MERGE_HEAD. git does not
        // always remove it when the squash is undone, so callers also check
        // that something is staged (see `operation_in`).
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
    /// Start previewing another branch by performing a no-commit merge.
    /// Local changes (including untracked files) are stashed first.
    /// Returns false when there is nothing to preview (already up to date);
    /// in that case the working tree is left as it was.
    pub async fn start_preview(&self, branch: &str) -> Result<bool, AppError> {
        let git_dir = self.git_dir().await?;
        if self.operation_in(&git_dir).await?.is_some() || git_dir.join(PREVIEW_MARKER).exists() {
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
            let before = self.stash_head_oid().await?;
            self.run_local_checked(&["stash", "push", "-u", "-m", "gitbaro-preview"])
                .await?;
            let after = self.stash_head_oid().await?;
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
            if self.operation_in(&git_dir).await?.is_none() {
                // 사용자가 이미 꺼내거나 지운 스태시면 복원할 것이 없다.
                if let Some(index) = self.stash_index_of(oid).await? {
                    self.stash_pop_index(index).await?;
                }
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

    #[tokio::test]
    async fn undone_squash_is_not_reported_as_in_progress() {
        let repo = conflicting_repo();
        git(&repo.0, &["checkout", "-qb", "clean", "main~1"]);
        write(&repo.0, "b.txt", "b\n");
        git(&repo.0, &["add", "b.txt"]);
        git(&repo.0, &["commit", "-qm", "add b"]);
        git(&repo.0, &["checkout", "-q", "main"]);
        git(&repo.0, &["merge", "--squash", "clean"]);
        let engine = GitCliEngine::new(&repo.0);
        assert_eq!(
            engine.operation_in_progress().await.unwrap(),
            Some(GitOperation::Squash)
        );

        // `restore --staged` undoes the squash but leaves SQUASH_MSG behind.
        git(&repo.0, &["restore", "--staged", "."]);
        assert!(repo.0.join(".git/SQUASH_MSG").exists());
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
        std::fs::remove_file(repo.0.join("b.txt")).unwrap();
        assert!(engine.start_preview("clean").await.unwrap());
    }

    #[tokio::test]
    async fn squash_undone_in_the_app_does_not_turn_later_staging_into_a_squash() {
        let repo = conflicting_repo();
        git_may_fail(&repo.0, &["merge", "--squash", "feature"]);
        let engine = GitCliEngine::new(&repo.0);
        let a = vec!["a.txt".to_string()];
        // The user unstages and discards the conflicted file in the app.
        engine.unstage_paths(&a).await.unwrap();
        engine.discard_paths(&a).await.unwrap();
        assert!(!repo.0.join(".git/SQUASH_MSG").exists(), "stale SQUASH_MSG left behind");

        // Unrelated work staged afterwards is not a squash in progress.
        write(&repo.0, "a.txt", "edit\n");
        write(&repo.0, "g.txt", "g\n");
        engine
            .stage_paths(&["a.txt".to_string(), "g.txt".to_string()])
            .await
            .unwrap();
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
    }

    #[tokio::test]
    async fn staging_after_an_outside_undo_clears_the_stale_squash() {
        let repo = conflicting_repo();
        git_may_fail(&repo.0, &["merge", "--squash", "feature"]);
        // Undone outside the app: SQUASH_MSG stays.
        git(&repo.0, &["reset", "-q", "--", "a.txt"]);
        git(&repo.0, &["checkout", "--", "a.txt"]);
        assert!(repo.0.join(".git/SQUASH_MSG").exists());

        let engine = GitCliEngine::new(&repo.0);
        write(&repo.0, "g.txt", "g\n");
        engine.stage_paths(&["g.txt".to_string()]).await.unwrap();
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
    }

    #[tokio::test]
    async fn squash_conflict_continues_with_the_app_message() {
        let repo = conflicting_repo();
        let engine = GitCliEngine::new(&repo.0);
        let message = "Squash merge branch 'feature'";
        assert!(engine.squash_merge("feature", message).await.is_err());
        assert_eq!(
            engine.operation_in_progress().await.unwrap(),
            Some(GitOperation::Squash)
        );

        write(&repo.0, "a.txt", "resolved\n");
        git(&repo.0, &["add", "a.txt"]);
        engine.operation_continue(GitOperation::Squash).await.unwrap();
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
        assert_eq!(git(&repo.0, &["log", "-1", "--format=%B"]), message);
    }

    #[tokio::test]
    async fn merge_conflict_continue_leaves_no_conflict_comments() {
        let repo = conflicting_repo();
        git_may_fail(&repo.0, &["merge", "feature"]);
        write(&repo.0, "a.txt", "resolved\n");
        git(&repo.0, &["add", "a.txt"]);
        let engine = GitCliEngine::new(&repo.0);
        engine.operation_continue(GitOperation::Merge).await.unwrap();
        assert_eq!(git(&repo.0, &["log", "-1", "--format=%B"]), "Merge branch 'feature'");
    }

    #[tokio::test]
    async fn empty_cherry_pick_is_skipped_on_continue() {
        let repo = conflicting_repo();
        let before = head(&repo.0);
        git_may_fail(&repo.0, &["cherry-pick", "feature"]);
        // 충돌을 main 쪽으로 해결해 커밋할 변경이 남지 않는다.
        write(&repo.0, "a.txt", "main\n");
        git(&repo.0, &["add", "a.txt"]);
        let engine = GitCliEngine::new(&repo.0);
        assert_eq!(
            engine.operation_in_progress().await.unwrap(),
            Some(GitOperation::CherryPick)
        );

        engine.operation_continue(GitOperation::CherryPick).await.unwrap();
        assert_eq!(engine.operation_in_progress().await.unwrap(), None);
        assert_eq!(head(&repo.0), before);
    }

    #[tokio::test]
    async fn merge_commit_is_reverted_with_mainline_and_not_cherry_picked() {
        let repo = conflicting_repo();
        // 충돌 없는 병합 커밋을 만든다.
        git(&repo.0, &["checkout", "-qb", "side", "main~1"]);
        write(&repo.0, "c.txt", "c\n");
        git(&repo.0, &["add", "c.txt"]);
        git(&repo.0, &["commit", "-qm", "add c"]);
        git(&repo.0, &["checkout", "-q", "main"]);
        git(&repo.0, &["merge", "--no-ff", "--no-edit", "side"]);
        let merge = head(&repo.0);
        let engine = GitCliEngine::new(&repo.0);

        assert!(engine.cherry_pick_commit(&merge).await.is_err());
        engine.revert_commit(&merge).await.unwrap();
        assert!(!repo.0.join("c.txt").exists());
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

    /// `-c credential.helper=` when `remote` points at github.com, so the
    /// account's token from GIT_ASKPASS wins over a keychain entry for another
    /// account. Other hosts keep the user's credential helper untouched.
    async fn credential_helper_override(&self, remote: &str, push: bool) -> &'static [&'static str] {
        let mut args = vec!["remote", "get-url"];
        if push {
            args.push("--push");
        }
        args.extend(["--", remote]);
        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());
        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .output()
            .await;
        match output {
            Ok(o) if o.status.success() => {
                credential_helper_override_for_url(String::from_utf8_lossy(&o.stdout).trim())
            }
            _ => &[],
        }
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

        let mut args = self.credential_helper_override(remote, true).await.to_vec();
        args.extend([
            "push",
            remote,
            branch,
            "--follow-tags",
            "--dry-run",
            "--no-verify",
            "--porcelain",
        ]);
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
        let mut args = self.credential_helper_override(remote, false).await.to_vec();
        args.extend(["ls-remote", "--tags", remote]);
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
        let mut args = credential_helper_override_for_url(url).to_vec();
        args.extend(["-c", "protocol.ext.allow=never", "clone", "--", url, &path_str]);

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
        let mut args = self.credential_helper_override(remote, false).await.to_vec();
        args.extend(["fetch", "--prune", remote]);

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

        let mut args = self.credential_helper_override(remote, true).await.to_vec();
        args.extend(["push", "--set-upstream"]);
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
        let mut args = self.credential_helper_override(remote, false).await.to_vec();
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
/// - For github.com remotes, clears existing credential helpers
///   (`-c credential.helper=`) to prevent interference; other hosts keep them.
/// - Answers only prompts whose host is exactly github.com, so the GitHub
///   token is never sent to another host (GitLab, Bitbucket, GHE, ...).
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

        let script = askpass_script(token);

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

/// `-c credential.helper=` for github.com URLs, nothing for other hosts.
fn credential_helper_override_for_url(url: &str) -> &'static [&'static str] {
    if crate::git::remote::is_github_com_url(url) {
        &["-c", "credential.helper="]
    } else {
        &[]
    }
}

/// Git calls GIT_ASKPASS with a prompt such as
/// `Username for 'https://github.com': ` or
/// `Password for 'https://x-access-token@github.com': `.
/// The script extracts the host from the quoted URL and only answers for
/// github.com; for any other host it exits non-zero without printing.
fn askpass_script(token: &str) -> String {
    format!(
        r#"#!/bin/sh
url=${{1#*\'}}
url=${{url%\'*}}
rest=${{url#*://}}
authority=${{rest%%/*}}
host=${{authority##*@}}
host=${{host%%:*}}
host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')
[ "$host" = "github.com" ] || exit 1
case "$1" in
*sername*) echo 'x-access-token' ;;
*assword*) echo '{}' ;;
*) exit 1 ;;
esac
"#,
        token
    )
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

    fn run_askpass(script: &Path, prompt: &str) -> (bool, String) {
        let out = std::process::Command::new("sh").arg(script).arg(prompt).output().unwrap();
        (out.status.success(), String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    #[tokio::test]
    async fn askpass_answers_only_for_github_com() {
        let askpass = AskpassScript::create("tok_123").await.unwrap();
        let path = askpass.path();

        assert_eq!(
            run_askpass(path, "Username for 'https://github.com': "),
            (true, "x-access-token".to_string())
        );
        assert_eq!(
            run_askpass(path, "Password for 'https://x-access-token@github.com': "),
            (true, "tok_123".to_string())
        );
        assert_eq!(
            run_askpass(path, "Password for 'https://x-access-token@GitHub.com:443/o/r.git': "),
            (true, "tok_123".to_string())
        );

        for prompt in [
            "Password for 'https://user@gitlab.com': ",
            "Password for 'https://github.example.com': ",
            "Password for 'https://github.com.evil.com': ",
            "Password for 'https://evil.com/x@github.com': ",
            "Username for 'https://bitbucket.org': ",
        ] {
            let (ok, out) = run_askpass(path, prompt);
            assert!(!ok, "{prompt}");
            assert!(out.is_empty(), "{prompt}");
        }
    }

    #[test]
    fn credential_helper_is_cleared_only_for_github_com() {
        assert_eq!(
            credential_helper_override_for_url("https://github.com/o/r.git"),
            &["-c", "credential.helper="]
        );
        assert!(credential_helper_override_for_url("https://gitlab.com/o/r.git").is_empty());
        assert!(credential_helper_override_for_url("https://ghe.corp.com/o/r.git").is_empty());
    }

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

    // ── stash ────────────────────────────────────────────────────────────

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

    /// 커밋 하나(tracked.txt)가 있는 임시 저장소.
    fn temp_repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gitbaro-stash-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "t@t"]);
        git(&dir, &["config", "user.name", "t"]);
        std::fs::write(dir.join("tracked.txt"), "one\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);
        dir
    }

    fn stash_count(dir: &Path) -> usize {
        git(dir, &["stash", "list"]).lines().filter(|l| !l.is_empty()).count()
    }

    /// 새 파일만 있어도 스태시가 만들어지고, 그 oid로 되돌릴 수 있어야 한다.
    #[tokio::test]
    async fn stash_save_includes_untracked_files_and_returns_its_oid() {
        let dir = temp_repo("untracked");
        std::fs::write(dir.join("new.txt"), "new\n").unwrap();
        let engine = GitCliEngine::new(&dir);

        let oid = engine.stash_save(None).await.unwrap().expect("스태시가 만들어져야 함");
        assert!(!dir.join("new.txt").exists(), "새 파일이 스태시되지 않음");
        assert_eq!(oid, git(&dir, &["rev-parse", "refs/stash"]));

        engine.stash_pop_oid(&oid).await.unwrap();
        assert!(dir.join("new.txt").exists());
        assert_eq!(stash_count(&dir), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 경로는 글롭이 아니라 글자 그대로 다룬다. `[id]`가 `i`, `d`와 맞으면 안 된다.
    #[tokio::test]
    async fn stash_push_paths_treats_paths_literally() {
        let dir = temp_repo("literal");
        let files = ["app/[id]/p.tsx", "app/i/p.tsx", "app/d/p.tsx"];
        for f in files {
            std::fs::create_dir_all(dir.join(f).parent().unwrap()).unwrap();
            std::fs::write(dir.join(f), "a\n").unwrap();
        }
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "routes"]);
        for f in files {
            std::fs::write(dir.join(f), "b\n").unwrap();
        }

        GitCliEngine::new(&dir)
            .stash_push_paths(None, &["app/[id]/p.tsx".to_string()])
            .await
            .unwrap();

        assert_eq!(git(&dir, &["stash", "show", "--name-only"]), "app/[id]/p.tsx");
        assert_eq!(std::fs::read_to_string(dir.join("app/i/p.tsx")).unwrap(), "b\n");
        assert_eq!(std::fs::read_to_string(dir.join("app/d/p.tsx")).unwrap(), "b\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 변경이 없으면 None을 돌려주고, 이전에 있던 스태시는 건드리지 않는다.
    #[tokio::test]
    async fn stash_save_reports_nothing_when_tree_is_clean() {
        let dir = temp_repo("clean");
        std::fs::write(dir.join("tracked.txt"), "older\n").unwrap();
        git(&dir, &["stash", "push", "-m", "older"]);
        let engine = GitCliEngine::new(&dir);

        assert_eq!(engine.stash_save(None).await.unwrap(), None);
        assert_eq!(stash_count(&dir), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 위에 다른 스태시가 쌓여도 oid로 고른 스태시만 꺼낸다.
    #[tokio::test]
    async fn stash_pop_oid_pops_that_entry_even_when_not_on_top() {
        let dir = temp_repo("by-oid");
        let engine = GitCliEngine::new(&dir);
        std::fs::write(dir.join("tracked.txt"), "mine\n").unwrap();
        let mine = engine.stash_save(Some("mine")).await.unwrap().unwrap();
        std::fs::write(dir.join("tracked.txt"), "other\n").unwrap();
        git(&dir, &["stash", "push", "-m", "other"]);

        engine.stash_pop_oid(&mine).await.unwrap();

        assert_eq!(std::fs::read_to_string(dir.join("tracked.txt")).unwrap(), "mine\n");
        assert!(git(&dir, &["stash", "list"]).contains("other"));
        assert_eq!(stash_count(&dir), 1);
        assert!(engine.stash_pop_oid(&mine).await.is_err(), "이미 꺼낸 스태시는 없어야 함");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 목록에서 고른 인덱스의 스태시를 꺼낸다(맨 위가 아니라).
    #[tokio::test]
    async fn stash_pop_index_pops_the_selected_entry() {
        let dir = temp_repo("by-index");
        std::fs::write(dir.join("tracked.txt"), "first\n").unwrap();
        git(&dir, &["stash", "push", "-m", "first"]);
        std::fs::write(dir.join("tracked.txt"), "second\n").unwrap();
        git(&dir, &["stash", "push", "-m", "second"]);

        GitCliEngine::new(&dir).stash_pop_index(1).await.unwrap();

        assert_eq!(std::fs::read_to_string(dir.join("tracked.txt")).unwrap(), "first\n");
        assert!(git(&dir, &["stash", "list"]).contains("second"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// post-checkout 훅이 실패해도 HEAD가 이미 옮겨졌다면 전환은 성공이다.
    /// 실패로 보고하면 호출 측이 스태시를 새 브랜치 위에 되돌려 놓는다.
    #[tokio::test]
    async fn switch_counts_as_done_when_only_post_checkout_hook_fails() {
        let dir = temp_repo("hook");
        git(&dir, &["branch", "other"]);
        let hooks = dir.join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        let hook = hooks.join("post-checkout");
        std::fs::write(&hook, "#!/bin/sh\necho hook failed >&2\nexit 1\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        git(&dir, &["config", "core.hooksPath", hooks.to_str().unwrap()]);
        let engine = GitCliEngine::new(&dir);

        engine.switch_branch("other").await.unwrap();
        assert_eq!(git(&dir, &["symbolic-ref", "HEAD"]), "refs/heads/other");

        // HEAD가 움직이지 않은 진짜 실패는 그대로 오류다.
        assert!(engine.switch_branch("missing").await.is_err());
        assert_eq!(git(&dir, &["symbolic-ref", "HEAD"]), "refs/heads/other");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 부분 스태시에 새 파일이 섞여 있어도 전체가 실패하지 않는다.
    #[tokio::test]
    async fn stash_push_paths_accepts_untracked_paths() {
        let dir = temp_repo("partial");
        std::fs::write(dir.join("tracked.txt"), "changed\n").unwrap();
        std::fs::write(dir.join("new.txt"), "new\n").unwrap();
        std::fs::write(dir.join("keep.txt"), "keep\n").unwrap();
        let engine = GitCliEngine::new(&dir);

        let oid = engine
            .stash_push_paths(None, &["tracked.txt".to_string(), "new.txt".to_string()])
            .await
            .unwrap();

        assert!(oid.is_some());
        assert!(!dir.join("new.txt").exists());
        assert!(dir.join("keep.txt").exists(), "고르지 않은 새 파일은 남아야 함");
        assert_eq!(std::fs::read_to_string(dir.join("tracked.txt")).unwrap(), "one\n");
        let _ = std::fs::remove_dir_all(&dir);
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
