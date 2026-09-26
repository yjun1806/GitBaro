// ── Git operation strategy ──────────────────────────────────────────────────
// 읽기 전용 (diff): git2 (libgit2) — 성능 우선
// status: git CLI porcelain v2 — sparse checkout·rename 감지를 git과 일치시킴
// 쓰기 (stage, unstage, discard, commit, stash): GitCliEngine — git과 같은 동작·hooks 보장
// 리모트 (fetch, push, pull): GitCliEngine + AskpassScript — 인증

use crate::commands::auth::retry_with_fresh_token;
use crate::error::AppError;
use crate::git::cli::GitCliEngine;
use crate::git::engine::{GitEngine, GitRemoteEngine};
use crate::state::TokenStore;
use serde_json::{json, Value};

#[tauri::command]
pub async fn get_status(repo_path: String) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        // Paths and their states come from the git CLI so sparse checkout,
        // skip-worktree and rename detection behave exactly like git.
        let porcelain = crate::git::status::read_status(std::path::Path::new(&repo_path))?;

        let repo = git2::Repository::open(&repo_path)?;
        let workdir = repo.workdir()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();

        let file_count = porcelain.len();
        const DIFF_STATS_THRESHOLD: usize = 300;

        // Build per-file diff stats if file count is within threshold
        let diff_stats = if file_count <= DIFF_STATS_THRESHOLD {
            collect_diff_stats(&repo)?
        } else {
            std::collections::HashMap::new()
        };

        let entries: Vec<Value> = porcelain
            .iter()
            .map(|entry| {
                let path = &entry.path;

                // Filesystem metadata (null for deleted files)
                let full_path = workdir.join(path);
                let (modified_at, size_bytes) =
                    if entry.is_deleted_in_worktree() || !full_path.exists() {
                        (Value::Null, Value::Null)
                    } else {
                        match std::fs::symlink_metadata(&full_path) {
                            Ok(meta) => {
                                let mtime = meta.modified().ok().and_then(|t| {
                                    t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
                                });
                                (
                                    mtime.map(|s| json!(s)).unwrap_or(Value::Null),
                                    json!(meta.len()),
                                )
                            }
                            Err(_) => (Value::Null, Value::Null),
                        }
                    };

                // Diff stats (null if over threshold)
                let (insertions, deletions) = if file_count > DIFF_STATS_THRESHOLD {
                    (Value::Null, Value::Null)
                } else {
                    match diff_stats.get(path) {
                        Some((ins, del)) => (json!(ins), json!(del)),
                        None => (json!(0), json!(0)),
                    }
                };

                json!({
                    "path": path,
                    "origPath": entry.orig_path,
                    "staged": entry.is_staged(),
                    "unstaged": entry.is_unstaged(),
                    "conflicted": entry.conflicted,
                    "indexStatus": entry.index_status(),
                    "worktreeStatus": entry.worktree_status(),
                    "modifiedAt": modified_at,
                    "insertions": insertions,
                    "deletions": deletions,
                    "sizeBytes": size_bytes,
                })
            })
            .collect();

        Ok::<_, AppError>(entries)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

