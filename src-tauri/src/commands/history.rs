use std::collections::HashMap;

use crate::error::AppError;
use crate::gh::cli;
use crate::git::binary::{detect_file_type, extension_to_mime, is_previewable, MAX_PREVIEW_SIZE};
use crate::git::remote::parse_github_url;
use crate::github::client::GitHubClient;
use crate::state::TokenStore;
use base64::Engine;
use serde_json::{json, Value};

fn gravatar_url(email: &str) -> String {
    let hash = md5::compute(email.trim().to_lowercase().as_bytes());
    format!("https://www.gravatar.com/avatar/{:x}?s=64&d=retro", hash)
}

/// HEAD 브랜치에서 아직 리모트로 push되지 않은 커밋의 OID 집합을 구한다.
/// GitHub Desktop의 `loadLocalCommits`와 동일한 판정:
///   - upstream tracking 있음 → `upstream..HEAD` (upstream tip 이후의 커밋)
///   - upstream 없음        → `HEAD --not --remotes` (모든 리모트에서 도달 불가능한 커밋)
///
/// 반환값 `None`은 "HEAD의 모든 커밋이 unpushed"를 뜻한다. 리모트 tracking
/// 브랜치가 하나도 없으면(로컬 전용 저장소) hide 대상이 없어 전체 히스토리를
/// 순회하게 되므로, 그 경우는 revwalk 없이 `None`으로 처리한다.
fn compute_unpushed(repo: &git2::Repository) -> Option<std::collections::HashSet<git2::Oid>> {
    use std::collections::HashSet;

    // HEAD가 가리키는 로컬 브랜치의 upstream tip OID (없으면 None)
    let upstream_oid = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_string))
        .and_then(|name| repo.find_branch(&name, git2::BranchType::Local).ok())
        .and_then(|b| b.upstream().ok())
        .and_then(|up| up.get().target());

    // upstream도 없고 리모트 tracking 브랜치도 없으면 전부 unpushed
    if upstream_oid.is_none() {
        let has_remote = repo
            .branches(Some(git2::BranchType::Remote))
            .map(|mut it| it.next().is_some())
            .unwrap_or(false);
        if !has_remote {
            return None;
        }
    }

    let Ok(mut walk) = repo.revwalk() else {
        return Some(HashSet::new()); // revwalk 생성 실패 시 안전하게 "unpushed 없음"
    };
    if walk.push_head().is_err() {
        return Some(HashSet::new()); // unborn HEAD(빈 저장소) 등
    }
    match upstream_oid {
        Some(oid) => {
            let _ = walk.hide(oid); // upstream..HEAD
        }
        None => {
            let _ = walk.hide_glob("refs/remotes/*"); // HEAD --not --remotes
        }
    }
    Some(walk.flatten().collect())
}

