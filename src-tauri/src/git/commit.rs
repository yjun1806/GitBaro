use std::collections::HashMap;

use git2::Repository;

use crate::error::AppError;
use crate::git::engine::{AuthorInfo, CommitInfo, RefKind, RefLabel};

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

/// Validate a commit id (oid) for use as a git CLI argument.
/// Must be hex only and 4..=64 chars — this both rejects garbage and prevents
/// option injection (a leading '-' is not a hex digit).
pub fn validate_commit_oid(oid: &str) -> Result<(), AppError> {
    let valid = (4..=64).contains(&oid.len()) && oid.chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return Err(AppError::GitCli {
            message: format!("Invalid commit id: '{}'", oid),
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
        refs: Vec::new(),
    }
}

/// Build a map from commit OID → refs (tags/branches) pointing at it.
/// Annotated tags are peeled to the commit they ultimately reference, so both
/// lightweight and annotated tags land on the right commit. Symbolic refs like
/// `origin/HEAD` are skipped since they are not real branches.
pub fn build_ref_map(repo: &Repository) -> HashMap<git2::Oid, Vec<RefLabel>> {
    // Name of the currently checked-out local branch, if HEAD is not detached.
    let head_branch = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(String::from));

    let mut map: HashMap<git2::Oid, Vec<RefLabel>> = HashMap::new();

    let Ok(references) = repo.references() else {
        return map;
    };

    for reference in references.flatten() {
        // Resolve to the commit this ref ultimately points at.
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        let oid = commit.id();
        let short = reference.shorthand().unwrap_or("");
        if short.is_empty() {
            continue;
        }

        let (name, kind) = if reference.is_tag() {
            (short.to_string(), RefKind::Tag)
        } else if reference.is_remote() {
            if short.ends_with("/HEAD") {
                continue;
            }
            (short.to_string(), RefKind::RemoteBranch)
        } else if reference.is_branch() {
            (short.to_string(), RefKind::LocalBranch)
        } else {
            continue;
        };

        let is_head =
            kind == RefKind::LocalBranch && head_branch.as_deref() == Some(name.as_str());

        map.entry(oid).or_default().push(RefLabel { name, kind, is_head });
    }

    // Order within a commit: HEAD first, then local branches, remotes, tags.
    for labels in map.values_mut() {
        labels.sort_by_key(|l| match (l.is_head, &l.kind) {
            (true, _) => 0,
            (false, RefKind::LocalBranch) => 1,
            (false, RefKind::RemoteBranch) => 2,
            (false, RefKind::Tag) => 3,
        });
    }

    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_full_length_lowercase_hex_oid() {
        let oid = "0123456789abcdef0123456789abcdef01234567"; // 40 chars
        assert!(validate_commit_oid(oid).is_ok());
    }

    #[test]
    fn accepts_short_hex_oid() {
        assert!(validate_commit_oid("1a2b3c4").is_ok()); // 7 chars
    }

    #[test]
    fn rejects_too_short_oid() {
        assert!(validate_commit_oid("abc").is_err()); // 3 chars
    }

    #[test]
    fn rejects_too_long_oid() {
        let oid = "a".repeat(65); // 65 chars
        assert!(validate_commit_oid(&oid).is_err());
    }

    #[test]
    fn rejects_non_hex_chars() {
        assert!(validate_commit_oid("zzzz1234").is_err());
    }

    #[test]
    fn rejects_leading_dash_option_injection() {
        assert!(validate_commit_oid("-rf").is_err());
    }
}
