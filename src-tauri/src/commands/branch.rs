use crate::error::AppError;
use crate::git::branch::validate_branch_name;
use crate::git::cli::GitCliEngine;
use crate::git::commit::commit_to_info;
use crate::git::engine::{BranchCompareResult, MergePreCheckResult, MergeStrategy};
use crate::git::libgit::is_working_tree_dirty;
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

/// 각 브랜치가 현재 HEAD(체크아웃된 브랜치) 대비 얼마나 앞서/뒤처졌는지 계산한다.
/// 브랜치 비교 셀렉터의 ↓N/↑N 배지 전용 값이다. 브랜치가 많은 저장소에서 이를
/// `get_branches`에 포함하면 목록 로드(=브랜치 전환)마다 수천 번의 그래프 비교가
/// 일어나므로, 비교 셀렉터가 열릴 때만 별도로 조회한다(지연 계산).
///
/// 내부 최적화: 동일 tip OID는 한 번만 `graph_ahead_behind`를 호출하도록
/// 메모이제이션하고, HEAD와 같은 커밋이면 계산 없이 (0, 0)으로 처리한다.
#[tauri::command]
pub async fn get_branch_divergence(repo_path: String) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let Some(head_oid) = repo.head().ok().and_then(|h| h.target()) else {
            return Ok::<_, AppError>(Vec::new());
        };
        let head_name = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()));

        // 로컬 브랜치가 추적하는 리모트(upstream)는 비교 셀렉터에서 로컬 항목으로
        // 한 번만 노출되므로, 중복 리모트 항목은 계산에서 제외한다(프론트 필터와 일치).
        let mut tracked_upstreams: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for item in repo.branches(Some(git2::BranchType::Local))? {
            let (branch, _) = item?;
            if let Some(up) = branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()))
            {
                tracked_upstreams.insert(up);
            }
        }

        // 동일 tip OID의 중복 계산을 피하는 메모이제이션 캐시
        let mut cache: std::collections::HashMap<git2::Oid, (usize, usize)> =
            std::collections::HashMap::new();
        let mut list: Vec<Value> = Vec::new();
        for item in repo.branches(None)? {
            let (branch, branch_type) = item?;
            let name = match branch.name()? {
                Some(n) => n.to_string(),
                None => continue,
            };
            let is_remote = branch_type == git2::BranchType::Remote;
            if is_remote && name.ends_with("/HEAD") {
                continue;
            }
            // 로컬이 추적하는 리모트는 중복이므로 제외
            if is_remote && tracked_upstreams.contains(&name) {
                continue;
            }
            // 현재 브랜치 자신은 비교 의미가 없어 제외
            if !is_remote && head_name.as_deref() == Some(name.as_str()) {
                continue;
            }
            let Some(oid) = branch.get().target() else {
                continue;
            };
            let (ahead, behind) = if oid == head_oid {
                (0, 0)
            } else {
                *cache
                    .entry(oid)
                    .or_insert_with(|| repo.graph_ahead_behind(oid, head_oid).unwrap_or((0, 0)))
            };
            list.push(json!({ "name": name, "ahead": ahead, "behind": behind }));
        }
        Ok::<_, AppError>(list)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

