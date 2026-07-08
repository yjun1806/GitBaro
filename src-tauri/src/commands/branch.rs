use crate::error::AppError;
use crate::git::branch::validate_branch_name;
use crate::git::cli::GitCliEngine;
use crate::git::commit::commit_to_info;
use crate::git::engine::{BranchCompareResult, MergePreCheckResult, MergeStrategy};
use serde_json::{json, Value};

fn is_fully_merged(repo: &git2::Repository, branch_oid: git2::Oid, default_oid: git2::Oid) -> bool {
    repo.graph_descendant_of(default_oid, branch_oid).unwrap_or(false)
}

#[tauri::command]
pub async fn get_branches(repo_path: String) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let branches = repo.branches(None)?;

        // origin/HEAD로부터 default branch 이름 판별
        let default_branch_name = repo
            .find_reference("refs/remotes/origin/HEAD")
            .ok()
            .and_then(|r| r.symbolic_target().map(|s| s.to_string()))
            .and_then(|s| s.strip_prefix("refs/remotes/origin/").map(|n| n.to_string()));

        // default branch OID (isFullyMerged 계산용)
        let default_oid = default_branch_name.as_deref().and_then(|name| {
            repo.find_branch(name, git2::BranchType::Local)
                .ok()
                .and_then(|b| b.get().target())
        });

        // HEAD 이름 기준으로 is_head 판별 (워크트리에서도 올바르게 동작)
        let head_name = repo.head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()));

        // HEAD의 OID (현재 브랜치 기준 ahead/behind 계산용)
        let head_oid = repo.head().ok().and_then(|h| h.target());

        let mut list: Vec<Value> = Vec::new();
        for item in branches {
            let (branch, branch_type) = item?;
            let name = match branch.name()? {
                Some(n) => n.to_string(),
                None => continue,
            };
            let is_remote = branch_type == git2::BranchType::Remote;

            // origin/HEAD 같은 심볼릭 참조 제외
            if is_remote && name.ends_with("/HEAD") {
                continue;
            }

            let is_head = !is_remote && head_name.as_deref() == Some(name.as_str());

            let branch_commit = branch
                .get()
                .target()
                .and_then(|oid| repo.find_commit(oid).ok());

            let last_commit_time = branch_commit.as_ref().map(|c| c.time().seconds());

            let last_commit_author = branch_commit.as_ref().map(|c| {
                json!({
                    "name": c.author().name().unwrap_or_default(),
                    "email": c.author().email().unwrap_or_default(),
                })
            });

            let upstream_branch = branch.upstream().ok();
            let upstream = upstream_branch
                .as_ref()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));

            // Calculate ahead/behind if upstream exists
            let ahead_behind = if let Some(ref ub) = upstream_branch {
                let local_oid = branch.get().target();
                let upstream_oid = ub.get().target();
                match (local_oid, upstream_oid) {
                    (Some(local), Some(remote)) => {
                        repo.graph_ahead_behind(local, remote)
                            .ok()
                            .map(|(ahead, behind)| json!({ "ahead": ahead, "behind": behind }))
                    }
                    _ => None,
                }
            } else {
                None
            };

            // 현재 브랜치(HEAD) 기준 ahead/behind
            let ahead_behind_head = if !is_head {
                let branch_oid = branch.get().target();
                match (branch_oid, head_oid) {
                    (Some(b), Some(h)) => {
                        repo.graph_ahead_behind(b, h)
                            .ok()
                            .map(|(ahead, behind)| json!({ "ahead": ahead, "behind": behind }))
                    }
                    _ => None,
                }
            } else {
                None
            };

            let is_default = !is_remote
                && default_branch_name.as_deref() == Some(name.as_str());

            // 로컬 non-default 브랜치에 대해 isFullyMerged 계산
            let fully_merged = if !is_remote && !is_default {
                match (branch.get().target(), default_oid) {
                    (Some(branch_oid), Some(def_oid)) => {
                        is_fully_merged(&repo, branch_oid, def_oid)
                    }
                    _ => false,
                }
            } else {
                false
            };

            list.push(json!({
                "name": name,
                "isHead": is_head,
                "isRemote": is_remote,
                "isDefault": is_default,
                "upstream": upstream,
                "aheadBehind": ahead_behind,
                "aheadBehindHead": ahead_behind_head,
                "lastCommitTime": last_commit_time,
                "lastCommitAuthor": last_commit_author,
                "isFullyMerged": fully_merged,
            }));
        }

        // 최근 커밋 순 정렬 (최신이 위로)
        list.sort_by(|a, b| {
            let ta = a["lastCommitTime"].as_i64().unwrap_or(0);
            let tb = b["lastCommitTime"].as_i64().unwrap_or(0);
            tb.cmp(&ta)
        });

        Ok::<_, AppError>(list)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn create_branch(
    repo_path: String,
    name: String,
    from: Option<String>,
) -> Result<(), AppError> {
    validate_branch_name(&name)?;
    let branch_name = name.clone();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;

        let commit = if let Some(ref from_ref) = from {
            let obj = repo.revparse_single(from_ref)?;
            obj.peel_to_commit()?
        } else {
            repo.head()?.peel_to_commit()?
        };

        repo.branch(&branch_name, &commit, false)?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!("Created branch: {}", name);
    Ok(())
}

