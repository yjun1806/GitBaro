use crate::error::AppError;
use serde_json::{json, Value};

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
            "insertions": total_insertions,
            "deletions": stats.deletions(),
            "hunks": hunks,
        }))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}
