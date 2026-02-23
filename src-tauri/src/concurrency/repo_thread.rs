use crate::error::AppError;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::mpsc;
use tokio::sync::oneshot;

pub enum GitCommand {
    Status {
        reply: oneshot::Sender<Result<Vec<Value>, AppError>>,
    },
    Diff {
        staged: bool,
        reply: oneshot::Sender<Result<Value, AppError>>,
    },
    Commit {
        message: String,
        amend: bool,
        reply: oneshot::Sender<Result<String, AppError>>,
    },
    Refresh,
    Shutdown,
}

pub struct RepoWorker {
    sender: mpsc::Sender<GitCommand>,
}

impl RepoWorker {
    /// Spawn a dedicated blocking thread that owns a `git2::Repository`.
    /// All git operations are serialized through the mpsc channel.
    pub fn spawn(repo_path: PathBuf) -> Self {
        let (sender, receiver) = mpsc::channel::<GitCommand>();

        std::thread::spawn(move || {
            let repo = match git2::Repository::open(&repo_path) {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("RepoWorker: failed to open repo {:?}: {}", repo_path, e);
                    return;
                }
            };

            tracing::info!("RepoWorker started for {:?}", repo_path);

            for cmd in &receiver {
                match cmd {
                    GitCommand::Status { reply } => {
                        let result = get_status_inner(&repo);
                        let _ = reply.send(result);
                    }
                    GitCommand::Diff { staged, reply } => {
                        let result = get_diff_inner(&repo, staged);
                        let _ = reply.send(result);
                    }
                    GitCommand::Commit {
                        message,
                        amend,
                        reply,
                    } => {
                        let result = commit_inner(&repo, &message, amend);
                        let _ = reply.send(result);
                    }
                    GitCommand::Refresh => {
                        tracing::debug!("RepoWorker: refresh signal received");
                        // Trigger status refresh (caller can query Status afterward)
                    }
                    GitCommand::Shutdown => {
                        tracing::info!("RepoWorker shutting down for {:?}", repo_path);
                        break;
                    }
                }
            }
        });

        RepoWorker { sender }
    }

    pub fn send(&self, cmd: GitCommand) -> Result<(), AppError> {
        self.sender
            .send(cmd)
            .map_err(|e| AppError::Channel(e.to_string()))
    }
}

impl Drop for RepoWorker {
    fn drop(&mut self) {
        let _ = self.sender.send(GitCommand::Shutdown);
    }
}

// --- Inner git2 operations (run on the dedicated thread) ---

fn get_status_inner(repo: &git2::Repository) -> Result<Vec<Value>, AppError> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let entries: Vec<Value> = statuses
        .iter()
        .filter_map(|entry| {
            let path = entry.path()?.to_string();
            let status = entry.status();

            let staged = status.intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            );

            let unstaged = status.intersects(
                git2::Status::WT_MODIFIED
                    | git2::Status::WT_DELETED
                    | git2::Status::WT_RENAMED
                    | git2::Status::WT_TYPECHANGE
                    | git2::Status::WT_NEW,
            );

            Some(serde_json::json!({
                "path": path,
                "staged": staged,
                "unstaged": unstaged,
            }))
        })
        .collect();

    Ok(entries)
}

fn get_diff_inner(repo: &git2::Repository, staged: bool) -> Result<Value, AppError> {
    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, None)?
    } else {
        repo.diff_index_to_workdir(None, None)?
    };

    let stats = diff.stats()?;
    Ok(serde_json::json!({
        "filesChanged": stats.files_changed(),
        "insertions": stats.insertions(),
        "deletions": stats.deletions(),
    }))
}

fn commit_inner(
    repo: &git2::Repository,
    message: &str,
    amend: bool,
) -> Result<String, AppError> {
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = repo.signature()?;

    let oid = if amend {
        let head = repo.head()?;
        let parent_commit = head.peel_to_commit()?;
        parent_commit.amend(
            Some("HEAD"),
            Some(&sig),
            Some(&sig),
            None,
            Some(message),
            Some(&tree),
        )?
    } else {
        let parent_commits: Vec<git2::Commit> = match repo.head() {
            Ok(head) => vec![head.peel_to_commit()?],
            Err(_) => vec![],
        };
        let parents: Vec<&git2::Commit> = parent_commits.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?
    };

    Ok(oid.to_string())
}
