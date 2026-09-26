use std::collections::HashMap;

use crate::error::AppError;
use crate::gh::cli;
use crate::git::binary::{detect_file_type, extension_to_mime, is_previewable, MAX_PREVIEW_SIZE};
use crate::git::commit::{agent_attribution, parent_ids};
use crate::git::commit_stats::{commit_stats, CommitStats};
use crate::git::diff::{detect_renames, rename_source};
use crate::git::remote::parse_github_url;
use crate::git::unpushed::{commits_not_on_any_remote, upstream_tip, UNPUSHED_LIMIT};
use crate::github::client::GitHubClient;
use crate::state::TokenStore;
use base64::Engine;
use serde_json::{json, Value};

fn gravatar_url(email: &str) -> String {
    let hash = md5::compute(email.trim().to_lowercase().as_bytes());
    format!("https://www.gravatar.com/avatar/{:x}?s=64&d=retro", hash)
}

/// 커밋 목록을 어디서부터 읽을지. 프런트의 「보는 브랜치」 선택과 같다.
/// 문자열 하나("all")로 받지 않는 이유: `all`이라는 이름의 브랜치와 구분할 수 없다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HistoryTarget {
    /// 지금 체크아웃된 HEAD(기본값).
    Head,
    /// 로컬 브랜치(`feat/x`), 원격 브랜치(`origin/x`), 태그. 짧은 이름으로 찾는다.
    Ref { name: String },
    /// 모든 로컬·원격 브랜치 끝과 HEAD.
    All,
}

/// revwalk의 시작점과, 아직 push하지 않은 커밋을 가려낼 기준.
struct HistoryTips {
    tips: Vec<git2::Oid>,
    /// 시작점이 로컬 브랜치(또는 HEAD)일 때 그 upstream 끝.
    upstream: Option<git2::Oid>,
    /// 원격 브랜치를 볼 때: 이미 원격에 있으니 push할 커밋이 없다.
    on_remote: bool,
}

fn head_tips(repo: &git2::Repository) -> HistoryTips {
    let head = repo.head().ok();
    let tips = head.as_ref().and_then(|h| h.target()).into_iter().collect();
    // HEAD가 가리키는 로컬 브랜치의 upstream tip OID (없으면 None)
    let upstream = head
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_string))
        .and_then(|name| repo.find_branch(&name, git2::BranchType::Local).ok())
        .and_then(|b| upstream_tip(&b));
    HistoryTips { tips, upstream, on_remote: false }
}

fn resolve_history_tips(
    repo: &git2::Repository,
    target: &HistoryTarget,
) -> Result<HistoryTips, AppError> {
    match target {
        HistoryTarget::Head => Ok(head_tips(repo)),
        HistoryTarget::Ref { name } => {
            let name = name.trim();
            // 브랜치·태그 이름은 `-`로 시작할 수 없다. 빈 이름과 함께 막는다.
            if name.is_empty() || name.starts_with('-') {
                return Err(AppError::Git(git2::Error::from_str(&format!(
                    "invalid ref name: {name:?}"
                ))));
            }
            let reference = repo.resolve_reference_from_short_name(name)?;
            let oid = reference.peel_to_commit()?.id();
            let on_remote = reference.is_remote();
            let upstream = if reference.is_branch() {
                upstream_tip(&git2::Branch::wrap(reference))
            } else {
                None
            };
            Ok(HistoryTips { tips: vec![oid], upstream, on_remote })
        }
        HistoryTarget::All => {
            let mut tips: Vec<git2::Oid> = head_tips(repo).tips;
            for branch in repo.branches(None)? {
                let (branch, _) = branch?;
                if let Ok(commit) = branch.get().peel_to_commit() {
                    if !tips.contains(&commit.id()) {
                        tips.push(commit.id());
                    }
                }
            }
            Ok(HistoryTips { tips, upstream: None, on_remote: false })
        }
    }
}