enum SwitchTarget {
    /// Check out an existing local branch as-is.
    Local(String),
    /// Create a local branch tracking a remote-tracking branch, then check out.
    TrackRemote { start_point: String, local: String },
}

/// Strip the configured remote's prefix from a remote-tracking branch name,
/// e.g. "origin/feature/x" -> "feature/x".
fn remote_branch_short_name(repo: &git2::Repository, name: &str) -> Option<String> {
    let remotes = repo.remotes().ok()?;
    for remote in remotes.iter().flatten() {
        let prefix = format!("{remote}/");
        if let Some(short) = name.strip_prefix(&prefix) {
            if !short.is_empty() {
                return Some(short.to_string());
            }
        }
    }
    None
}

/// Classify a switch target: an existing local branch is checked out directly;
/// a remote-tracking branch with no local counterpart becomes a new local
/// tracking branch (GitHub Desktop behavior) instead of a detached HEAD.
async fn resolve_switch_target(repo_path: &str, name: &str) -> Result<SwitchTarget, AppError> {
    let rp = repo_path.to_string();
    let name = name.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;

        if repo.find_branch(&name, git2::BranchType::Local).is_ok() {
            return Ok(SwitchTarget::Local(name));
        }

        if repo.find_branch(&name, git2::BranchType::Remote).is_ok() {
            if let Some(short) = remote_branch_short_name(&repo, &name) {
                // A local branch of that name already exists → just switch to it.
                if repo.find_branch(&short, git2::BranchType::Local).is_ok() {
                    return Ok(SwitchTarget::Local(short));
                }
                return Ok(SwitchTarget::TrackRemote {
                    start_point: name,
                    local: short,
                });
            }
        }

        // Unknown ref: preserve prior behavior; git surfaces a clear error.
        Ok(SwitchTarget::Local(name))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn switch_branch(
    app_handle: tauri::AppHandle,
    repo_path: String,
    name: String,
) -> Result<(), AppError> {
    let target = resolve_switch_target(&repo_path, &name).await?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    match target {
        SwitchTarget::Local(branch) => engine.switch_branch(&branch).await?,
        SwitchTarget::TrackRemote { start_point, local } => {
            engine.checkout_tracking_branch(&start_point, &local).await?
        }
    }
    tracing::info!("Switched to branch: {}", name);
    Ok(())
}

#[tauri::command]
pub async fn delete_branch(repo_path: String, name: String) -> Result<(), AppError> {
    let branch_name = name.clone();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut branch = repo.find_branch(&branch_name, git2::BranchType::Local)?;
        branch.delete()?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!("Deleted branch: {}", name);
    Ok(())
}

#[tauri::command]
pub async fn get_current_branch(repo_path: String) -> Result<Option<String>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let head = match repo.head() {
            Ok(h) => h,
            Err(_) => return Ok::<_, AppError>(None),
        };
        let name = head.shorthand().map(|s| s.to_string());
        Ok::<_, AppError>(name)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn compare_branches(
    repo_path: String,
    base_branch: String,
    compare_branch: String,
) -> Result<BranchCompareResult, AppError> {
    let base = base_branch.clone();
    let compare = compare_branch.clone();

    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;

        let base_oid = repo
            .revparse_single(&format!("refs/heads/{}", base))?
            .peel_to_commit()?
            .id();

        // Resolve local branches first (refs/heads), falling back to
        // remote-tracking branches (refs/remotes) so origin/* can be compared.
        let compare_oid = repo
            .revparse_single(&format!("refs/heads/{}", compare))
            .or_else(|_| repo.revparse_single(&format!("refs/remotes/{}", compare)))?
            .peel_to_commit()?
            .id();

        let (ahead_count, behind_count) = repo.graph_ahead_behind(base_oid, compare_oid)?;

        // Ahead commits: commits in base that are not in compare
        let mut ahead_commits = Vec::new();
        {
            let mut revwalk = repo.revwalk()?;
            revwalk.push(base_oid)?;
            revwalk.hide(compare_oid)?;
            revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
            for oid in revwalk {
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                ahead_commits.push(commit_to_info(&commit));
            }
        }

        // Behind commits: commits in compare that are not in base
        let mut behind_commits = Vec::new();
        {
            let mut revwalk = repo.revwalk()?;
            revwalk.push(compare_oid)?;
            revwalk.hide(base_oid)?;
            revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
            for oid in revwalk {
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                behind_commits.push(commit_to_info(&commit));
            }
        }

        Ok::<_, AppError>(BranchCompareResult {
            base_branch: base,
            compare_branch: compare,
            ahead_count,
            behind_count,
            ahead_commits,
            behind_commits,
        })
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn merge_branch_into_current(
    repo_path: String,
    branch: String,
    strategy: MergeStrategy,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    let branch_name = branch.clone();

    match strategy {
        MergeStrategy::Merge => {
            engine.merge_branch(&branch_name, true).await?;
        }
        MergeStrategy::Squash => {
            engine.squash_merge(&branch_name).await?;
            // squash merge stages changes but doesn't commit; create the commit
            engine
                .commit(
                    &format!("Squash merge branch '{}'", branch_name),
                    false,
                    None,
                )
                .await?;
        }
        MergeStrategy::Rebase => {
            engine.rebase_onto(&branch_name).await?;
        }
    }

    tracing::info!(
        "Merged branch '{}' into current using {:?} strategy",
        branch,
        strategy
    );
    Ok(format!("Successfully merged '{}' into current branch", branch))
}

/// Abort an in-progress merge or rebase, returning the working tree to its
/// pre-operation state. Lets users escape a conflicted merge/rebase from the GUI.
#[tauri::command]
pub async fn abort_merge_or_rebase(
    repo_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    match engine.operation_in_progress().await? {
        Some("rebase") => engine.rebase_abort().await,
        Some("merge") => engine.merge_abort().await,
        _ => Ok(()),
    }
}

/// Continue an in-progress merge or rebase after the user has resolved and
/// staged the conflicted files.
#[tauri::command]
pub async fn continue_merge_or_rebase(
    repo_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    match engine.operation_in_progress().await? {
        Some("rebase") => engine.rebase_continue().await,
        Some("merge") => engine.merge_continue().await,
        _ => Ok(()),
    }
}

/// Report whether a merge or rebase is currently in progress (`"merge"`,
/// `"rebase"`, or `null`), so the UI can show a conflict-resolution banner.
#[tauri::command]
pub async fn get_merge_state(repo_path: String) -> Result<Option<String>, AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    Ok(engine.operation_in_progress().await?.map(|s| s.to_string()))
}

#[tauri::command]
pub async fn check_merge_conflicts(
    repo_path: String,
    branch: String,
) -> Result<MergePreCheckResult, AppError> {
    let branch_name = branch.clone();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;

        // 1. Resolve branch OID
        let branch_oid = repo
            .revparse_single(&format!("refs/heads/{}", branch_name))?
            .peel_to_commit()?
            .id();
        let annotated = repo.find_annotated_commit(branch_oid)?;

        // 2. merge_analysis — fast-forward / up-to-date detection
        let (analysis, _) = repo.merge_analysis(&[&annotated])?;
        if analysis.is_up_to_date() {
            return Ok(MergePreCheckResult {
                can_fast_forward: false,
                has_conflicts: false,
                conflict_files: vec![],
            });
        }
        if analysis.is_fast_forward() {
            return Ok(MergePreCheckResult {
                can_fast_forward: true,
                has_conflicts: false,
                conflict_files: vec![],
            });
        }

        // 3. merge_trees — non-destructive 3-way simulation (in-memory only)
        let head_commit = repo.head()?.peel_to_commit()?;
        let their_commit = repo.find_commit(branch_oid)?;
        let ancestor = repo.find_commit(
            repo.merge_base(head_commit.id(), their_commit.id())?,
        )?;

        let index = repo.merge_trees(
            &ancestor.tree()?,
            &head_commit.tree()?,
            &their_commit.tree()?,
            None,
        )?;

        let mut conflict_files = Vec::new();
        if index.has_conflicts() {
            for conflict in index.conflicts()? {
                let c = conflict?;
                if let Some(path) = c
                    .our
                    .as_ref()
                    .or(c.their.as_ref())
                    .or(c.ancestor.as_ref())
                    .and_then(|e| std::str::from_utf8(&e.path).ok().map(String::from))
                {
                    conflict_files.push(path);
                }
            }
        }

        Ok::<_, AppError>(MergePreCheckResult {
            can_fast_forward: false,
            has_conflicts: !conflict_files.is_empty(),
            conflict_files,
        })
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn get_conflict_file_diff(
    repo_path: String,
    branch: String,
    file_path: String,
) -> Result<Value, AppError> {
    let branch_name = branch.clone();
    let target_path = file_path.clone();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;

        // HEAD tree (ours)
        let head_tree = repo.head()?.peel_to_tree()?;
        // Branch tree (theirs)
        let their_tree = repo
            .revparse_single(&format!("refs/heads/{}", branch_name))?
            .peel_to_tree()?;

        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.pathspec(&target_path);

        let diff = repo.diff_tree_to_tree(
            Some(&head_tree),
            Some(&their_tree),
            Some(&mut diff_opts),
        )?;

        let mut hunks: Vec<Value> = Vec::new();
        let mut current_hunk_lines: Vec<Value> = Vec::new();
        let mut current_hunk_header = String::new();
        let mut current_old_start: u32 = 0;
        let mut current_new_start: u32 = 0;

        diff.print(git2::DiffFormat::Patch, |_delta, hunk, line| {
            match line.origin() {
                'H' => {
                    if !current_hunk_lines.is_empty() {
                        hunks.push(json!({
                            "header": current_hunk_header.clone(),
                            "oldStart": current_old_start,
                            "newStart": current_new_start,
                            "lines": current_hunk_lines.clone(),
                        }));
                        current_hunk_lines.clear();
                    }
                    if let Some(h) = hunk {
                        current_hunk_header = String::from_utf8_lossy(h.header()).to_string();
                        current_old_start = h.old_start();
                        current_new_start = h.new_start();
                    }
                }
                origin @ ('+' | '-' | ' ') => {
                    let kind = match origin {
                        '+' => "addition",
                        '-' => "deletion",
                        _ => "context",
                    };
                    let content = String::from_utf8_lossy(line.content()).to_string();
                    current_hunk_lines.push(json!({
                        "kind": kind,
                        "content": content,
                        "oldLineNo": line.old_lineno(),
                        "newLineNo": line.new_lineno(),
                    }));
                }
                _ => {}
            }
            true
        })?;

        if !current_hunk_lines.is_empty() {
            hunks.push(json!({
                "header": current_hunk_header,
                "oldStart": current_old_start,
                "newStart": current_new_start,
                "lines": current_hunk_lines,
            }));
        }

        let is_binary = diff.deltas().any(|d| {
            d.flags().contains(git2::DiffFlags::BINARY)
                || d.old_file().is_binary()
                || d.new_file().is_binary()
        });

        // Read old content from HEAD tree (ours)
        let old_content = head_tree
            .get_path(std::path::Path::new(&target_path))
            .ok()
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .map(|blob| String::from_utf8_lossy(blob.content()).to_string())
            .unwrap_or_default();

        // Read new content from branch tree (theirs)
        let new_content = their_tree
            .get_path(std::path::Path::new(&target_path))
            .ok()
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .map(|blob| String::from_utf8_lossy(blob.content()).to_string())
            .unwrap_or_default();

        let stats = diff.stats()?;

        Ok::<_, AppError>(json!({
            "filePath": target_path,
            "staged": false,
            "binary": is_binary,
            "insertions": stats.insertions(),
            "deletions": stats.deletions(),
            "hunks": hunks,
            "oldContent": old_content,
            "newContent": new_content,
        }))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn get_recent_branches(
    repo_path: String,
    limit: usize,
) -> Result<Vec<String>, AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    let output = engine.get_reflog_branches(limit).await?;
    Ok(output)
}

#[tauri::command]
pub async fn rename_branch(
    app_handle: tauri::AppHandle,
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.rename_branch(&old_name, &new_name).await?;
    tracing::info!("Renamed branch: {} -> {}", old_name, new_name);
    Ok(())
}
