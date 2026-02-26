use crate::error::AppError;
use crate::git::binary::{detect_file_type, extension_to_mime, is_previewable, MAX_PREVIEW_SIZE};
use base64::Engine;
use serde_json::{json, Value};

fn build_binary_preview(
    repo: &git2::Repository,
    repo_path: &str,
    file_path: &str,
    staged: bool,
) -> Option<Value> {
    let file_type = detect_file_type(file_path);
    if !is_previewable(&file_type) {
        return None;
    }

    let mime_type = extension_to_mime(file_path);

    // Read old bytes from HEAD tree
    let old_bytes: Option<Vec<u8>> = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok())
        .and_then(|tree| tree.get_path(std::path::Path::new(file_path)).ok())
        .and_then(|entry| repo.find_blob(entry.id()).ok())
        .map(|blob| blob.content().to_vec());

    // Read new bytes
    let new_bytes: Option<Vec<u8>> = if staged {
        // staged: read from index
        repo.index()
            .ok()
            .and_then(|index| {
                let entry = index.iter().find(|e| {
                    let path = String::from_utf8_lossy(&e.path);
                    path == file_path
                })?;
                repo.find_blob(entry.id).ok()
            })
            .map(|blob| blob.content().to_vec())
    } else {
        // unstaged: read from disk
        let full_path = std::path::Path::new(repo_path).join(file_path);
        std::fs::read(&full_path).ok()
    };

    let old_size = old_bytes.as_ref().map(|b| b.len());
    let new_size = new_bytes.as_ref().map(|b| b.len());

    // Check size limit
    if old_size.unwrap_or(0) > MAX_PREVIEW_SIZE || new_size.unwrap_or(0) > MAX_PREVIEW_SIZE {
        return Some(json!({
            "meta": {
                "fileType": file_type,
                "mimeType": mime_type,
                "oldSize": old_size,
                "newSize": new_size,
                "tooLarge": true
            },
            "oldBase64": null,
            "newBase64": null
        }));
    }

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

#[tauri::command]
pub async fn get_file_diff(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;

        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.pathspec(&file_path);
        diff_opts.include_untracked(true);

        let diff = if staged {
            let head_tree = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut diff_opts))?
        } else {
            repo.diff_index_to_workdir(None, Some(&mut diff_opts))?
        };

        let mut hunks: Vec<Value> = Vec::new();
        let mut current_hunk_lines: Vec<Value> = Vec::new();
        let mut current_hunk_header = String::new();
        let mut current_old_start: u32 = 0;
        let mut current_new_start: u32 = 0;

        diff.print(git2::DiffFormat::Patch, |_delta, hunk, line| {
            match line.origin() {
                'H' => {
                    // Hunk header line — flush previous hunk
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
                _ => {} // file header lines, etc.
            }
            true
        })?;

        // Push the last hunk
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
            build_binary_preview(&repo, &repo_path, &file_path, staged)
        } else {
            None
        };

        // Read old/new file contents for hunk expand support
        let old_content = {
            let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            head_tree
                .and_then(|tree| tree.get_path(std::path::Path::new(&file_path)).ok())
                .and_then(|entry| repo.find_blob(entry.id()).ok())
                .map(|blob| String::from_utf8_lossy(blob.content()).to_string())
                .unwrap_or_default()
        };

        let new_content = if staged {
            // staged: new content is in the index
            repo.index()
                .ok()
                .and_then(|index| {
                    let entry = index.iter().find(|e| {
                        let path = String::from_utf8_lossy(&e.path);
                        path == file_path
                    })?;
                    repo.find_blob(entry.id).ok()
                })
                .map(|blob| String::from_utf8_lossy(blob.content()).to_string())
                .unwrap_or_default()
        } else {
            // unstaged: new content is on disk
            let full_path = std::path::Path::new(&repo_path).join(&file_path);
            std::fs::read_to_string(&full_path).unwrap_or_default()
        };

        let stats = diff.stats()?;

        // Fallback for untracked files: git2 may not produce patch lines
        // even with include_untracked. Read the file directly.
        if hunks.is_empty() && !staged {
            let full_path = std::path::Path::new(&repo_path).join(&file_path);
            if full_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&full_path) {
                    let lines: Vec<Value> = content
                        .lines()
                        .enumerate()
                        .map(|(i, line)| {
                            json!({
                                "kind": "addition",
                                "content": line,
                                "oldLineNo": null,
                                "newLineNo": (i as u32) + 1,
                            })
                        })
                        .collect();
                    let line_count = lines.len();
                    if line_count > 0 {
                        hunks.push(json!({
                            "header": format!("@@ -0,0 +1,{} @@ new file", line_count),
                            "oldStart": 0,
                            "newStart": 1,
                            "lines": lines,
                        }));
                    }
                }
            }
        }

        let total_insertions = if hunks.is_empty() {
            stats.insertions()
        } else {
            hunks.iter()
                .filter_map(|h| h["lines"].as_array())
                .flatten()
                .filter(|l| l["kind"] == "addition")
                .count()
        };

        Ok::<_, AppError>(json!({
            "filePath": file_path,
            "staged": staged,
            "binary": is_binary,
            "binaryPreview": binary_preview,
            "insertions": total_insertions,
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
