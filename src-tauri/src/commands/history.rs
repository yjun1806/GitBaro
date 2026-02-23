use crate::error::AppError;
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