/// Insertions/deletions per path, summed over the staged (HEAD → index) and
/// unstaged (index → worktree) diffs. Renames are detected on the staged side
/// so a moved file is counted against its new path, not as a whole new file.
fn collect_diff_stats(
    repo: &git2::Repository,
) -> Result<std::collections::HashMap<String, (usize, usize)>, AppError> {
    let mut diff_stats: std::collections::HashMap<String, (usize, usize)> =
        std::collections::HashMap::new();

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut staged_diff = repo.diff_tree_to_index(head_tree.as_ref(), None, None)?;
    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true);
    staged_diff.find_similar(Some(&mut find_opts))?;

    let mut unstaged_opts = git2::DiffOptions::new();
    unstaged_opts.include_untracked(true);
    let unstaged_diff = repo.diff_index_to_workdir(None, Some(&mut unstaged_opts))?;

    for diff in [&staged_diff, &unstaged_diff] {
        for idx in 0..diff.deltas().count() {
            if let Ok(Some(patch)) = git2::Patch::from_diff(diff, idx) {
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
    Ok(diff_stats)
}

#[tauri::command]
pub async fn stage_files(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stage_paths(&paths).await
}

#[tauri::command]
pub async fn unstage_files(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.unstage_paths(&paths).await
}

/// Paths among `paths` whose working-tree file still contains merge conflict
/// markers (a line starting with `<<<<<<<` or `>>>>>>>`). Staging such a file
/// marks the conflict resolved, so the UI asks before doing it.
#[tauri::command]
pub async fn find_conflict_markers(
    repo_path: String,
    paths: Vec<String>,
) -> Result<Vec<String>, AppError> {
    tokio::task::spawn_blocking(move || {
        let root = std::path::Path::new(&repo_path);
        Ok(paths
            .into_iter()
            .filter(|p| {
                std::fs::read(root.join(p))
                    .map(|bytes| has_conflict_markers(&bytes))
                    .unwrap_or(false)
            })
            .collect())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

fn has_conflict_markers(content: &[u8]) -> bool {
    content
        .split(|b| *b == b'\n')
        .any(|line| line.starts_with(b"<<<<<<<") || line.starts_with(b">>>>>>>"))
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
    let email = crate::commands::auth::cached_commit_email(Some(account), &name);
    Some((name, email))
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

/// How each path of a discard request is brought back to its clean state.
#[derive(Debug, Default, PartialEq, Eq)]
struct DiscardPlan {
    /// Tracked paths restored from the index (`git checkout -- <path>`).
    from_index: Vec<String>,
    /// Paths restored in both index and worktree from HEAD.
    from_head: Vec<String>,
    /// Paths that exist only in the index and are dropped from it.
    remove_from_index: Vec<String>,
    /// Working-tree files moved to the Trash (untracked or index-only files).
    trash: Vec<std::path::PathBuf>,
}

/// `GIT_INDEX_ENTRY_INTENT_TO_ADD` (libgit2 `index.h`): set by `git add -N`.
const INDEX_ENTRY_INTENT_TO_ADD: u16 = 1 << 13;

/// Decide how to discard `paths`. `staged == false` discards the unstaged
/// changes only (the staged part is kept); `staged == true` discards every
/// change to the file, returning it to its HEAD state.
fn plan_discard(
    repo: &git2::Repository,
    paths: &[String],
    staged: bool,
) -> Result<DiscardPlan, AppError> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| AppError::Channel("bare repository".to_string()))?
        .to_path_buf();
    let index = repo.index()?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut plan = DiscardPlan::default();

    for path in paths {
        let rel = std::path::Path::new(path);
        let full = workdir.join(rel);
        let on_disk = std::fs::symlink_metadata(&full).is_ok();
        let index_entry = index.get_path(rel, 0);
        let in_index = index_entry.is_some();
        let in_head = head_tree
            .as_ref()
            .is_some_and(|tree| tree.get_path(rel).is_ok());
        // `git add -N` leaves an empty placeholder entry: the file is still new,
        // and restoring it from the index would truncate it to nothing.
        let intent_to_add = index_entry
            .is_some_and(|e| e.flags_extended & INDEX_ENTRY_INTENT_TO_ADD != 0);

        if !staged && intent_to_add {
            plan.remove_from_index.push(path.clone());
            if on_disk {
                plan.trash.push(full);
            }
        } else if !staged {
            if in_index {
                plan.from_index.push(path.clone());
            } else if on_disk {
                plan.trash.push(full);
            }
        } else if in_head {
            plan.from_head.push(path.clone());
        } else if in_index {
            plan.remove_from_index.push(path.clone());
            if on_disk {
                plan.trash.push(full);
            }
        }
    }
    Ok(plan)
}

fn move_to_trash(paths: &[std::path::PathBuf]) -> Result<(), AppError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        // NSFileManager needs no Finder automation permission prompt.
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete_all(paths).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

/// Discard changes to `paths`. Untracked and index-only files are moved to
/// the Trash rather than deleted, so a mistaken discard can be recovered.
#[tauri::command]
pub async fn discard_changes(
    repo_path: String,
    paths: Vec<String>,
    staged: Option<bool>,
) -> Result<(), AppError> {
    let staged = staged.unwrap_or(false);
    let rp = repo_path.clone();
    let plan = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        plan_discard(&repo, &paths, staged)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    // Discarding is a write op → git CLI (hybrid strategy).
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    if !plan.from_index.is_empty() {
        engine.discard_paths(&plan.from_index).await?;
    }
    if !plan.from_head.is_empty() {
        engine.restore_paths_from_head(&plan.from_head).await?;
    }
    if !plan.remove_from_index.is_empty() {
        engine.remove_paths_from_index(&plan.remove_from_index).await?;
    }
    let trash = plan.trash;
    tokio::task::spawn_blocking(move || move_to_trash(&trash))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))??;
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

/// 인증 실패 중 자격 증명 자체가 없거나 거절된 경우. 토큰은 통했지만 저장소 권한이 없는
/// 경우(`Permission to o/r denied to user`, HTTP 403)는 다시 로그인해도 풀리지 않으므로 뺀다.
fn is_credential_rejected(err: &AppError) -> bool {
    match err {
        AppError::GitCli { message, .. } => {
            let lower = message.to_lowercase();
            is_auth_error(err) && !lower.contains("denied to") && !lower.contains("error: 403")
        }
        _ => false,
    }
}

/// 원격 작업 하나를 저장소 계정의 토큰으로 실행한다. git이 인증에 실패하면 gh에서 토큰을
/// 한 번 새로 받아 다시 실행하고(`retry_with_fresh_token`), 그래도 자격 증명이 거절되면
/// git 원문 대신 계정 이름을 담은 `TokenExpired`로 돌려준다.
async fn run_with_account_token<T, F, Fut>(
    token_store: &TokenStore,
    account_id: &str,
    call: F,
) -> Result<T, AppError>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    retry_with_fresh_token(token_store, account_id, is_auth_error, call)
        .await
        .map_err(|e| sign_in_error(e, account_id))
}

/// 원격 작업의 자격 증명 실패를 사용자가 할 일이 드러나는 오류로 바꾼다.
/// - git이 자격 증명을 물어보지 못함 → `credential_prompt_blocked` 코드. 로그인 문제가 아니다.
/// - 재시도 뒤에도 자격 증명이 거절됨 → 계정 이름을 담은 `TokenExpired`.
fn sign_in_error(err: AppError, account_id: &str) -> AppError {
    if let AppError::GitCli { message, .. } = &err {
        if crate::git::cli::is_credential_prompt_blocked_text(message) {
            tracing::warn!("[git] git could not ask for credentials: {}", message);
            return remote_error("credential_prompt_blocked");
        }
    }
    if !is_credential_rejected(&err) {
        return err;
    }
    tracing::warn!("[git] credentials for {} rejected after refresh: {}", account_id, err);
    AppError::TokenExpired {
        account_id: account_id.to_string(),
    }
}

// ── Remote resolution ───────────────────────────────────────────────────────
// 원격 이름을 "origin"으로 고정하지 않는다. 브랜치 설정(branch.<name>.remote /
// branch.<name>.merge)을 따르고, 없으면 기본 원격을 고른다.

/// 현재 체크아웃 상태에서 동기화 대상을 정하는 데 필요한 설정.
/// 여러 저장소 원격 작업 확인 창(`commands/remote_plan.rs`)도 같은 값을 읽어 실행될 명령을 보여 준다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SyncTarget {
    /// 체크아웃된 로컬 브랜치. detached HEAD나 빈 저장소면 `None`.
    pub(crate) branch: Option<String>,
    /// `(branch.<name>.remote, branch.<name>.merge)`. merge는 `refs/heads/x` 형태.
    pub(crate) upstream: Option<(String, String)>,
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

/// Error for remote operations attempted while HEAD is detached. Without
/// this, `HEAD` would be passed to git as if it were a branch name.
fn detached_head_error() -> AppError {
    remote_error("detached_head")
}

impl SyncTarget {
    /// 브랜치 설정이 가리키는 원격 (로컬 추적 `.`은 제외).
    pub(crate) fn upstream_remote(&self) -> Option<&str> {
        self.upstream
            .as_ref()
            .map(|(remote, _)| remote.as_str())
            .filter(|remote| *remote != ".")
    }

    /// 추적 설정이 없을 때 쓸 원격: `origin`, 없으면 유일한 원격.
    /// 둘 이상이면 어느 쪽에 토큰을 보낼지 알 수 없으므로 고르지 않는다.
    pub(crate) fn default_remote(&self) -> Result<String, AppError> {
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
    pub(crate) fn fetch_remotes(&self) -> Result<Vec<String>, AppError> {
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
    pub(crate) fn push_target(&self) -> Result<(String, String), AppError> {
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
    pub(crate) fn pull_rebase(&self, requested: Option<bool>) -> Option<bool> {
        match requested {
            Some(rebase) => Some(rebase),
            None if self.pull_mode_configured => None,
            None => Some(false),
        }
    }

    /// pull 대상 `(원격, merge ref)`. 추적 설정이 없으면 `no_upstream:<branch>`.
    pub(crate) fn pull_target(&self) -> Result<(String, String), AppError> {
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
        sync_target_from_repo(&repo)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// 열린 저장소에서 동기화 대상을 읽는다. git2 호출이므로 `spawn_blocking` 안에서 부른다.
pub(crate) fn sync_target_from_repo(repo: &git2::Repository) -> Result<SyncTarget, AppError> {
    // An unborn HEAD (empty repository) has no branch to sync either.
    let branch = head_branch_name(repo).ok().flatten();
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
    Ok(SyncTarget {
        branch,
        upstream,
        remotes,
        push_default,
        pull_mode_configured,
    })
}

#[tauri::command]
pub async fn git_fetch(
    repo_path: String,
    account_id: String,
    automatic: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let remotes = resolve_sync_target(&repo_path).await?.fetch_remotes()?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
        .with_automatic(automatic.unwrap_or(false));

    for remote in &remotes {
        run_with_account_token(&token_store, &account_id, |token| {
            let (engine, remote) = (&engine, remote);
            async move { engine.fetch(remote, &token).await }
        })
        .await?;
        tracing::info!("Fetched {} for {}", remote, repo_path);
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

/// Name of the branch HEAD points to, or `None` when HEAD is detached.
/// (`shorthand()` alone returns "HEAD" for a detached HEAD.)
fn head_branch_name(repo: &git2::Repository) -> Result<Option<String>, AppError> {
    let head = repo.head()?;
    Ok(head
        .is_branch()
        .then(|| head.shorthand().map(|s| s.to_string()))
        .flatten())
}

#[tauri::command]
pub async fn git_push(
    repo_path: String,
    account_id: String,
    force: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let (remote, refspec) = resolve_sync_target(&repo_path).await?.push_target()?;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let force_flag = force.unwrap_or(false);

    run_with_account_token(&token_store, &account_id, |token| {
        let (engine, remote, refspec) = (&engine, &remote, &refspec);
        async move { engine.push(remote, refspec, &token, force_flag).await }
    })
    .await?;
    tracing::info!("Pushed {} to {} for {}", refspec, remote, repo_path);
    Ok(())
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
    let remote = resolve_sync_target(&repo_path).await?.fetch_remote()?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);

    run_with_account_token(&token_store, &account_id, |token| {
        let (engine, remote) = (&engine, &remote);
        async move { engine.list_remote_tags(remote, &token).await }
    })
    .await
}

#[tauri::command]
pub async fn git_pull(
    repo_path: String,
    account_id: String,
    rebase: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let target = resolve_sync_target(&repo_path).await?;
    let (remote, merge_ref) = target.pull_target()?;
    let rebase_flag = target.pull_rebase(rebase);
    let identity = resolve_commit_identity(Some(&account_id)).await;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
        .with_identity(identity);

    run_with_account_token(&token_store, &account_id, |token| {
        let (engine, remote, merge_ref) = (&engine, &remote, &merge_ref);
        async move { engine.pull(remote, merge_ref, &token, rebase_flag).await }
    })
    .await?;
    tracing::info!("Pulled {} from {} for {}", merge_ref, remote, repo_path);
    Ok(())
}

#[tauri::command]
pub async fn stash_push(
    app_handle: tauri::AppHandle,
    repo_path: String,
    message: Option<String>,
) -> Result<Option<String>, AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let created = engine.stash_save(message.as_deref()).await?;
    tracing::info!("Stash saved: {:?}", created);
    Ok(created)
}

#[tauri::command]
pub async fn stash_pop(
    app_handle: tauri::AppHandle,
    repo_path: String,
    index: usize,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_pop_index(index).await?;
    tracing::info!("Stash popped: stash@{{{}}}", index);
    Ok(())
}

/// Pop the stash a `stash_push` call returned, found by its commit id so that
/// stashes made in the meantime cannot shift it to a different index.
#[tauri::command]
pub async fn stash_pop_by_oid(
    app_handle: tauri::AppHandle,
    repo_path: String,
    oid: String,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_pop_oid(&oid).await?;
    tracing::info!("Stash popped: {}", oid);
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
) -> Result<Option<String>, AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let created = engine.stash_push_paths(message.as_deref(), &paths).await?;
    tracing::info!("Stash pushed (partial): {} files", paths.len());
    Ok(created)
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

    /// 커밋 하나가 있는 임시 저장소를 만든다. 테스트마다 다른 이름을 쓴다.
    fn temp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gitbaro-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "t@t"]);
        git(&dir, &["config", "user.name", "t"]);
        std::fs::write(dir.join("README.md"), "hello\n").unwrap();
        std::fs::write(dir.join("-dash.txt"), "dash\n").unwrap();
        std::fs::write(dir.join("a b.txt"), "space\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);
        dir
    }

    fn entry<'a>(entries: &'a [Value], path: &str) -> Option<&'a Value> {
        entries.iter().find(|e| e["path"] == path)
    }

    fn staged_paths(dir: &std::path::Path) -> Vec<String> {
        let out = Command::new("git")
            .args(["diff", "--cached", "--name-only", "-z"])
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout)
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
    }

    /// `git mv`는 삭제+추가가 아니라 이름 변경 하나로 보고되어야 한다.
    #[tokio::test]
    async fn status_reports_staged_rename_with_original_path() {
        let dir = temp_repo("status-rename");
        git(&dir, &["mv", "a b.txt", "c d.txt"]);

        let entries = get_status(dir.to_string_lossy().to_string()).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(entries.len(), 1, "{:?}", entries);
        let e = &entries[0];
        assert_eq!(e["path"], "c d.txt");
        assert_eq!(e["origPath"], "a b.txt");
        assert_eq!(e["indexStatus"], "renamed");
        assert_eq!(e["staged"], true);
    }

    /// diff.renames=copies 설정이 있어도 복사본은 원본 경로 없이 추가로만 보여야 한다.
    /// 복사 행에서 stage/unstage/discard 할 때 원본 파일의 변경을 건드리지 않게 하기 위함.
    #[tokio::test]
    async fn status_never_reports_copies() {
        let dir = temp_repo("status-copies");
        git(&dir, &["config", "diff.renames", "copies"]);
        git(&dir, &["config", "status.renames", "copies"]);
        let original = std::fs::read(dir.join("README.md")).unwrap();
        std::fs::write(dir.join("copy.md"), &original).unwrap();
        let mut changed = original.clone();
        changed.extend_from_slice(b"more\n");
        std::fs::write(dir.join("README.md"), &changed).unwrap();
        git(&dir, &["add", "-A"]);

        let entries = get_status(dir.to_string_lossy().to_string()).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        let copy = entries.iter().find(|e| e["path"] == "copy.md").expect("copy row");
        assert_eq!(copy["indexStatus"], "added", "{:?}", entries);
        assert!(copy["origPath"].is_null(), "{:?}", entries);
    }

    /// skip-worktree(sparse checkout) 파일은 디스크에 없어도 삭제로 보이면 안 된다.
    #[tokio::test]
    async fn status_ignores_skip_worktree_files() {
        let dir = temp_repo("status-sparse");
        git(&dir, &["update-index", "--skip-worktree", "README.md"]);
        std::fs::remove_file(dir.join("README.md")).unwrap();

        let entries = get_status(dir.to_string_lossy().to_string()).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        assert!(entries.is_empty(), "sparse 파일이 변경으로 보임: {:?}", entries);
    }

    #[tokio::test]
    async fn stage_and_unstage_handle_special_paths_and_deletions() {
        let dir = temp_repo("stage-cli");
        std::fs::write(dir.join("-dash.txt"), "changed\n").unwrap();
        std::fs::remove_file(dir.join("a b.txt")).unwrap();
        std::fs::write(dir.join("*.txt"), "literal\n").unwrap();
        std::fs::write(dir.join("other.txt"), "must stay unstaged\n").unwrap();
        let engine = GitCliEngine::new(&dir);

        engine
            .stage_paths(&["-dash.txt".into(), "a b.txt".into(), "*.txt".into()])
            .await
            .unwrap();
        let mut staged = staged_paths(&dir);
        staged.sort();
        assert_eq!(staged, vec!["*.txt", "-dash.txt", "a b.txt"]);

        engine.unstage_paths(&["-dash.txt".into(), "*.txt".into()]).await.unwrap();
        assert_eq!(staged_paths(&dir), vec!["a b.txt"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 첫 커밋 전(unborn HEAD)에도 언스테이징이 되어야 한다.
    #[tokio::test]
    async fn unstage_works_before_the_first_commit() {
        let dir = std::env::temp_dir().join(format!("gitbaro-unborn-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q"]);
        std::fs::write(dir.join("new.txt"), "x\n").unwrap();
        let engine = GitCliEngine::new(&dir);
        engine.stage_paths(&["new.txt".into()]).await.unwrap();
        assert_eq!(staged_paths(&dir), vec!["new.txt"]);
        engine.unstage_paths(&["new.txt".into()]).await.unwrap();
        let entries = get_status(dir.to_string_lossy().to_string()).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(entry(&entries, "new.txt").unwrap()["worktreeStatus"], "untracked");
    }

    #[test]
    fn plans_discard_per_file_state() {
        let dir = temp_repo("discard-plan");
        std::fs::write(dir.join("untracked.txt"), "u\n").unwrap();
        std::fs::write(dir.join("added.txt"), "a\n").unwrap();
        git(&dir, &["add", "added.txt"]);
        std::fs::write(dir.join("README.md"), "changed\n").unwrap();
        let repo = git2::Repository::open(&dir).unwrap();
        let workdir = repo.workdir().unwrap().to_path_buf();
        let paths: Vec<String> =
            vec!["untracked.txt".into(), "added.txt".into(), "README.md".into()];

        let unstaged = plan_discard(&repo, &paths, false).unwrap();
        assert_eq!(unstaged.from_index, vec!["added.txt", "README.md"]);
        assert_eq!(unstaged.trash, vec![workdir.join("untracked.txt")]);
        assert!(unstaged.from_head.is_empty() && unstaged.remove_from_index.is_empty());

        let staged = plan_discard(&repo, &paths[1..], true).unwrap();
        assert_eq!(staged.from_head, vec!["README.md"]);
        assert_eq!(staged.remove_from_index, vec!["added.txt"]);
        assert_eq!(staged.trash, vec![workdir.join("added.txt")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `git add -N` 파일은 새 파일이다. 버리면 빈 파일로 덮지 말고 휴지통으로 보내야 한다.
    #[test]
    fn plans_discard_of_an_intent_to_add_file_as_a_new_file() {
        let dir = temp_repo("discard-ita");
        std::fs::write(dir.join("ita.txt"), "hi\n").unwrap();
        git(&dir, &["add", "-N", "ita.txt"]);
        let repo = git2::Repository::open(&dir).unwrap();
        let workdir = repo.workdir().unwrap().to_path_buf();

        let plan = plan_discard(&repo, &["ita.txt".into()], false).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(plan.from_index.is_empty(), "{:?}", plan);
        assert_eq!(plan.remove_from_index, vec!["ita.txt"]);
        assert_eq!(plan.trash, vec![workdir.join("ita.txt")]);
    }

    /// 스테이징된 변경을 버리면 HEAD 상태로 돌아가야 한다(인덱스·작업 트리 모두).
    #[tokio::test]
    async fn discarding_a_staged_change_restores_head() {
        let dir = temp_repo("discard-staged");
        std::fs::write(dir.join("a b.txt"), "staged\n").unwrap();
        git(&dir, &["add", "a b.txt"]);
        std::fs::write(dir.join("a b.txt"), "staged\nand unstaged\n").unwrap();

        discard_changes(dir.to_string_lossy().to_string(), vec!["a b.txt".into()], Some(true))
            .await
            .unwrap();

        let content = std::fs::read_to_string(dir.join("a b.txt")).unwrap();
        let entries = get_status(dir.to_string_lossy().to_string()).await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(content, "space\n");
        assert!(entries.is_empty(), "{:?}", entries);
    }

    /// 스테이징 안 된 변경만 버리면 스테이징된 부분은 남아야 한다.
    #[tokio::test]
    async fn discarding_unstaged_changes_keeps_the_staged_part() {
        let dir = temp_repo("discard-unstaged");
        std::fs::write(dir.join("README.md"), "staged\n").unwrap();
        git(&dir, &["add", "README.md"]);
        std::fs::write(dir.join("README.md"), "staged\nunstaged\n").unwrap();

        discard_changes(dir.to_string_lossy().to_string(), vec!["README.md".into()], Some(false))
            .await
            .unwrap();

        let content = std::fs::read_to_string(dir.join("README.md")).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(content, "staged\n");
    }

    #[test]
    fn detects_conflict_markers() {
        assert!(has_conflict_markers(b"a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n"));
        assert!(!has_conflict_markers(b"title\n=======\nbody\n"));
    }

    #[test]
    fn detached_head_has_no_branch_name() {
        let dir = temp_repo("detached");
        git(&dir, &["checkout", "-q", "--detach"]);
        let repo = git2::Repository::open(&dir).unwrap();
        let name = head_branch_name(&repo).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(name, None);
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
        assert_eq!(code(target(None, None, &["origin"]).push_target().unwrap_err()), "detached_head");
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

    #[test]
    fn blocked_prompts_and_missing_access_are_not_sign_in_problems() {
        // git never asked GIT_ASKPASS: a fresh token or a new login would not help.
        let no_prompt = AppError::GitCli {
            message: crate::git::cli::parse_git_error("fatal: unable to get password from user\n"),
            exit_code: Some(128),
        };
        assert!(!is_auth_error(&no_prompt));
        match sign_in_error(no_prompt, "octocat") {
            AppError::GitCli { message, .. } => assert_eq!(message, "credential_prompt_blocked"),
            other => panic!("expected credential_prompt_blocked, got {:?}", other),
        }

        let denied = AppError::GitCli {
            message: crate::git::cli::parse_git_error(
                "remote: Permission to o/r.git denied to someone.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403\n",
            ),
            exit_code: Some(128),
        };
        assert!(is_auth_error(&denied));
        assert!(!is_credential_rejected(&denied));
    }

    #[test]
    fn rejected_credentials_name_the_account() {
        let rejected = AppError::GitCli {
            message: "Authentication failed for 'https://github.com/o/r.git/'".into(),
            exit_code: Some(128),
        };
        match sign_in_error(rejected, "octocat") {
            AppError::TokenExpired { account_id } => assert_eq!(account_id, "octocat"),
            other => panic!("expected TokenExpired, got {:?}", other),
        }
        let offline = AppError::GitCli {
            message: "Could not resolve host: github.com".into(),
            exit_code: Some(128),
        };
        assert!(matches!(sign_in_error(offline, "octocat"), AppError::GitCli { .. }));
    }

    #[tokio::test]
    async fn other_git_failures_pass_through_unchanged() {
        let store = TokenStore::new();
        store.set_token("octocat", "fake-token".into()).await;
        let result: Result<(), AppError> = run_with_account_token(&store, "octocat", |_token| async {
            Err(AppError::GitCli {
                message: "Need to specify how to reconcile divergent branches.".into(),
                exit_code: Some(128),
            })
        })
        .await;
        assert!(matches!(result, Err(AppError::GitCli { .. })));
    }
}