/// 시작점에서 아직 리모트로 push되지 않은 커밋의 OID 집합을 구한다.
/// 검토 기준 「원격에 없는 커밋」(`git::unpushed`)과 같은 판정이다: 원격이 없으면 비어 있고,
/// upstream이 로컬 브랜치여도 그 끝은 함께 숨긴다. 많아야 `UNPUSHED_LIMIT`개까지 표시한다.
fn unpushed_from(
    repo: &git2::Repository,
    tips: &HistoryTips,
) -> std::collections::HashSet<git2::Oid> {
    if tips.on_remote {
        return Default::default();
    }
    commits_not_on_any_remote(repo, &tips.tips, tips.upstream, UNPUSHED_LIMIT)
        .map(|oids| oids.into_iter().collect())
        .unwrap_or_default() // 판정 실패 시 안전하게 "unpushed 없음"
}

/// HEAD 기준 unpushed 커밋 집합(`unpushed_from`의 HEAD 판).
#[cfg(test)]
fn compute_unpushed(repo: &git2::Repository) -> std::collections::HashSet<git2::Oid> {
    unpushed_from(repo, &head_tips(repo))
}

/// 커밋 목록. `target`이 없으면 HEAD(지금 체크아웃)에서, 있으면 그 ref 또는 모든
/// 브랜치 끝에서 revwalk한다. 체크아웃하지 않고 다른 브랜치의 이력을 볼 때 쓴다.
#[tauri::command]
pub async fn get_commit_history(
    repo_path: String,
    limit: Option<usize>,
    offset: Option<usize>,
    target: Option<HistoryTarget>,
) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let ref_map = crate::git::commit::build_ref_map(&repo);
        let tips = resolve_history_tips(&repo, &target.unwrap_or(HistoryTarget::Head))?;
        // 시작점 기준 unpushed 커밋 집합.
        let unpushed = unpushed_from(&repo, &tips);
        let mut revwalk = repo.revwalk()?;
        // 기본은 현재 체크아웃된 브랜치(HEAD)에서 도달 가능한 커밋만 시간순으로 조회한다.
        // GitHub Desktop의 History 탭과 동일하게, 다른 브랜치·리모트의 커밋은
        // 타임라인에 섞이지 않는다. detached HEAD도 그대로 처리된다. unborn HEAD
        // (빈 저장소)면 시작점이 없어 빈 히스토리가 된다.
        for tip in &tips.tips {
            revwalk.push(*tip)?;
        }
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
                let author_name = author.name().unwrap_or("").to_string();
                let refs = ref_map.get(&oid).cloned().unwrap_or_default();
                let is_unpushed = unpushed.contains(&oid);
                let message = commit.message().unwrap_or("");
                let (co_authors, is_agent_authored) = agent_attribution(message);
                Some(json!({
                    "oid": oid.to_string(),
                    "message": message.trim().to_string(),
                    "summary": commit.summary().unwrap_or("").to_string(),
                    "author": {
                        "name": author_name,
                        "email": &author_email,
                        "avatarUrl": gravatar_url(&author_email),
                    },
                    "timestamp": timestamp,
                    "parentCount": commit.parent_count(),
                    "parentIds": parent_ids(&commit),
                    "refs": refs,
                    "isUnpushed": is_unpushed,
                    "coAuthors": co_authors,
                    "isAgentAuthored": is_agent_authored,
                }))
            })
            .collect();

        Ok::<_, AppError>(commits)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

