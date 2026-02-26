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

#[tauri::command]
pub async fn get_commit_history(
    repo_path: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut revwalk = repo.revwalk()?;
        revwalk.push_head()?;
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
    let token = match token_store.get_token(&username).await {
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
