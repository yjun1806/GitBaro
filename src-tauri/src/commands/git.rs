// ── Git operation strategy ──────────────────────────────────────────────────
// 읽기 전용 (status, diff): git2 (libgit2) — 성능 우선
// 쓰기 + hooks (commit, stash): GitCliEngine — hooks 실행 보장
// 리모트 (fetch, push, pull): GitCliEngine + AskpassScript — 인증

use crate::commands::auth::resolve_token;
use crate::error::AppError;
use crate::events::{
    GitCommandCompleteEvent, GitCommandStartEvent, GIT_COMMAND_COMPLETE, GIT_COMMAND_START,
};
use crate::git::cli::GitCliEngine;
use crate::git::engine::{GitEngine, GitRemoteEngine};
use crate::state::TokenStore;
use serde_json::{json, Value};
use tauri::Emitter;

#[tauri::command]
pub async fn get_status(repo_path: String) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true);
        let statuses = repo.statuses(Some(&mut opts))?;

        let workdir = repo.workdir()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();

        let file_count = statuses.iter().count();
        const DIFF_STATS_THRESHOLD: usize = 300;

        // Build per-file diff stats if file count is within threshold
        let mut diff_stats: std::collections::HashMap<String, (usize, usize)> =
            std::collections::HashMap::new();

        if file_count <= DIFF_STATS_THRESHOLD {
            // Staged diff: tree-to-index
            let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            let staged_diff = repo.diff_tree_to_index(head_tree.as_ref(), None, None)?;

            for idx in 0..staged_diff.deltas().count() {
                if let Ok(Some(patch)) = git2::Patch::from_diff(&staged_diff, idx) {
                    let path = patch.delta().new_file().path()
                        .or_else(|| patch.delta().old_file().path())
                        .map(|p| p.to_string_lossy().to_string());
                    if let (Some(path), Ok((_, ins, del))) = (path, patch.line_stats()) {
                        let entry = diff_stats.entry(path).or_insert((0, 0));
                        entry.0 += ins;
                        entry.1 += del;
                    }
                }
            }

            // Unstaged diff: index-to-workdir
            let mut unstaged_opts = git2::DiffOptions::new();
            unstaged_opts.include_untracked(true);
            let unstaged_diff = repo.diff_index_to_workdir(None, Some(&mut unstaged_opts))?;

            for idx in 0..unstaged_diff.deltas().count() {
                if let Ok(Some(patch)) = git2::Patch::from_diff(&unstaged_diff, idx) {
                    let path = patch.delta().new_file().path()
                        .or_else(|| patch.delta().old_file().path())
                        .map(|p| p.to_string_lossy().to_string());
                    if let (Some(path), Ok((_, ins, del))) = (path, patch.line_stats()) {
                        let entry = diff_stats.entry(path).or_insert((0, 0));
                        entry.0 += ins;
                        entry.1 += del;
                    }
                }
            }
        }

        let entries: Vec<Value> = statuses
            .iter()
            .filter_map(|entry| {
                let path = entry.path()?.to_string();
                let status = entry.status();

                let conflicted = status.contains(git2::Status::CONFLICTED);

                let staged = status.intersects(
                    git2::Status::INDEX_NEW
                        | git2::Status::INDEX_MODIFIED
                        | git2::Status::INDEX_DELETED
                        | git2::Status::INDEX_RENAMED
                        | git2::Status::INDEX_TYPECHANGE,
                );
                let unstaged = status.intersects(
                    git2::Status::WT_MODIFIED
                        | git2::Status::WT_DELETED
                        | git2::Status::WT_RENAMED
                        | git2::Status::WT_TYPECHANGE
                        | git2::Status::WT_NEW,
                );

                let index_status = if status.contains(git2::Status::INDEX_NEW) {
                    "added"
                } else if status.contains(git2::Status::INDEX_MODIFIED) {
                    "modified"
                } else if status.contains(git2::Status::INDEX_DELETED) {
                    "deleted"
                } else if status.contains(git2::Status::INDEX_RENAMED) {
                    "renamed"
                } else {
                    "unchanged"
                };

                let wt_status = if status.contains(git2::Status::WT_NEW) {
                    "untracked"
                } else if status.contains(git2::Status::WT_MODIFIED) {
                    "modified"
                } else if status.contains(git2::Status::WT_DELETED) {
                    "deleted"
                } else if status.contains(git2::Status::WT_RENAMED) {
                    "renamed"
                } else {
                    "unchanged"
                };

                // Filesystem metadata (null for deleted files)
                let is_deleted = status.contains(git2::Status::WT_DELETED)
                    || (status.contains(git2::Status::INDEX_DELETED) && !unstaged);
                let full_path = workdir.join(&path);
                let (modified_at, size_bytes) = if is_deleted || !full_path.exists() {
                    (Value::Null, Value::Null)
                } else {
                    match std::fs::metadata(&full_path) {
                        Ok(meta) => {
                            let mtime = meta.modified().ok().and_then(|t| {
                                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
                            });
                            let size = meta.len();
                            (
                                mtime.map(|s| json!(s)).unwrap_or(Value::Null),
                                json!(size),
                            )
                        }
                        Err(_) => (Value::Null, Value::Null),
                    }
                };

                // Diff stats (null if over threshold)
                let (insertions, deletions) = if file_count > DIFF_STATS_THRESHOLD {
                    (Value::Null, Value::Null)
                } else {
                    match diff_stats.get(&path) {
                        Some((ins, del)) => (json!(ins), json!(del)),
                        None => (json!(0), json!(0)),
                    }
                };

                Some(json!({
                    "path": path,
                    "staged": staged,
                    "unstaged": unstaged,
                    "conflicted": conflicted,
                    "indexStatus": index_status,
                    "worktreeStatus": wt_status,
                    "modifiedAt": modified_at,
                    "insertions": insertions,
                    "deletions": deletions,
                    "sizeBytes": size_bytes,
                }))
            })
            .collect();

        Ok::<_, AppError>(entries)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn stage_files(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().timestamp_millis();
    let path_list = paths.join(", ");
    let _ = app_handle.emit(
        GIT_COMMAND_START,
        GitCommandStartEvent {
            id: id.clone(),
            command: format!("git add {}", path_list),
            operation: "stage".to_string(),
            repo_path: repo_path.clone(),
            started_at,
            automatic: false,
        },
    );

    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut index = repo.index()?;
        let workdir = repo.workdir()
            .ok_or_else(|| AppError::Channel("bare repository".to_string()))?;

        for path in &paths {
            let full = workdir.join(path);
            if full.exists() {
                if full.is_dir() {
                    index.add_all(
                        [format!("{}/*", path)],
                        git2::IndexAddOption::DEFAULT,
                        None,
                    )?;
                } else {
                    index.add_path(std::path::Path::new(path))?;
                }
            } else {
                index.remove_path(std::path::Path::new(path))?;
            }
        }

        index.write()?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    let duration_ms = (chrono::Utc::now().timestamp_millis() - started_at) as u64;
    let _ = app_handle.emit(
        GIT_COMMAND_COMPLETE,
        GitCommandCompleteEvent {
            id,
            operation: "stage".to_string(),
            success: true,
            duration_ms,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: Some(0),
            result_summary: None,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn unstage_files(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().timestamp_millis();
    let path_list = paths.join(", ");
    let _ = app_handle.emit(
        GIT_COMMAND_START,
        GitCommandStartEvent {
            id: id.clone(),
            command: format!("git reset HEAD {}", path_list),
            operation: "unstage".to_string(),
            repo_path: repo_path.clone(),
            started_at,
            automatic: false,
        },
    );

    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;

        // Try to get HEAD commit for resetting; if no commits yet, remove from index directly
        let head_result = repo.head();
        match head_result {
            Ok(head) => {
                let head_commit = head.peel_to_commit()?;
                repo.reset_default(
                    Some(head_commit.as_object()),
                    paths.iter().map(|s| s.as_str()),
                )?;
            }
            Err(_) => {
                // No commits yet — remove from index
                let mut index = repo.index()?;
                for path in &paths {
                    index.remove_path(std::path::Path::new(path))?;
                }
                index.write()?;
            }
        }

        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    let duration_ms = (chrono::Utc::now().timestamp_millis() - started_at) as u64;
    let _ = app_handle.emit(
        GIT_COMMAND_COMPLETE,
        GitCommandCompleteEvent {
            id,
            operation: "unstage".to_string(),
            success: true,
            duration_ms,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: Some(0),
            result_summary: None,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn create_commit(
    app_handle: tauri::AppHandle,
    repo_path: String,
    message: String,
    amend: bool,
    account_id: Option<String>,
) -> Result<String, AppError> {
    let account_info = resolve_commit_identity(account_id.as_deref()).await;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let author = account_info.as_ref().map(|(n, e)| (n.as_str(), e.as_str()));
    let oid = engine.commit(&message, amend, author).await?;
    tracing::info!("Committed {}", oid);
    Ok(oid)
}

/// 계정의 커밋 신원(이름, 이메일)을 계정 캐시에서 찾는다. 계정이 없거나 이메일을
/// 모르면 `None`을 돌려 git 설정의 `user.*`를 따르게 한다.
/// create_commit과 merge·revert·cherry-pick·pull이 같은 신원을 쓰도록 공유한다.
pub(crate) async fn resolve_commit_identity(account_id: Option<&str>) -> Option<(String, String)> {
    let id = account_id?;
    let cache = crate::commands::auth::load_accounts_cache()
        .await
        .unwrap_or_default();
    let account = cache.iter().find(|a| a["id"].as_str() == Some(id))?;
    let name = account["username"].as_str().unwrap_or("Unknown").to_string();
    let email = account["email"].as_str().unwrap_or("").to_string();
    (!email.is_empty()).then_some((name, email))
}

#[tauri::command]
pub async fn get_diff(repo_path: String, staged: bool) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let diff = if staged {
            let head_tree = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, None)?
        } else {
            repo.diff_index_to_workdir(None, None)?
        };

        let stats = diff.stats()?;
        let mut files: Vec<Value> = Vec::new();

        diff.foreach(
            &mut |delta, _progress| {
                let old_path = delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string());
                let new_path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string());

                files.push(json!({
                    "oldPath": old_path,
                    "newPath": new_path,
                    "status": format!("{:?}", delta.status()),
                }));
                true
            },
            None,
            None,
            None,
        )?;

        Ok::<_, AppError>(json!({
            "filesChanged": stats.files_changed(),
            "insertions": stats.insertions(),
            "deletions": stats.deletions(),
            "files": files,
        }))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn discard_changes(repo_path: String, paths: Vec<String>) -> Result<(), AppError> {
    // Discarding is a write op → go through git CLI (hybrid strategy) instead of
    // git2 checkout_index, keeping hook behaviour consistent with other writes.
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.discard_paths(&paths).await?;
    Ok(())
}

/// Check if a git CLI error is an authentication failure.
///
/// `GitCli` 오류 문구는 `parse_git_output_error`가 고른 한 줄이다. 출력 어딘가에
/// 인증 실패 문구가 있으면 그 줄을 고르도록 되어 있어서, 여기서는 문구만 보면
/// 전체 stderr를 본 것과 같다(예: 첫 줄이 `remote: Invalid username or token`).
pub(crate) fn is_auth_error(err: &AppError) -> bool {
    match err {
        AppError::GitCli { message, .. } => crate::git::cli::is_auth_failure_text(message),
        _ => false,
    }
}

// ── Remote resolution ───────────────────────────────────────────────────────
// 원격 이름을 "origin"으로 고정하지 않는다. 브랜치 설정(branch.<name>.remote /
// branch.<name>.merge)을 따르고, 없으면 기본 원격을 고른다.

/// 현재 체크아웃 상태에서 동기화 대상을 정하는 데 필요한 설정.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SyncTarget {
    /// 체크아웃된 로컬 브랜치. detached HEAD나 빈 저장소면 `None`.
    branch: Option<String>,
    /// `(branch.<name>.remote, branch.<name>.merge)`. merge는 `refs/heads/x` 형태.
    upstream: Option<(String, String)>,
    /// 저장소에 등록된 원격 이름.
    remotes: Vec<String>,
    /// `push.default` 값. `upstream`(또는 옛 이름 `tracking`)일 때만 이름이 다른
    /// 추적 브랜치로 push한다.
    push_default: Option<String>,
    /// `branch.<name>.rebase`나 `pull.rebase`가 설정되어 있는지.
    /// 설정되어 있으면 기본 pull은 방식 플래그를 넘기지 않고 설정을 따른다.
    pull_mode_configured: bool,
}

fn remote_error(code: &str) -> AppError {
    AppError::GitCli {
        message: code.to_string(),
        exit_code: None,
    }
}

fn detached_head_error() -> AppError {
    remote_error("HEAD is detached")
}

impl SyncTarget {
    /// 브랜치 설정이 가리키는 원격 (로컬 추적 `.`은 제외).
    fn upstream_remote(&self) -> Option<&str> {
        self.upstream
            .as_ref()
            .map(|(remote, _)| remote.as_str())
            .filter(|remote| *remote != ".")
    }

    /// 추적 설정이 없을 때 쓸 원격: `origin`, 없으면 유일한 원격.
    /// 둘 이상이면 어느 쪽에 토큰을 보낼지 알 수 없으므로 고르지 않는다.
    fn default_remote(&self) -> Result<String, AppError> {
        if self.remotes.iter().any(|r| r == "origin") {
            return Ok("origin".to_string());
        }
        match self.remotes.as_slice() {
            [only] => Ok(only.clone()),
            [] => Err(remote_error("no_remote")),
            _ => Err(remote_error("multiple_remotes")),
        }
    }

    /// fetch·원격 태그 조회 대상. `--all`은 쓰지 않는다. 계정 토큰은 GitHub 계정
    /// 하나의 것이라 다른 원격(다른 호스트일 수 있음)에 보내면 안 된다.
    fn fetch_remote(&self) -> Result<String, AppError> {
        match self.upstream_remote() {
            Some(remote) => Ok(remote.to_string()),
            None => self.default_remote(),
        }
    }

    /// fetch할 원격 목록: 현재 브랜치의 추적 원격과 기본 원격(`origin`).
    /// fork에서 `main`이 `upstream/main`을 추적해도 `origin`을 추적하는 다른
    /// 브랜치들의 앞섬·뒤처짐과 fast-forward가 멈추지 않게 둘 다 받는다.
    /// 기본 원격을 고를 수 없으면(원격 여러 개, origin 없음) 추적 원격만 받는다.
    fn fetch_remotes(&self) -> Result<Vec<String>, AppError> {
        let upstream = self.upstream_remote().map(str::to_string);
        let default = self.default_remote();
        match (upstream, default) {
            (Some(up), Ok(def)) if up != def => Ok(vec![up, def]),
            (Some(up), _) => Ok(vec![up]),
            (None, default) => default.map(|def| vec![def]),
        }
    }

    /// push 대상 `(원격, refspec)`.
    ///
    /// 추적 브랜치 이름이 로컬 이름과 같으면 그 원격에 올린다. 이름이 다르면
    /// (`git checkout -b feature origin/main`) git 기본값(`push.default=simple`)처럼
    /// 추적 브랜치에 올리지 않고, 기본 원격에 같은 이름으로 게시한다. 그러지 않으면
    /// feature 커밋이 확인 없이 원격 main에 올라간다. `push.default=upstream`을
    /// 직접 설정한 경우에만 `local:upstream`으로 올린다.
    fn push_target(&self) -> Result<(String, String), AppError> {
        let branch = self.branch.as_ref().ok_or_else(detached_head_error)?;
        if let (Some((_, merge)), Some(remote)) = (&self.upstream, self.upstream_remote()) {
            let upstream_name = merge.strip_prefix("refs/heads/").unwrap_or(merge);
            if upstream_name == branch {
                return Ok((remote.to_string(), branch.clone()));
            }
            if matches!(self.push_default.as_deref(), Some("upstream" | "tracking")) {
                return Ok((remote.to_string(), format!("{}:{}", branch, merge)));
            }
        }
        Ok((self.default_remote()?, branch.clone()))
    }

    /// pull 방식. 화면에서 고른 방식이 있으면 그대로 쓴다. 없으면 사용자의
    /// `pull.rebase` 설정을 따르고(플래그 없음), 설정이 없을 때만 `--no-rebase`를
    /// 넘겨 "Need to specify how to reconcile divergent branches" 실패를 막는다.
    fn pull_rebase(&self, requested: Option<bool>) -> Option<bool> {
        match requested {
            Some(rebase) => Some(rebase),
            None if self.pull_mode_configured => None,
            None => Some(false),
        }
    }

    /// pull 대상 `(원격, merge ref)`. 추적 설정이 없으면 `no_upstream:<branch>`.
    fn pull_target(&self) -> Result<(String, String), AppError> {
        let branch = self.branch.as_ref().ok_or_else(detached_head_error)?;
        self.upstream
            .clone()
            .ok_or_else(|| remote_error(&format!("no_upstream:{}", branch)))
    }
}

async fn resolve_sync_target(repo_path: &str) -> Result<SyncTarget, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let branch = repo
            .head()
            .ok()
            .filter(|h| h.is_branch())
            .and_then(|h| h.shorthand().map(|s| s.to_string()));
        let config = repo.config()?;
        let upstream = branch.as_ref().and_then(|name| {
            let remote = config.get_string(&format!("branch.{}.remote", name)).ok()?;
            let merge = config.get_string(&format!("branch.{}.merge", name)).ok()?;
            Some((remote, merge))
        });
        let remotes = repo
            .remotes()?
            .iter()
            .flatten()
            .map(|r| r.to_string())
            .collect();
        let push_default = config.get_string("push.default").ok();
        let is_set = |key: &str| config.get_entry(key).is_ok();
        let pull_mode_configured = is_set("pull.rebase")
            || branch
                .as_ref()
                .is_some_and(|name| is_set(&format!("branch.{}.rebase", name)));
        Ok::<_, AppError>(SyncTarget {
            branch,
            upstream,
            remotes,
            push_default,
            pull_mode_configured,
        })
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn git_fetch(
    repo_path: String,
    account_id: String,
    automatic: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let remotes = resolve_sync_target(&repo_path).await?.fetch_remotes()?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
        .with_automatic(automatic.unwrap_or(false));

    let mut token = token;
    let mut refreshed = false;
    for remote in &remotes {
        match engine.fetch(remote, &token).await {
            Ok(()) => {
                tracing::info!("Fetched {} for {}", remote, repo_path);
            }
            Err(e) if is_auth_error(&e) && !refreshed => {
                tracing::warn!("Fetch auth failed, refreshing token for {}", account_id);
                token = token_store.refresh_token(&account_id).await?;
                refreshed = true;
                engine.fetch(remote, &token).await?;
                tracing::info!("Fetched {} for {} (after token refresh)", remote, repo_path);
            }
            Err(e) => return Err(e),
        }
    }

    // GitHub Desktop parity: advance eligible non-current local branches so a
    // fetch from any branch keeps the others (e.g. main) up to date.
    fast_forward_local_branches(&engine, &repo_path).await;
    Ok(())
}

/// Compute local branches that can be fast-forwarded to their upstream after a
/// fetch: has an upstream, is not the current HEAD, and is strictly behind
/// (ahead == 0, behind > 0). Returns `(branch_name, from_oid, to_oid)`.
async fn fast_forward_candidates(
    repo_path: &str,
) -> Result<Vec<(String, String, String)>, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let head_name = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()));

        let mut candidates = Vec::new();
        for branch_result in repo.branches(Some(git2::BranchType::Local))? {
            let (branch, _) = branch_result?;
            let name = match branch.name()? {
                Some(n) => n.to_string(),
                None => continue,
            };
            if head_name.as_deref() == Some(name.as_str()) {
                continue; // never move the checked-out branch
            }
            let upstream = match branch.upstream() {
                Ok(u) => u,
                Err(_) => continue, // no upstream configured
            };
            let (local_oid, up_oid) = match (branch.get().target(), upstream.get().target()) {
                (Some(l), Some(u)) => (l, u),
                _ => continue,
            };
            if local_oid == up_oid {
                continue; // already up to date
            }
            // Pure fast-forward only: local must be a strict ancestor of upstream.
            let (ahead, behind) = repo.graph_ahead_behind(local_oid, up_oid).unwrap_or((0, 0));
            if ahead == 0 && behind > 0 {
                candidates.push((name, local_oid.to_string(), up_oid.to_string()));
            }
        }
        Ok::<_, AppError>(candidates)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// After fetching, fast-forward every eligible non-current local branch to its
