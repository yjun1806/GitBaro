use crate::error::AppError;
use crate::git::cli::GitCliEngine;
use crate::git::engine::{AuthorInfo, BranchCompareResult, CommitInfo};
use serde_json::{json, Value};

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

            let is_head = branch.is_head();

            let last_commit_time = branch
                .get()
                .target()
                .and_then(|oid| repo.find_commit(oid).ok())
                .map(|c| c.time().seconds());

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

            let is_default = !is_remote
                && default_branch_name.as_deref() == Some(name.as_str());

            list.push(json!({
                "name": name,
                "isHead": is_head,
                "isRemote": is_remote,
                "isDefault": is_default,
                "upstream": upstream,
                "aheadBehind": ahead_behind,
                "lastCommitTime": last_commit_time,
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

#[tauri::command]
pub async fn switch_branch(repo_path: String, name: String) -> Result<(), AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.switch_branch(&name).await?;
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

fn commit_to_info(commit: &git2::Commit) -> CommitInfo {
    let id = commit.id().to_string();
    let short_id = id[..7.min(id.len())].to_string();
    let message = commit.message().unwrap_or_default().to_string();
    let summary = commit.summary().unwrap_or_default().to_string();
    let author = AuthorInfo {
        name: commit.author().name().unwrap_or_default().to_string(),
        email: commit.author().email().unwrap_or_default().to_string(),
        timestamp: commit.author().when().seconds(),
    };
    let committer = AuthorInfo {
        name: commit.committer().name().unwrap_or_default().to_string(),
        email: commit.committer().email().unwrap_or_default().to_string(),
        timestamp: commit.committer().when().seconds(),
    };
    let timestamp = commit.time().seconds();
    let parent_ids = commit.parent_ids().map(|oid| oid.to_string()).collect();

    CommitInfo {
        id,
        short_id,
        message,
        summary,
        author,
        committer,
        timestamp,
        parent_ids,
    }
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

        let compare_oid = repo
            .revparse_single(&format!("refs/heads/{}", compare))?
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
