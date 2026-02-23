use crate::error::AppError;
use crate::git::engine::{AuthorInfo, CommitInfo};

/// Validate a commit message — must not be empty or whitespace-only.
pub fn validate_message(message: &str) -> Result<(), AppError> {
    if message.trim().is_empty() {
        return Err(AppError::GitCli {
            message: "Commit message cannot be empty".to_string(),
            exit_code: None,
        });
    }
    Ok(())
}

/// Extract the subject line (first line) from a commit message.
pub fn subject_line(message: &str) -> &str {
    message.lines().next().unwrap_or("").trim()
}

/// Extract the body (everything after the subject + blank line) from a commit message.
pub fn body_text(message: &str) -> &str {
    // Find the first newline (end of subject line)
    if let Some(pos) = message.find('\n') {
        let rest = &message[pos + 1..];
        // Skip optional blank separator line
        rest.trim_start_matches('\n')
    } else {
        ""
    }
}

/// Convert a git2 `Signature` into our `AuthorInfo`.
pub fn signature_to_author(sig: &git2::Signature<'_>) -> AuthorInfo {
    AuthorInfo {
        name: sig.name().unwrap_or("Unknown").to_string(),
        email: sig.email().unwrap_or("").to_string(),
        timestamp: sig.when().seconds(),
    }
}

/// Convert a git2 `Commit` into our `CommitInfo`.
pub fn commit_to_info(commit: &git2::Commit<'_>) -> CommitInfo {
    let id = commit.id().to_string();
    let short_id = id[..8.min(id.len())].to_string();
    let message = commit.message().unwrap_or("").to_string();
    let summary = subject_line(&message).to_string();
    let author = signature_to_author(&commit.author());
    let committer = signature_to_author(&commit.committer());
    let timestamp = commit.time().seconds();
    let parent_ids = (0..commit.parent_count())
        .map(|i| commit.parent_id(i).map(|oid| oid.to_string()).unwrap_or_default())
        .collect();

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