/// upstream. Failures are non-fatal — a successful fetch must not fail because
/// one branch could not be advanced (e.g. it is checked out in a worktree).
async fn fast_forward_local_branches(engine: &GitCliEngine, repo_path: &str) {
    let candidates = match fast_forward_candidates(repo_path).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("[git] fast-forward scan failed: {}", e);
            return;
        }
    };
    for (name, from, to) in candidates {
        match engine.fast_forward_branch(&name, &to).await {
            Ok(()) => tracing::info!(
                "[git] fast-forwarded {} {}..{}",
                name,
                &from[..from.len().min(7)],
                &to[..to.len().min(7)]
            ),
            Err(e) => tracing::warn!("[git] skipped fast-forward for {}: {}", name, e),
        }
    }
}

#[tauri::command]
pub async fn git_push(
    repo_path: String,
    account_id: String,
    force: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let (remote, refspec) = resolve_sync_target(&repo_path).await?.push_target()?;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let force_flag = force.unwrap_or(false);

    match engine.push(&remote, &refspec, &token, force_flag).await {
        Ok(()) => {
            tracing::info!("Pushed {} to {} for {}", refspec, remote, repo_path);
            Ok(())
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Push auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.push(&remote, &refspec, &new_token, force_flag).await?;
            tracing::info!("Pushed {} to {} for {} (after token refresh)", refspec, remote, repo_path);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// push가 실제로 올릴 곳. force push 확인 창이 실행될 명령을 그대로 보여주는 데 쓴다.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushTarget {
    pub remote: String,
    pub refspec: String,
}

#[tauri::command]
pub async fn get_push_target(repo_path: String) -> Result<PushTarget, AppError> {
    let (remote, refspec) = resolve_sync_target(&repo_path).await?.push_target()?;
    Ok(PushTarget { remote, refspec })
}

/// Tag names present on the branch's remote, used to mark local-only tags in
/// the history timeline. Read-only network call; retries once on auth failure.
#[tauri::command]
pub async fn list_remote_tags(
    repo_path: String,
    account_id: String,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Vec<String>, AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let remote = resolve_sync_target(&repo_path).await?.fetch_remote()?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);

    match engine.list_remote_tags(&remote, &token).await {
        Ok(tags) => Ok(tags),
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("ls-remote auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.list_remote_tags(&remote, &new_token).await
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn git_pull(
    repo_path: String,
    account_id: String,
    rebase: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let target = resolve_sync_target(&repo_path).await?;
    let (remote, merge_ref) = target.pull_target()?;
    let rebase_flag = target.pull_rebase(rebase);
    let identity = resolve_commit_identity(Some(&account_id)).await;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
        .with_identity(identity);

    match engine.pull(&remote, &merge_ref, &token, rebase_flag).await {
        Ok(()) => {
            tracing::info!("Pulled {} from {} for {}", merge_ref, remote, repo_path);
            Ok(())
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Pull auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.pull(&remote, &merge_ref, &new_token, rebase_flag).await?;
            tracing::info!("Pulled {} from {} for {} (after token refresh)", merge_ref, remote, repo_path);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn stash_push(
    app_handle: tauri::AppHandle,
    repo_path: String,
    message: Option<String>,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_save(message.as_deref()).await?;
    tracing::info!("Stash saved");
    Ok(())
}

#[tauri::command]
pub async fn stash_pop(
    app_handle: tauri::AppHandle,
    repo_path: String,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_pop().await?;
    tracing::info!("Stash popped");
    Ok(())
}

#[tauri::command]
pub async fn stash_list(
    repo_path: String,
) -> Result<Vec<crate::git::engine::StashEntry>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let engine =
            crate::git::libgit::LibGitEngine::open(std::path::Path::new(&repo_path))?;
        engine.stash_list()
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;
    Ok(result)
}

#[tauri::command]
pub async fn stash_apply(
    app_handle: tauri::AppHandle,
    repo_path: String,
    index: usize,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_apply(index).await?;
    tracing::info!("Stash applied: stash@{{{}}}", index);
    Ok(())
}

#[tauri::command]
pub async fn stash_drop(
    app_handle: tauri::AppHandle,
    repo_path: String,
    index: usize,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_drop(index).await?;
    tracing::info!("Stash dropped: stash@{{{}}}", index);
    Ok(())
}

#[tauri::command]
pub async fn stash_show(
    repo_path: String,
    index: usize,
) -> Result<crate::git::engine::StashShowResult, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let engine =
            crate::git::libgit::LibGitEngine::open(std::path::Path::new(&repo_path))?;
        engine.stash_show(index)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;
    Ok(result)
}

#[tauri::command]
pub async fn stash_push_partial(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
    message: Option<String>,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_push_paths(message.as_deref(), &paths).await?;
    tracing::info!("Stash pushed (partial): {} files", paths.len());
    Ok(())
}

/// Append `pattern` to the repo's `.gitignore` (creating it if absent).
/// Skips when an identical trimmed line already exists. Pure file write — no
/// git invocation needed.
#[tauri::command]
pub async fn add_to_gitignore(repo_path: String, pattern: String) -> Result<(), AppError> {
    let log_pattern = pattern.clone();
    tokio::task::spawn_blocking(move || {
        let entry = pattern.trim();
        if entry.is_empty() {
            return Err(AppError::GitCli {
                message: "gitignore pattern cannot be empty".to_string(),
                exit_code: None,
            });
        }
        // 정확히 이 파일만 무시하도록 루트 기준으로 앵커링한다. 선행 슬래시가
        // 없으면 같은 이름의 모든 경로가 무시되므로 '/'를 붙인다.
        let anchored = if entry.starts_with('/') {
            entry.to_string()
        } else {
            format!("/{entry}")
        };
        let path = std::path::Path::new(&repo_path).join(".gitignore");
        // NotFound는 "새로 생성"으로, 그 외 읽기 오류는 전파한다. unwrap_or_default로
        // 삼키면 읽기 실패 시 기존 .gitignore를 통째로 덮어써 내용이 유실될 수 있다.
        let existing = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e.into()),
        };
        if existing.lines().any(|line| line.trim() == anchored) {
            return Ok(()); // 이미 무시 목록에 있음
        }
        let mut content = existing;
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&anchored);
        content.push('\n');
        std::fs::write(&path, content)?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;
    tracing::info!("Added to .gitignore: {}", log_pattern);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &std::path::Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    /// 링크된 워크트리에서도 작업 트리 변경이 보고되어야 한다.
    /// 워크트리의 `.git` 은 디렉토리가 아니라 파일이라, 저장소를 여는 쪽이
    /// 이를 따라가지 못하면 변경이 하나도 안 잡힌다.
    #[tokio::test]
    async fn reports_changes_made_inside_a_linked_worktree() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-wt-status-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let main = tmp.join("main");
        std::fs::create_dir_all(&main).unwrap();

        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["config", "user.email", "t@t"]);
        git(&main, &["config", "user.name", "t"]);
        std::fs::write(main.join("README.md"), "hello\n").unwrap();
        git(&main, &["add", "-A"]);
        git(&main, &["commit", "-qm", "init"]);

        let wt = tmp.join("feature");
        git(&main, &["worktree", "add", "-q", "-b", "feature", wt.to_str().unwrap()]);

        // 워크트리 안에서 추적 파일 수정 + 새 파일 추가
        std::fs::write(wt.join("README.md"), "hello\nchanged in worktree\n").unwrap();
        std::fs::write(wt.join("new-file.txt"), "brand new\n").unwrap();

        let entries = get_status(wt.to_string_lossy().to_string())
            .await
            .expect("워크트리 status 조회 실패");

        let paths: Vec<String> = entries
            .iter()
            .filter_map(|e| e.get("path").and_then(|p| p.as_str()).map(String::from))
            .collect();

        let _ = std::fs::remove_dir_all(&tmp);

        assert!(paths.contains(&"README.md".to_string()), "수정 파일 누락: {:?}", paths);
        assert!(paths.contains(&"new-file.txt".to_string()), "새 파일 누락: {:?}", paths);
    }

    fn target(branch: Option<&str>, upstream: Option<(&str, &str)>, remotes: &[&str]) -> SyncTarget {
        SyncTarget {
            branch: branch.map(String::from),
            upstream: upstream.map(|(r, m)| (r.to_string(), m.to_string())),
            remotes: remotes.iter().map(|r| r.to_string()).collect(),
            push_default: None,
            pull_mode_configured: false,
        }
    }

    fn code(err: AppError) -> String {
        match err {
            AppError::GitCli { message, .. } => message,
            other => other.to_string(),
        }
    }

    #[test]
    fn push_uses_the_tracked_remote_when_the_names_match() {
        let same = target(Some("main"), Some(("upstream", "refs/heads/main")), &["origin", "upstream"]);
        assert_eq!(same.push_target().unwrap(), ("upstream".to_string(), "main".to_string()));
    }

    /// `git checkout -b feature origin/main`으로 만든 브랜치는 main을 추적한다.
    /// git 기본값(push.default=simple)처럼 main에 올리지 않고 feature로 게시해야 한다.
    #[test]
    fn push_never_lands_on_a_differently_named_upstream_by_default() {
        let t = target(Some("feature"), Some(("origin", "refs/heads/main")), &["origin"]);
        assert_eq!(t.push_target().unwrap(), ("origin".to_string(), "feature".to_string()));
        let fork = target(Some("feature"), Some(("upstream", "refs/heads/main")), &["origin", "upstream"]);
        assert_eq!(fork.push_target().unwrap(), ("origin".to_string(), "feature".to_string()));
        let simple = SyncTarget { push_default: Some("simple".into()), ..t.clone() };
        assert_eq!(simple.push_target().unwrap(), ("origin".to_string(), "feature".to_string()));
    }

    #[test]
    fn push_default_upstream_pushes_to_the_tracked_name() {
        let t = SyncTarget {
            push_default: Some("upstream".into()),
            ..target(Some("feature"), Some(("upstream", "refs/heads/main")), &["origin", "upstream"])
        };
        assert_eq!(
            t.push_target().unwrap(),
            ("upstream".to_string(), "feature:refs/heads/main".to_string())
        );
    }

    #[test]
    fn default_pull_follows_the_users_rebase_setting() {
        let unset = target(Some("main"), Some(("origin", "refs/heads/main")), &["origin"]);
        assert_eq!(unset.pull_rebase(None), Some(false));
        assert_eq!(unset.pull_rebase(Some(true)), Some(true));
        let configured = SyncTarget { pull_mode_configured: true, ..unset };
        assert_eq!(configured.pull_rebase(None), None);
        assert_eq!(configured.pull_rebase(Some(false)), Some(false));
    }

    #[test]
    fn first_publish_prefers_origin_then_the_only_remote() {
        let with_origin = target(Some("new"), None, &["fork", "origin"]);
        assert_eq!(with_origin.push_target().unwrap().0, "origin");
        let single = target(Some("new"), None, &["github"]);
        assert_eq!(single.push_target().unwrap(), ("github".to_string(), "new".to_string()));
        assert_eq!(code(target(Some("new"), None, &[]).push_target().unwrap_err()), "no_remote");
        assert_eq!(
            code(target(Some("new"), None, &["a", "b"]).push_target().unwrap_err()),
            "multiple_remotes"
        );
    }

    #[test]
    fn pull_needs_an_upstream_and_follows_it() {
        let t = target(Some("feature"), Some(("upstream", "refs/heads/main")), &["origin", "upstream"]);
        assert_eq!(
            t.pull_target().unwrap(),
            ("upstream".to_string(), "refs/heads/main".to_string())
        );
        assert_eq!(
            code(target(Some("x"), None, &["origin"]).pull_target().unwrap_err()),
            "no_upstream:x"
        );
        assert!(target(None, None, &["origin"]).push_target().is_err());
    }

    #[test]
    fn fetch_follows_the_upstream_remote_or_the_default() {
        let t = target(Some("f"), Some(("upstream", "refs/heads/main")), &["origin", "upstream"]);
        assert_eq!(t.fetch_remote().unwrap(), "upstream");
        let local = target(Some("f"), Some((".", "refs/heads/main")), &["origin"]);
        assert_eq!(local.fetch_remote().unwrap(), "origin");
        let detached = target(None, None, &["github"]);
        assert_eq!(detached.fetch_remote().unwrap(), "github");
    }

    /// fork에서 main이 upstream/main을 추적해도 origin을 계속 받아야 한다.
    #[test]
    fn fetch_covers_the_upstream_remote_and_origin() {
        let fork = target(Some("main"), Some(("upstream", "refs/heads/main")), &["origin", "upstream"]);
        assert_eq!(fork.fetch_remotes().unwrap(), vec!["upstream", "origin"]);
        let plain = target(Some("main"), Some(("origin", "refs/heads/main")), &["origin"]);
        assert_eq!(plain.fetch_remotes().unwrap(), vec!["origin"]);
        let no_default = target(Some("main"), Some(("a", "refs/heads/main")), &["a", "b"]);
        assert_eq!(no_default.fetch_remotes().unwrap(), vec!["a"]);
        let untracked = target(Some("x"), None, &["origin"]);
        assert_eq!(untracked.fetch_remotes().unwrap(), vec!["origin"]);
        assert!(target(Some("x"), None, &["a", "b"]).fetch_remotes().is_err());
    }

    /// origin이 없고, 로컬 브랜치 이름과 추적 브랜치 이름이 다른 저장소에서
    /// 브랜치 설정을 그대로 읽어야 한다.
    #[tokio::test]
    async fn reads_branch_tracking_config_without_origin() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-sync-target-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        git(&tmp, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
        let repo = tmp.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q", "-b", "work"]);
        git(&repo, &["config", "user.email", "t@t"]);
        git(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("a"), "a\n").unwrap();
        git(&repo, &["add", "a"]);
        git(&repo, &["commit", "-qm", "init"]);
        git(&repo, &["remote", "add", "upstream", tmp.join("remote.git").to_str().unwrap()]);
        git(&repo, &["push", "-q", "upstream", "work:main"]);
        git(&repo, &["branch", "-q", "--set-upstream-to=upstream/main"]);
        // 개발자 전역 설정과 무관하게 git 기본값으로 고정한다.
        git(&repo, &["config", "push.default", "simple"]);

        let t = resolve_sync_target(repo.to_str().unwrap()).await;
        git(&repo, &["config", "push.default", "upstream"]);
        git(&repo, &["config", "branch.work.rebase", "true"]);
        let configured = resolve_sync_target(repo.to_str().unwrap()).await;
        let _ = std::fs::remove_dir_all(&tmp);
        let t = t.expect("sync target 조회 실패");
        let configured = configured.expect("sync target 조회 실패");

        assert_eq!(t.branch.as_deref(), Some("work"));
        assert_eq!(t.upstream, Some(("upstream".to_string(), "refs/heads/main".to_string())));
        assert_eq!(t.push_target().unwrap(), ("upstream".to_string(), "work".to_string()));
        assert_eq!(t.fetch_remote().unwrap(), "upstream");
        assert_eq!(
            configured.push_target().unwrap(),
            ("upstream".to_string(), "work:refs/heads/main".to_string())
        );
        assert!(configured.pull_mode_configured);
        assert_eq!(configured.pull_rebase(None), None);
    }

    #[test]
    fn auth_errors_are_detected_from_the_chosen_message() {
        let err = AppError::GitCli {
            message: crate::git::cli::parse_git_error(
                "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/o/r.git/'\n",
            ),
            exit_code: Some(128),
        };
        assert!(is_auth_error(&err));
        let not_auth = AppError::GitCli {
            message: "Need to specify how to reconcile divergent branches.".into(),
            exit_code: Some(128),
        };
        assert!(!is_auth_error(&not_auth));
    }
}