#[tauri::command]
pub async fn get_commit_history(
    repo_path: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let ref_map = crate::git::commit::build_ref_map(&repo);
        // HEAD 기준 unpushed 커밋 집합. None이면 "모든 커밋이 unpushed".
        let unpushed = compute_unpushed(&repo);
        let mut revwalk = repo.revwalk()?;
        // 현재 체크아웃된 브랜치(HEAD)에서 도달 가능한 커밋만 시간순으로 조회한다.
        // GitHub Desktop의 History 탭과 동일하게, 다른 브랜치·리모트의 커밋은
        // 타임라인에 섞이지 않는다. detached HEAD도 그대로 처리된다. unborn HEAD
        // (빈 저장소)면 push_head가 실패하므로 빈 히스토리가 된다.
        let _ = revwalk.push_head();
        revwalk.set_sorting(git2::Sort::TIME)?;

        let limit = limit.unwrap_or(100);
        let offset = offset.unwrap_or(0);

        let commits: Vec<Value> = revwalk
            .skip(offset)
            .take(limit)
            .filter_map(|oid_result| {
                let oid = oid_result.ok()?;
                let commit = repo.find_commit(oid).ok()?;
                let author = commit.author();
                let timestamp = commit.time().seconds();

                let author_email = author.email().unwrap_or("").to_string();
                let refs = ref_map.get(&oid).cloned().unwrap_or_default();
                let is_unpushed = match &unpushed {
                    None => true,
                    Some(set) => set.contains(&oid),
                };
                Some(json!({
                    "oid": oid.to_string(),
                    "message": commit.message().unwrap_or("").trim().to_string(),
                    "summary": commit.summary().unwrap_or("").to_string(),
                    "author": {
                        "name": author.name().unwrap_or("").to_string(),
                        "email": &author_email,
                        "avatarUrl": gravatar_url(&author_email),
                    },
                    "timestamp": timestamp,
                    "parentCount": commit.parent_count(),
                    "refs": refs,
                    "isUnpushed": is_unpushed,
                }))
            })
            .collect();

        Ok::<_, AppError>(commits)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn get_commit_detail(repo_path: String, oid: String) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let obj = repo.revparse_single(&oid)?;
        let commit = obj.peel_to_commit()?;
        let author = commit.author();
        let committer = commit.committer();
        let author_email = author.email().unwrap_or("").to_string();
        let committer_email = committer.email().unwrap_or("").to_string();

        // Build diff against first parent
        let diff = if commit.parent_count() > 0 {
            let parent = commit.parent(0)?;
            let parent_tree = parent.tree()?;
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None)?
        } else {
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(None, Some(&commit_tree), None)?
        };

        let stats = diff.stats()?;
        let mut files: Vec<Value> = Vec::new();
        let mut patches: Vec<Value> = Vec::new();

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
            Some(&mut |delta, hunk| {
                patches.push(json!({
                    "file": delta.new_file().path().map(|p| p.to_string_lossy().to_string()),
                    "header": String::from_utf8_lossy(hunk.header()).to_string(),
                    "oldStart": hunk.old_start(),
                    "newStart": hunk.new_start(),
                }));
                true
            }),
            None,
        )?;

        let parents: Vec<String> = commit
            .parent_ids()
            .map(|id| id.to_string())
            .collect();

        Ok::<_, AppError>(json!({
            "oid": commit.id().to_string(),
            "message": commit.message().unwrap_or("").trim().to_string(),
            "summary": commit.summary().unwrap_or("").to_string(),
            "author": {
                "name": author.name().unwrap_or("").to_string(),
                "email": &author_email,
                "avatarUrl": gravatar_url(&author_email),
            },
            "committer": {
                "name": committer.name().unwrap_or("").to_string(),
                "email": &committer_email,
                "avatarUrl": gravatar_url(&committer_email),
            },
            "timestamp": commit.time().seconds(),
            "parents": parents,
            "diff": {
                "filesChanged": stats.files_changed(),
                "insertions": stats.insertions(),
                "deletions": stats.deletions(),
                "files": files,
                "hunks": patches,
            },
        }))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn get_commit_file_diff(
    repo_path: String,
    oid: String,
    file_path: String,
) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let obj = repo.revparse_single(&oid)?;
        let commit = obj.peel_to_commit()?;

        let commit_tree = commit.tree()?;
        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };

        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.pathspec(&file_path);

        let diff = repo.diff_tree_to_tree(
            parent_tree.as_ref(),
            Some(&commit_tree),
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

        // Detect binary: git2 flags (set after diff.print) + extension-based fallback
        let is_binary_by_flags = diff.deltas().any(|d| {
            d.flags().contains(git2::DiffFlags::BINARY)
                || d.old_file().is_binary()
                || d.new_file().is_binary()
        });
        let is_binary_by_ext = is_previewable(&detect_file_type(&file_path));
        let is_binary = is_binary_by_flags || is_binary_by_ext;

        // Build binary preview if applicable
        let binary_preview = if is_binary {
            let file_type = detect_file_type(&file_path);
            if is_previewable(&file_type) {
                let mime_type = extension_to_mime(&file_path);

                let old_bytes: Option<Vec<u8>> = parent_tree
                    .as_ref()
                    .and_then(|tree| tree.get_path(std::path::Path::new(&file_path)).ok())
                    .and_then(|entry| repo.find_blob(entry.id()).ok())
                    .map(|blob| blob.content().to_vec());

                let new_bytes: Option<Vec<u8>> = commit_tree
                    .get_path(std::path::Path::new(&file_path))
                    .ok()
                    .and_then(|entry| repo.find_blob(entry.id()).ok())
                    .map(|blob| blob.content().to_vec());

                let old_size = old_bytes.as_ref().map(|b| b.len());
                let new_size = new_bytes.as_ref().map(|b| b.len());

                if old_size.unwrap_or(0) > MAX_PREVIEW_SIZE || new_size.unwrap_or(0) > MAX_PREVIEW_SIZE {
                    Some(json!({
                        "meta": {
                            "fileType": file_type,
                            "mimeType": mime_type,
                            "oldSize": old_size,
                            "newSize": new_size,
                            "tooLarge": true
                        },
                        "oldBase64": null,
                        "newBase64": null
                    }))
                } else {
                    let encoder = base64::engine::general_purpose::STANDARD;
                    let old_b64 = old_bytes.map(|b| encoder.encode(&b));
                    let new_b64 = new_bytes.map(|b| encoder.encode(&b));

                    Some(json!({
                        "meta": {
                            "fileType": file_type,
                            "mimeType": mime_type,
                            "oldSize": old_size,
                            "newSize": new_size
                        },
                        "oldBase64": old_b64,
                        "newBase64": new_b64
                    }))
                }
            } else {
                None
            }
        } else {
            None
        };

        // Read old content from parent tree
        let old_content = parent_tree
            .and_then(|tree| tree.get_path(std::path::Path::new(&file_path)).ok())
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .map(|blob| String::from_utf8_lossy(blob.content()).to_string())
            .unwrap_or_default();

        // Read new content from commit tree
        let new_content = commit_tree
            .get_path(std::path::Path::new(&file_path))
            .ok()
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .map(|blob| String::from_utf8_lossy(blob.content()).to_string())
            .unwrap_or_default();

        let stats = diff.stats()?;

        Ok::<_, AppError>(json!({
            "filePath": file_path,
            "staged": false,
            "binary": is_binary,
            "binaryPreview": binary_preview,
            "insertions": stats.insertions(),
            "deletions": stats.deletions(),
            "hunks": hunks,
            "oldContent": old_content,
            "newContent": new_content,
        }))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn resolve_commit_avatars(
    repo_path: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<HashMap<String, String>, AppError> {
    // 1. Open repo and get origin remote URL
    let remote_url = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let remote = repo.find_remote("origin")?;
        let url = remote.url().unwrap_or("").to_string();
        Ok::<_, AppError>(url)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    // 2. Parse GitHub owner/repo — not a GitHub repo → return empty
    let (owner, repo_name) = match parse_github_url(&remote_url) {
        Some(pair) => pair,
        None => return Ok(HashMap::new()),
    };

    // 3. Pick the best account: prefer owner-matching account, then active, then first
    let accounts = cli::gh_auth_status().await.unwrap_or_default();
    let owner_lower = owner.to_lowercase();
    let username = accounts
        .iter()
        .find(|a| a.username.to_lowercase() == owner_lower)
        .or_else(|| accounts.iter().find(|a| a.active))
        .or(accounts.first())
        .map(|a| a.username.clone());
    let username = match username {
        Some(u) => u,
        None => return Ok(HashMap::new()),
    };
    let token = match crate::commands::auth::resolve_token(&token_store, &username).await {
        Ok(t) => t,
        Err(_) => return Ok(HashMap::new()),
    };

    // 4. Fetch avatars from GitHub API — any error → return empty
    let client = GitHubClient::new();
    match client
        .get_commit_author_avatars(&token, &owner, &repo_name)
        .await
    {
        Ok(map) => Ok(map),
        Err(_) => Ok(HashMap::new()),
    }
}

// ─── Commit operations (checkout/reset/revert/cherry-pick) ───────────────────
// Write ops that may trigger hooks → GitCliEngine (not libgit2). The oid comes
// from the history list but is validated as hex to prevent option injection.

/// Check out a commit as a detached HEAD.
#[tauri::command]
pub async fn checkout_commit(
    app_handle: tauri::AppHandle,
    repo_path: String,
    oid: String,
) -> Result<(), AppError> {
    crate::git::commit::validate_commit_oid(&oid)?;
    let engine =
        crate::git::cli::GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.checkout_commit(&oid).await?;
    tracing::info!("Checked out commit: {}", oid);
    Ok(())
}

/// Reset the current branch to a commit. `mode` is "soft" | "mixed" | "hard".
#[tauri::command]
pub async fn reset_to_commit(
    app_handle: tauri::AppHandle,
    repo_path: String,
    oid: String,
    mode: String,
) -> Result<(), AppError> {
    crate::git::commit::validate_commit_oid(&oid)?;
    if !matches!(mode.as_str(), "soft" | "mixed" | "hard") {
        return Err(AppError::GitCli {
            message: format!("Invalid reset mode: '{}'", mode),
            exit_code: None,
        });
    }
    let engine =
        crate::git::cli::GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.reset_to_commit(&oid, &mode).await?;
    tracing::info!("Reset to commit {} ({})", oid, mode);
    Ok(())
}

/// Create a commit that reverts a commit.
#[tauri::command]
pub async fn revert_commit(
    app_handle: tauri::AppHandle,
    repo_path: String,
    oid: String,
) -> Result<(), AppError> {
    crate::git::commit::validate_commit_oid(&oid)?;
    let engine =
        crate::git::cli::GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.revert_commit(&oid).await?;
    tracing::info!("Reverted commit: {}", oid);
    Ok(())
}

/// Cherry-pick a commit onto the current branch.
#[tauri::command]
pub async fn cherry_pick_commit(
    app_handle: tauri::AppHandle,
    repo_path: String,
    oid: String,
) -> Result<(), AppError> {
    crate::git::commit::validate_commit_oid(&oid)?;
    let engine =
        crate::git::cli::GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.cherry_pick_commit(&oid).await?;
    tracing::info!("Cherry-picked commit: {}", oid);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{BranchType, Oid, Repository, Signature};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// 새 의존성 없이 임시 디렉토리에 non-bare 저장소를 만들고, Drop에서 정리한다.
    struct TempRepo {
        path: PathBuf,
    }

    impl TempRepo {
        fn new() -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!(
                "gitbaro-hist-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Repository::init(&path).unwrap();
            TempRepo { path }
        }

        fn open(&self) -> Repository {
            Repository::open(&self.path).unwrap()
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// 워킹트리에 파일을 쓰고 HEAD에 커밋한다. 생성된 커밋 OID를 반환.
    fn commit(repo: &Repository, file: &str, content: &str) -> Oid {
        let workdir = repo.workdir().unwrap();
        std::fs::write(workdir.join(file), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, "msg", &tree, &parents)
            .unwrap()
    }

    fn head_branch(repo: &Repository) -> String {
        repo.head().unwrap().shorthand().unwrap().to_string()
    }

    /// 네트워크 없이 리모트 tracking ref(refs/remotes/<name>)를 특정 커밋에 만든다.
    fn set_remote_ref(repo: &Repository, name: &str, oid: Oid) {
        repo.reference(&format!("refs/remotes/{name}"), oid, true, "test")
            .unwrap();
    }

    #[test]
    fn unpushed_is_none_without_any_remote() {
        // 리모트 tracking 브랜치가 하나도 없으면 전부 unpushed(None)
        let tmp = TempRepo::new();
        let repo = tmp.open();
        commit(&repo, "a.txt", "1");
        commit(&repo, "a.txt", "2");
        assert!(compute_unpushed(&repo).is_none());
    }

    #[test]
    fn unpushed_is_none_on_empty_repo() {
        // unborn HEAD + 리모트 없음 → None
        let tmp = TempRepo::new();
        let repo = tmp.open();
        assert!(compute_unpushed(&repo).is_none());
    }

    #[test]
    fn unpushed_uses_upstream_range_when_tracking() {
        // upstream 있음: upstream..HEAD 만 unpushed
        let tmp = TempRepo::new();
        let repo = tmp.open();
        let c1 = commit(&repo, "a.txt", "1");
        let c2 = commit(&repo, "a.txt", "2");
        let branch = head_branch(&repo);

        set_remote_ref(&repo, &format!("origin/{branch}"), c1);
        repo.remote("origin", "https://example.invalid/r.git")
            .unwrap();
        let mut b = repo.find_branch(&branch, BranchType::Local).unwrap();
        b.set_upstream(Some(&format!("origin/{branch}"))).unwrap();

        let set = compute_unpushed(&repo).expect("tracking → Some");
        assert!(set.contains(&c2), "c2(ahead) should be unpushed");
        assert!(!set.contains(&c1), "c1(on remote) should be pushed");
        assert_eq!(set.len(), 1);
    }

    #[test]
    fn unpushed_uses_not_remotes_without_upstream() {
        // upstream은 없지만 리모트 tracking ref가 있으면 HEAD --not --remotes
        let tmp = TempRepo::new();
        let repo = tmp.open();
        let c1 = commit(&repo, "a.txt", "1");
        let c2 = commit(&repo, "a.txt", "2");
        let c3 = commit(&repo, "a.txt", "3");
        set_remote_ref(&repo, "origin/main", c1); // 리모트엔 c1까지만

        let set = compute_unpushed(&repo).expect("remote ref exists → Some");
        assert!(set.contains(&c2));
        assert!(set.contains(&c3));
        assert!(!set.contains(&c1));
        assert_eq!(set.len(), 2);
    }

    #[tokio::test]
    async fn history_shows_only_current_branch() {
        // 다른 브랜치에만 있는 커밋은 현재 브랜치 타임라인에 나오지 않는다.
        let tmp = TempRepo::new();
        let repo_path = tmp.path.to_str().unwrap().to_string();
        let (c1, c2, c3) = {
            let repo = tmp.open();
            let c1 = commit(&repo, "a.txt", "1");
            let c2 = commit(&repo, "a.txt", "2");
            let main_branch = head_branch(&repo);
            // feature 브랜치를 c2에서 만들고 거기에만 c3 커밋
            repo.branch("feature", &repo.find_commit(c2).unwrap(), false)
                .unwrap();
            repo.set_head("refs/heads/feature").unwrap();
            let c3 = commit(&repo, "b.txt", "3");
            // HEAD를 다시 원래 브랜치로 되돌린다
            repo.set_head(&format!("refs/heads/{main_branch}")).unwrap();
            (c1, c2, c3)
        };

        let commits = get_commit_history(repo_path, Some(100), Some(0))
            .await
            .unwrap();
        let oids: std::collections::HashSet<String> = commits
            .iter()
            .map(|v| v["oid"].as_str().unwrap().to_string())
            .collect();

        assert!(oids.contains(&c1.to_string()));
        assert!(oids.contains(&c2.to_string()));
        assert!(
            !oids.contains(&c3.to_string()),
            "feature 전용 커밋은 현재 브랜치 히스토리에 없어야 한다"
        );
        assert_eq!(commits.len(), 2);

        // 리모트가 없으므로 모든 커밋이 unpushed(true)로 표시된다
        assert!(commits.iter().all(|v| v["isUnpushed"].as_bool().unwrap()));
    }
}
