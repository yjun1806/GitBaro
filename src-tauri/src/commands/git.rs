// ── Git operation strategy ──────────────────────────────────────────────────
// 읽기 전용 (diff): git2 (libgit2) — 성능 우선
// status: git CLI porcelain v2 — sparse checkout·rename 감지를 git과 일치시킴
// 쓰기 (stage, unstage, discard, commit, stash): GitCliEngine — git과 같은 동작·hooks 보장
// 리모트 (fetch, push, pull): GitCliEngine + AskpassScript — 인증

use crate::commands::auth::resolve_token;
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
    // If an account is provided, look up its name/email for the commit signature
    let account_info: Option<(String, String)> = if let Some(ref id) = account_id {
        let cache = crate::commands::auth::load_accounts_cache()
            .await
            .unwrap_or_default();
        cache.iter().find(|a| a["id"].as_str() == Some(id.as_str())).map(|a| {
            let name = a["username"].as_str().unwrap_or("Unknown").to_string();
            let email = a["email"].as_str().unwrap_or("").to_string();
            (name, email)
        })
    } else {
        None
    };

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let author = account_info.as_ref().map(|(n, e)| (n.as_str(), e.as_str()));
    let oid = engine.commit(&message, amend, author).await?;
    tracing::info!("Committed {}", oid);
    Ok(oid)
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
pub(crate) fn is_auth_error(err: &AppError) -> bool {
    match err {
        AppError::GitCli { message, .. } => {
            let msg = message.to_lowercase();
            msg.contains("authentication failed")
                || msg.contains("could not read username")
                || msg.contains("invalid credentials")
                || msg.contains("401")
                || msg.contains("403")
        }
        _ => false,
    }
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
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
        .with_automatic(automatic.unwrap_or(false));

    match engine.fetch("origin", &token).await {
        Ok(()) => {
            tracing::info!("Fetched origin for {}", repo_path);
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Fetch auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.fetch("origin", &new_token).await?;
            tracing::info!("Fetched origin for {} (after token refresh)", repo_path);
        }
        Err(e) => return Err(e),
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

/// Error for remote operations attempted while HEAD is detached. Without
/// this, `HEAD` would be passed to git as if it were a branch name.
fn detached_head_error() -> AppError {
    AppError::GitCli {
        message: "HEAD is detached (not on a branch). Create or switch to a branch first."
            .to_string(),
        exit_code: None,
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

/// Resolve the current HEAD branch name. Returns error if HEAD is detached.
async fn resolve_head_branch(repo_path: &str) -> Result<String, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        head_branch_name(&repo)?.ok_or_else(detached_head_error)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// Resolve the upstream remote branch name for the current HEAD.
/// Returns error with "no_upstream:<branch>" prefix if no upstream is configured.
async fn resolve_upstream_branch(repo_path: &str) -> Result<String, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let local_name = head_branch_name(&repo)?.ok_or_else(detached_head_error)?;
        let branch = repo.find_branch(&local_name, git2::BranchType::Local)?;
        let upstream = branch.upstream().map_err(|_| AppError::GitCli {
            message: format!("no_upstream:{}", local_name),
            exit_code: None,
        })?;
        let name = upstream
            .name()?
            .unwrap_or("")
            .to_string();
        Ok(name
            .strip_prefix("origin/")
            .unwrap_or(&name)
            .to_string())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
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
    let branch = resolve_head_branch(&repo_path).await?;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let force_flag = force.unwrap_or(false);

    match engine.push("origin", &branch, &token, force_flag).await {
        Ok(()) => {
            tracing::info!("Pushed {} to origin for {}", branch, repo_path);
            Ok(())
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Push auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.push("origin", &branch, &new_token, force_flag).await?;
            tracing::info!("Pushed {} to origin for {} (after token refresh)", branch, repo_path);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Tag names present on `origin`, used to mark local-only tags in the history
/// timeline. Read-only network call; retries once on auth failure.
#[tauri::command]
pub async fn list_remote_tags(
    repo_path: String,
    account_id: String,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Vec<String>, AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);

    match engine.list_remote_tags("origin", &token).await {
        Ok(tags) => Ok(tags),
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("ls-remote auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.list_remote_tags("origin", &new_token).await
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
    let branch = resolve_upstream_branch(&repo_path).await?;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let rebase_flag = rebase.unwrap_or(false);

    match engine.pull("origin", &branch, &token, rebase_flag).await {
        Ok(()) => {
            tracing::info!("Pulled {} from origin for {}", branch, repo_path);
            Ok(())
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Pull auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.pull("origin", &branch, &new_token, rebase_flag).await?;
            tracing::info!("Pulled {} from origin for {} (after token refresh)", branch, repo_path);
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
}