/// 커밋 줄의 「변경」 칸: 커밋마다 첫 부모 대비 바뀐 파일 수와 줄 수(`git::commit_stats`). 결과는 `oids` 순서이고,
/// 한 커밋을 읽지 못해도 그 항목의 `error` 만 채운다. 커밋은 바뀌지 않으므로 한 번 센 커밋은 다시 세지 않는다.
#[tauri::command]
pub async fn get_commit_stats(path: String, oids: Vec<String>) -> Result<Vec<CommitStats>, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&path)?;
        Ok(commit_stats(&repo, &oids))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
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
        let mut diff = if commit.parent_count() > 0 {
            let parent = commit.parent(0)?;
            let parent_tree = parent.tree()?;
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None)?
        } else {
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(None, Some(&commit_tree), None)?
        };
        // Show `git mv` as a rename rather than a deletion plus an addition.
        detect_renames(&mut diff)?;

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

        let parents = parent_ids(&commit);
        let (co_authors, is_agent_authored) = agent_attribution(commit.message().unwrap_or(""));

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
            "coAuthors": co_authors,
            "isAgentAuthored": is_agent_authored,
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

        // If the file was renamed in this commit, diff it against its old
        // path instead of showing the whole file as added.
        let rename_from = if commit_tree.get_path(std::path::Path::new(&file_path)).is_ok()
            && parent_tree
                .as_ref()
                .is_some_and(|t| t.get_path(std::path::Path::new(&file_path)).is_err())
        {
            let mut full = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)?;
            rename_source(&mut full, &file_path)?
        } else {
            None
        };
        let old_path = rename_from.clone().unwrap_or_else(|| file_path.clone());

        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.pathspec(&file_path).disable_pathspec_match(true);
        if let Some(src) = &rename_from {
            diff_opts.pathspec(src);
        }

        let mut diff = repo.diff_tree_to_tree(
            parent_tree.as_ref(),
            Some(&commit_tree),
            Some(&mut diff_opts),
        )?;
        if rename_from.is_some() {
            detect_renames(&mut diff)?;
        }

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
                    .and_then(|tree| tree.get_path(std::path::Path::new(&old_path)).ok())
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
            .and_then(|tree| tree.get_path(std::path::Path::new(&old_path)).ok())
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
    // 1-2. Read the origin URL and parse GitHub owner/repo. Parsing may run
    // `ssh -G` for a host alias, so it stays inside spawn_blocking too.
    let parsed = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let remote = repo.find_remote("origin")?;
        let url = remote.url().unwrap_or("").to_string();
        Ok::<_, AppError>(parse_github_url(&url))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    // Not a GitHub repo → return empty
    let (owner, repo_name) = match parsed {
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
    // 4. Fetch avatars from GitHub API — any error → return empty
    let client = GitHubClient::new();
    match crate::commands::auth::call_with_token_retry(&token_store, &username, |token| {
        let (client, owner, repo_name) = (&client, &owner, &repo_name);
        async move { client.get_commit_author_avatars(&token, owner, repo_name).await }
    })
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
    account_id: Option<String>,
) -> Result<(), AppError> {
    crate::git::commit::validate_commit_oid(&oid)?;
    let identity = crate::commands::git::resolve_commit_identity(account_id.as_deref()).await;
    let engine =
        crate::git::cli::GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
            .with_identity(identity);
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
    account_id: Option<String>,
) -> Result<(), AppError> {
    crate::git::commit::validate_commit_oid(&oid)?;
    let identity = crate::commands::git::resolve_commit_identity(account_id.as_deref()).await;
    let engine =
        crate::git::cli::GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
            .with_identity(identity);
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
    /// 그 원격도 설정한다(원격이 없으면 올릴 곳이 없어 아무것도 unpushed가 아니다).
    fn set_remote_ref(repo: &Repository, name: &str, oid: Oid) {
        let remote = name.split('/').next().unwrap();
        if repo.find_remote(remote).is_err() {
            repo.remote(remote, "https://example.invalid/r.git").unwrap();
        }
        repo.reference(&format!("refs/remotes/{name}"), oid, true, "test")
            .unwrap();
    }

    #[test]
    fn nothing_is_unpushed_without_any_remote() {
        // 원격이 없으면 올릴 곳이 없다. 원격 표시(`head_unpushed`)와 같은 판정.
        let tmp = TempRepo::new();
        let repo = tmp.open();
        commit(&repo, "a.txt", "1");
        commit(&repo, "a.txt", "2");
        assert!(compute_unpushed(&repo).is_empty());
        let summary = crate::git::unpushed::head_unpushed(&repo, UNPUSHED_LIMIT).unwrap();
        assert!(summary.oids.is_empty());
    }

    #[test]
    fn every_commit_is_unpushed_when_the_remote_was_never_fetched() {
        let tmp = TempRepo::new();
        let repo = tmp.open();
        let c1 = commit(&repo, "a.txt", "1");
        let c2 = commit(&repo, "a.txt", "2");
        repo.remote("origin", "https://example.invalid/r.git").unwrap();
        let set = compute_unpushed(&repo);
        assert_eq!(set, [c1, c2].into_iter().collect());
    }

    #[test]
    fn unpushed_is_empty_on_empty_repo() {
        let tmp = TempRepo::new();
        let repo = tmp.open();
        repo.remote("origin", "https://example.invalid/r.git").unwrap();
        assert!(compute_unpushed(&repo).is_empty());
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
        let mut b = repo.find_branch(&branch, BranchType::Local).unwrap();
        b.set_upstream(Some(&format!("origin/{branch}"))).unwrap();

        let set = compute_unpushed(&repo);
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

        let set = compute_unpushed(&repo);
        assert!(set.contains(&c2));
        assert!(set.contains(&c3));
        assert!(!set.contains(&c1));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn unpushed_treats_commits_on_another_remote_branch_as_pushed() {
        // upstream(origin/<branch>)은 c1에 있지만 c2는 다른 원격 브랜치(origin/backup)에 있다.
        let tmp = TempRepo::new();
        let repo = tmp.open();
        let c1 = commit(&repo, "a.txt", "1");
        let c2 = commit(&repo, "a.txt", "2");
        let c3 = commit(&repo, "a.txt", "3");
        let branch = head_branch(&repo);
        set_remote_ref(&repo, &format!("origin/{branch}"), c1);
        set_remote_ref(&repo, "origin/backup", c2);
        let mut b = repo.find_branch(&branch, BranchType::Local).unwrap();
        b.set_upstream(Some(&format!("origin/{branch}"))).unwrap();

        let set = compute_unpushed(&repo);
        assert_eq!(set.into_iter().collect::<Vec<_>>(), vec![c3]);
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

        let commits = get_commit_history(repo_path, Some(100), Some(0), None)
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

        // 리모트가 없으므로 올릴 곳이 없다: 아무 커밋도 unpushed로 표시하지 않는다
        assert!(commits.iter().all(|v| !v["isUnpushed"].as_bool().unwrap()));
    }

    /// `git mv`로 옮긴 파일은 삭제+추가가 아니라 이름 변경으로 보여야 한다.
    #[tokio::test]
    async fn commit_detail_and_file_diff_detect_renames() {
        let tmp = TempRepo::new();
        let repo_path = tmp.path.to_str().unwrap().to_string();
        let content = "line 1\nline 2\nline 3\nline 4\n";
        let oid = {
            let repo = tmp.open();
            commit(&repo, "old.txt", content);
            let workdir = repo.workdir().unwrap().to_path_buf();
            std::fs::rename(workdir.join("old.txt"), workdir.join("new.txt")).unwrap();
            let mut index = repo.index().unwrap();
            index.remove_path(Path::new("old.txt")).unwrap();
            index.write().unwrap();
            commit(&repo, "new.txt", content)
        };

        let detail = get_commit_detail(repo_path.clone(), oid.to_string()).await.unwrap();
        let files = detail["diff"]["files"].as_array().unwrap();
        assert_eq!(files.len(), 1, "{:?}", files);
        assert_eq!(files[0]["status"], "Renamed");
        assert_eq!(files[0]["oldPath"], "old.txt");
        assert_eq!(files[0]["newPath"], "new.txt");

        let diff = get_commit_file_diff(repo_path, oid.to_string(), "new.txt".to_string())
            .await
            .unwrap();
        assert_eq!(diff["oldContent"], content);
        assert_eq!(diff["hunks"].as_array().unwrap().len(), 0, "{}", diff["hunks"]);
    }

    /// 히스토리 목록과 커밋 상세가 병합 커밋의 부모 2개와 공동 작성자·에이전트
    /// 추정을 같은 값으로 내려주는지.
    #[tokio::test]
    async fn history_and_detail_report_merge_parents_and_co_authors() {
        let tmp = TempRepo::new();
        let repo_path = tmp.path.to_str().unwrap().to_string();
        let (left, right, merge) = {
            let repo = tmp.open();
            let base = commit(&repo, "a.txt", "1");
            let main_branch = head_branch(&repo);
            repo.branch("side", &repo.find_commit(base).unwrap(), false).unwrap();
            let left = commit(&repo, "a.txt", "2");
            repo.set_head("refs/heads/side").unwrap();
            let right = commit(&repo, "b.txt", "3");
            repo.set_head(&format!("refs/heads/{main_branch}")).unwrap();

            let sig = Signature::now("Test", "test@example.com").unwrap();
            let tree = repo.find_commit(left).unwrap().tree().unwrap();
            let merge = repo
                .commit(
                    Some("HEAD"),
                    &sig,
                    &sig,
                    "Merge side\n\nCo-authored-by: Claude <noreply@anthropic.com>\n",
                    &tree,
                    &[&repo.find_commit(left).unwrap(), &repo.find_commit(right).unwrap()],
                )
                .unwrap();
            (left, right, merge)
        };

        let history = get_commit_history(repo_path.clone(), Some(10), Some(0), None).await.unwrap();
        let top = &history[0];
        assert_eq!(top["oid"], merge.to_string());
        assert_eq!(top["parentIds"], json!([left.to_string(), right.to_string()]));
        assert_eq!(top["parentCount"], 2);
        assert_eq!(
            top["coAuthors"],
            json!([{ "name": "Claude", "email": "noreply@anthropic.com" }])
        );
        assert_eq!(top["isAgentAuthored"], true);

        let plain = history.iter().find(|c| c["oid"] == left.to_string()).unwrap();
        assert_eq!(plain["coAuthors"], json!([]));
        assert_eq!(plain["isAgentAuthored"], false);

        let detail = get_commit_detail(repo_path, merge.to_string()).await.unwrap();
        assert_eq!(detail["parents"], top["parentIds"]);
        assert_eq!(detail["coAuthors"], top["coAuthors"]);
        assert_eq!(detail["isAgentAuthored"], true);
    }

    /// 커밋 OID를 정렬해 돌려준다. 테스트 커밋은 같은 초에 만들어져 시간순이 흔들린다.
    fn oids_of(commits: &[Value]) -> Vec<String> {
        let mut out: Vec<String> = commits
            .iter()
            .map(|v| v["oid"].as_str().unwrap().to_string())
            .collect();
        out.sort();
        out
    }

    fn sorted(oids: &[Oid]) -> Vec<String> {
        let mut out: Vec<String> = oids.iter().map(Oid::to_string).collect();
        out.sort();
        out
    }

    /// main: c1 ← c2, feature: c2 ← c3(체크아웃 안 함), origin/remote-only: c1 ← r1, 태그 v1 → c1.
    fn branchy_repo(tmp: &TempRepo) -> (Oid, Oid, Oid, Oid) {
        let repo = tmp.open();
        let c1 = commit(&repo, "a.txt", "1");
        let c2 = commit(&repo, "a.txt", "2");
        let main_branch = head_branch(&repo);
        repo.branch("feature", &repo.find_commit(c2).unwrap(), false)
            .unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        let c3 = commit(&repo, "b.txt", "3");
        repo.set_head(&format!("refs/heads/{main_branch}")).unwrap();
        // 원격에만 있는 브랜치: c1에서 갈라진 커밋 r1
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let base = repo.find_commit(c1).unwrap();
        let r1 = repo
            .commit(None, &sig, &sig, "remote only", &base.tree().unwrap(), &[&base])
            .unwrap();
        set_remote_ref(&repo, "origin/remote-only", r1);
        repo.tag_lightweight("v1", base.as_object(), false).unwrap();
        (c1, c2, c3, r1)
    }

    fn named(name: &str) -> Option<HistoryTarget> {
        Some(HistoryTarget::Ref { name: name.to_string() })
    }

    #[tokio::test]
    async fn history_of_other_local_branch_without_checkout() {
        let tmp = TempRepo::new();
        let path = tmp.path.to_str().unwrap().to_string();
        let (c1, c2, c3, _) = branchy_repo(&tmp);

        let commits = get_commit_history(path.clone(), Some(100), Some(0), named("feature"))
            .await
            .unwrap();
        assert_eq!(oids_of(&commits), sorted(&[c3, c2, c1]));
        // 보기만 했으므로 HEAD는 그대로 원래 브랜치다.
        assert_ne!(head_branch(&tmp.open()), "feature");
    }

    #[tokio::test]
    async fn history_of_remote_branch_marks_nothing_unpushed() {
        let tmp = TempRepo::new();
        let path = tmp.path.to_str().unwrap().to_string();
        let (c1, _, _, r1) = branchy_repo(&tmp);

        let commits = get_commit_history(path, Some(100), Some(0), named("origin/remote-only"))
            .await
            .unwrap();
        assert_eq!(oids_of(&commits), sorted(&[r1, c1]));
        assert!(commits.iter().all(|v| v["isUnpushed"] == false));
    }

    #[tokio::test]
    async fn history_of_tag() {
        let tmp = TempRepo::new();
        let path = tmp.path.to_str().unwrap().to_string();
        let (c1, _, _, _) = branchy_repo(&tmp);

        let commits = get_commit_history(path, Some(100), Some(0), named("v1"))
            .await
            .unwrap();
        assert_eq!(oids_of(&commits), sorted(&[c1]));
    }

    #[tokio::test]
    async fn history_of_all_branches_includes_every_tip() {
        let tmp = TempRepo::new();
        let path = tmp.path.to_str().unwrap().to_string();
        let (c1, c2, c3, r1) = branchy_repo(&tmp);

        let commits = get_commit_history(path.clone(), Some(100), Some(0), Some(HistoryTarget::All))
            .await
            .unwrap();
        assert_eq!(oids_of(&commits), sorted(&[c1, c2, c3, r1]));
        // r1은 원격에 있으니 push할 것이 아니고, 로컬 커밋 c1은 origin/remote-only에서 닿는다.
        let unpushed = |oid: Oid| {
            commits.iter().find(|v| v["oid"] == oid.to_string()).unwrap()["isUnpushed"] == true
        };
        assert!(!unpushed(r1));
        assert!(!unpushed(c1));
        assert!(unpushed(c3));

        // 기본값(None)과 Head는 체크아웃한 브랜치만.
        let head = get_commit_history(path.clone(), Some(100), Some(0), Some(HistoryTarget::Head))
            .await
            .unwrap();
        assert_eq!(oids_of(&head), sorted(&[c2, c1]));
    }

    #[tokio::test]
    async fn history_paginates_from_ref() {
        let tmp = TempRepo::new();
        let path = tmp.path.to_str().unwrap().to_string();
        let (c1, c2, c3, _) = branchy_repo(&tmp);

        let first = get_commit_history(path.clone(), Some(2), Some(0), named("feature"))
            .await
            .unwrap();
        let second = get_commit_history(path, Some(2), Some(2), named("feature"))
            .await
            .unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(second.len(), 1);
        let both: Vec<Value> = first.into_iter().chain(second).collect();
        assert_eq!(oids_of(&both), sorted(&[c3, c2, c1]));
    }

    #[tokio::test]
    async fn history_of_unknown_or_invalid_ref_fails() {
        let tmp = TempRepo::new();
        let path = tmp.path.to_str().unwrap().to_string();
        branchy_repo(&tmp);

        assert!(get_commit_history(path.clone(), None, None, named("nope")).await.is_err());
        assert!(get_commit_history(path.clone(), None, None, named("--all")).await.is_err());
        assert!(get_commit_history(path, None, None, named("")).await.is_err());
    }

    #[test]
    fn history_target_deserializes_from_frontend_shape() {
        let head: HistoryTarget = serde_json::from_value(json!({ "kind": "head" })).unwrap();
        let all: HistoryTarget = serde_json::from_value(json!({ "kind": "all" })).unwrap();
        let named: HistoryTarget =
            serde_json::from_value(json!({ "kind": "ref", "name": "origin/x" })).unwrap();
        assert_eq!(head, HistoryTarget::Head);
        assert_eq!(all, HistoryTarget::All);
        assert_eq!(named, HistoryTarget::Ref { name: "origin/x".into() });
    }
}