/// HEAD 브랜치가 upstream 대비 얼마나 앞서/뒤처졌는지를 레포별로 계산한다.
/// 마지막 fetch 시점의 원격 상태 기준(읽기 전용, 네트워크 없음)이므로 사이드바
/// 인디케이터처럼 여러 레포를 한 번에 훑는 용도에 적합하다.
///
/// 하나의 레포에서 오류가 나도 전체가 실패하지 않도록, 열 수 없거나 HEAD가
/// 없는(detached·bare 등) 레포는 결과에서 조용히 건너뛴다.
#[tauri::command]
pub async fn repo_sync_status(repo_paths: Vec<String>) -> Result<Vec<Value>, AppError> {
    tokio::task::spawn_blocking(move || {
        let statuses = repo_paths
            .iter()
            .filter_map(|path| head_sync_status(path))
            .collect::<Vec<Value>>();
        Ok::<_, AppError>(statuses)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// 단일 레포의 HEAD ahead/behind 및 working-tree dirty 상태를 계산한다.
/// 레포를 열 수 없을 때만 `None`. detached HEAD여도 dirty는 계산해 반환한다.
fn head_sync_status(path: &str) -> Option<Value> {
    let repo = git2::Repository::open(path).ok()?;

    // working-tree 변경 여부 — RepoInfo.isDirty와 같은 함수를 쓴다
    let is_dirty = is_working_tree_dirty(&repo);

    // 현재 브랜치 기준 ahead/behind (detached HEAD·upstream 없으면 0/0)
    let head_branch = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .and_then(|name| repo.find_branch(&name, git2::BranchType::Local).ok());

    let (branch_name, ahead, behind, has_upstream) = match head_branch {
        Some(branch) => {
            let name = branch.name().ok().flatten().unwrap_or("").to_string();
            let (ahead, behind, has_upstream) = match branch.upstream().ok() {
                Some(upstream) => match (branch.get().target(), upstream.get().target()) {
                    (Some(l), Some(r)) => {
                        let (a, b) = repo.graph_ahead_behind(l, r).unwrap_or((0, 0));
                        (a, b, true)
                    }
                    _ => (0, 0, true),
                },
                None => (0, 0, false),
            };
            (name, ahead, behind, has_upstream)
        }
        None => (String::new(), 0, 0, false),
    };

    Some(json!({
        "path": path,
        "branch": branch_name,
        "ahead": ahead,
        "behind": behind,
        "hasUpstream": has_upstream,
        "isDirty": is_dirty,
    }))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .expect("git 실행 실패");
        assert!(
            out.status.success(),
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
        v.get(key).unwrap_or_else(|| panic!("{key} 없음: {v}"))
    }

    /// 저장소 목록의 dirty·ahead 인디케이터는 이 커맨드가 계산한다.
    /// 워크트리 경로로 물으면 워크트리 상태가, 메인 경로로 물으면 메인 상태가 나와야 한다.
    /// 둘을 구분하지 못하면 워크트리에 쌓인 작업이 목록에서 통째로 사라진다.
    #[tokio::test]
    async fn reports_worktree_state_separately_from_the_main_worktree() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // 로컬 bare 원격 + clone (네트워크 불필요)
        let origin = tmp.join("origin.git");
        git(&tmp, &["init", "-q", "--bare", "-b", "main", origin.to_str().unwrap()]);
        let main = tmp.join("main");
        git(&tmp, &["clone", "-q", origin.to_str().unwrap(), main.to_str().unwrap()]);

        std::fs::write(main.join("README.md"), "hello\n").unwrap();
        git(&main, &["add", "-A"]);
        git(&main, &["commit", "-qm", "init"]);
        git(&main, &["push", "-q", "-u", "origin", "main"]);

        // 워크트리를 만들고 upstream 을 붙인 뒤, 미푸시 커밋 2건을 쌓는다
        let wt = tmp.join("feature-wt");
        git(&main, &["worktree", "add", "-q", "-b", "feature", wt.to_str().unwrap()]);
        git(&wt, &["push", "-q", "-u", "origin", "feature"]);
        for i in 0..2 {
            std::fs::write(wt.join(format!("f{i}.txt")), "x\n").unwrap();
            git(&wt, &["add", "-A"]);
            git(&wt, &["commit", "-qm", &format!("wt commit {i}")]);
        }
        // 추적 파일을 수정해 dirty 로 만든다 (untracked 는 isDirty 에 포함되지 않는다)
        std::fs::write(wt.join("README.md"), "hello\nchanged\n").unwrap();

        let statuses = repo_sync_status(vec![
            wt.to_string_lossy().to_string(),
            main.to_string_lossy().to_string(),
        ])
        .await
        .expect("repo_sync_status 실패");

        let by_path = |p: &Path| {
            statuses
                .iter()
                .find(|s| field(s, "path").as_str() == Some(&p.to_string_lossy()))
                .unwrap_or_else(|| panic!("{} 결과 없음", p.display()))
                .clone()
        };

        let wt_status = by_path(&wt);
        let main_status = by_path(&main);
        let _ = std::fs::remove_dir_all(&tmp);

        // 워크트리: 미푸시 2건 + 변경 있음
        assert_eq!(field(&wt_status, "branch").as_str(), Some("feature"));
        assert_eq!(field(&wt_status, "ahead").as_u64(), Some(2));
        assert_eq!(field(&wt_status, "isDirty").as_bool(), Some(true));

        // 메인: 깨끗함 — 목록이 메인 경로로 계산하면 위 상태가 전부 사라진다
        assert_eq!(field(&main_status, "branch").as_str(), Some("main"));
        assert_eq!(field(&main_status, "ahead").as_u64(), Some(0));
        assert_eq!(field(&main_status, "isDirty").as_bool(), Some(false));
    }

    /// 새 파일만 추가해도 dirty 다. Changes 탭은 untracked 를 세는데 목록이 세지
    /// 않으면, 파일을 하나 만들었을 때 탭에는 "1" 이 뜨고 목록에는 아무 표시도
    /// 없는 어긋남이 생긴다.
    #[tokio::test]
    async fn counts_untracked_files_as_dirty() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-untracked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        git(&tmp, &["init", "-q", "-b", "main"]);
        std::fs::write(tmp.join("README.md"), "hello\n").unwrap();
        git(&tmp, &["add", "-A"]);
        git(&tmp, &["commit", "-qm", "init"]);

        let clean = repo_sync_status(vec![tmp.to_string_lossy().to_string()])
            .await
            .unwrap();
        assert_eq!(field(&clean[0], "isDirty").as_bool(), Some(false));

        // 추적되지 않는 새 파일 하나만 추가한다
        std::fs::write(tmp.join("brand-new.txt"), "x\n").unwrap();

        let dirty = repo_sync_status(vec![tmp.to_string_lossy().to_string()])
            .await
            .unwrap();
        let is_dirty = field(&dirty[0], "isDirty").as_bool();

        let _ = std::fs::remove_dir_all(&tmp);
        assert_eq!(is_dirty, Some(true));
    }
}
