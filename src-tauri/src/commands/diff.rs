use crate::error::AppError;
use crate::git::binary::{detect_file_type, extension_to_mime, is_previewable, MAX_PREVIEW_SIZE};
use crate::git::diff::{detect_renames, rename_source};
use base64::Engine;
use serde_json::{json, Value};

fn build_binary_preview(
    file_path: &str,
    old_bytes: Option<Vec<u8>>,
    new_bytes: Option<Vec<u8>>,
) -> Option<Value> {
    let file_type = detect_file_type(file_path);
    if !is_previewable(&file_type) {
        return None;
    }

    let mime_type = extension_to_mime(file_path);

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

/// Content of the stage-0 index entry at `path`, if any.
fn index_blob(repo: &git2::Repository, index: &git2::Index, path: &std::path::Path) -> Option<Vec<u8>> {
    let entry = index.get_path(path, 0)?;
    repo.find_blob(entry.id).ok().map(|blob| blob.content().to_vec())
}

#[tauri::command]
pub async fn get_file_diff(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        let index = repo.index()?;
        let rel_path = std::path::Path::new(&file_path);
        let in_index = index.get_path(rel_path, 0).is_some();

        // A staged file missing from HEAD may be the new side of a rename
        // (`git mv`). Find its source so the diff compares the two contents
        // instead of showing the whole file as added.
        let rename_from = if staged
            && head_tree.as_ref().is_some_and(|t| t.get_path(rel_path).is_err())
        {
            let mut full = repo.diff_tree_to_index(head_tree.as_ref(), None, None)?;
            rename_source(&mut full, &file_path)?
        } else {
            None
        };

        let mut diff_opts = git2::DiffOptions::new();
        diff_opts
            .pathspec(&file_path)
            .disable_pathspec_match(true)
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        if let Some(src) = &rename_from {
            diff_opts.pathspec(src);
        }

        let mut diff = if staged {
            repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut diff_opts))?
        } else {
            repo.diff_index_to_workdir(None, Some(&mut diff_opts))?
        };
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

        // Old side: HEAD for the staged diff (at the rename source, if any),
        // the index for the unstaged diff — the same bases the hunks use.
        let old_bytes: Option<Vec<u8>> = if staged {
            let old_path = rename_from.as_deref().unwrap_or(&file_path);
            head_tree
                .as_ref()
                .and_then(|tree| tree.get_path(std::path::Path::new(old_path)).ok())
                .and_then(|entry| repo.find_blob(entry.id()).ok())
                .map(|blob| blob.content().to_vec())
        } else {
            index_blob(&repo, &index, rel_path)
        };

        // New side: the index for the staged diff, the disk for the unstaged one.
        let full_path = std::path::Path::new(&repo_path).join(&file_path);
        let new_bytes: Option<Vec<u8>> = if staged {
            index_blob(&repo, &index, rel_path)
        } else {
            std::fs::read(&full_path).ok()
        };

        // Build binary preview if applicable
        let binary_preview = if is_binary {
            build_binary_preview(&file_path, old_bytes.clone(), new_bytes.clone())
        } else {
            None
        };

        // Old/new file contents for hunk expand support
        let old_content = old_bytes
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        let new_content = new_bytes
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();

        let stats = diff.stats()?;

        // Fallback for untracked files: git2 may not produce patch lines
        // even with include_untracked. Read the file directly. Only for files
        // git does not track — a tracked file with no hunks (e.g. a
        // mode-only `chmod +x` change) must not be rendered as a new file.
        if hunks.is_empty() && !staged && !in_index && full_path.exists() {
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

    fn temp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gitbaro-diff-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "t@t"]);
        git(&dir, &["config", "user.name", "t"]);
        std::fs::write(dir.join("f.txt"), "one\ntwo\nthree\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);
        dir
    }

    async fn diff(dir: &std::path::Path, path: &str, staged: bool) -> Value {
        get_file_diff(dir.to_string_lossy().to_string(), path.to_string(), staged)
            .await
            .unwrap()
    }

    /// 일부만 스테이징된 파일의 unstaged diff는 인덱스를 old 쪽으로 삼는다.
    #[tokio::test]
    async fn unstaged_diff_reads_old_side_from_the_index() {
        let dir = temp_repo("index-old");
        std::fs::write(dir.join("f.txt"), "one\nTWO\nthree\n").unwrap();
        git(&dir, &["add", "f.txt"]);
        std::fs::write(dir.join("f.txt"), "one\nTWO\nthree\nfour\n").unwrap();

        let unstaged = diff(&dir, "f.txt", false).await;
        let staged = diff(&dir, "f.txt", true).await;
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(unstaged["oldContent"], "one\nTWO\nthree\n");
        assert_eq!(staged["oldContent"], "one\ntwo\nthree\n");
        assert_eq!(staged["newContent"], "one\nTWO\nthree\n");
    }

    /// 권한만 바뀐 파일을 새 파일 전체 추가로 그리면 안 된다.
    #[tokio::test]
    async fn mode_only_change_is_not_rendered_as_a_new_file() {
        let dir = temp_repo("mode-only");
        git(&dir, &["config", "core.fileMode", "true"]);
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir.join("f.txt"), std::fs::Permissions::from_mode(0o755)).unwrap();

        let d = diff(&dir, "f.txt", false).await;
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(d["hunks"].as_array().unwrap().len(), 0, "{}", d["hunks"]);
    }

    #[tokio::test]
    async fn untracked_file_is_shown_as_added() {
        let dir = temp_repo("untracked");
        std::fs::create_dir_all(dir.join("new dir")).unwrap();
        std::fs::write(dir.join("new dir/n.txt"), "a\nb\n").unwrap();

        let d = diff(&dir, "new dir/n.txt", false).await;
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(d["insertions"], 2, "{}", d);
    }

    /// `git mv` 후 staged diff는 이전 경로의 내용과 비교한다.
    #[tokio::test]
    async fn staged_rename_is_diffed_against_its_source() {
        let dir = temp_repo("rename");
        git(&dir, &["mv", "f.txt", "g.txt"]);

        let d = diff(&dir, "g.txt", true).await;
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(d["oldContent"], "one\ntwo\nthree\n");
        assert_eq!(d["hunks"].as_array().unwrap().len(), 0, "{}", d["hunks"]);
    }
}
