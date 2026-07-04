use crate::error::AppError;
use crate::git::engine::RemoteInfo;

/// Parse a GitHub HTTPS URL and extract (owner, repo).
/// Handles: https://github.com/owner/repo and https://github.com/owner/repo.git
pub fn parse_github_url(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    // Strip protocol prefix
    let path = if let Some(s) = url.strip_prefix("https://github.com/") {
        s
    } else { url.strip_prefix("git@github.com:")? };

    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);

    let parts: Vec<&str> = path.splitn(2, '/').collect();
    if parts.len() == 2 {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

/// Validate a clone URL before handing it to `git clone`.
///
/// git's remote helpers include dangerous transports (`ext::` runs an arbitrary
/// command, `fd::`, `file://` reads local paths). A URL beginning with `-` would
/// also be parsed as a flag. We restrict clone URLs to the network transports a
/// GUI user actually needs.
pub fn validate_clone_url(url: &str) -> Result<(), AppError> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err(AppError::GitCli {
            message: "Invalid clone URL".to_string(),
            exit_code: None,
        });
    }
    let allowed = trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("git://")
        || trimmed.starts_with("ssh://")
        // scp-like syntax: user@host:path
        || (trimmed.contains('@') && trimmed.contains(':') && !trimmed.contains("://"));
    if allowed {
        Ok(())
    } else {
        Err(AppError::GitCli {
            message: "Unsupported clone URL scheme".to_string(),
            exit_code: None,
        })
    }
}

/// Convert a git2 `Remote` to our `RemoteInfo`.
pub fn remote_to_info(remote: &git2::Remote<'_>) -> RemoteInfo {
    RemoteInfo {
        name: remote.name().unwrap_or("").to_string(),
        url: remote.url().unwrap_or("").to_string(),
        push_url: remote.pushurl().map(|u| u.to_string()),
    }
}

/// List all remotes from a git2 repository.
pub fn list_remotes(repo: &git2::Repository) -> Result<Vec<RemoteInfo>, AppError> {
    let remote_names = repo.remotes()?;
    let mut remotes = Vec::new();
    for name in remote_names.iter().flatten() {
        let remote = repo.find_remote(name)?;
        remotes.push(remote_to_info(&remote));
    }
    Ok(remotes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_urls() {
        assert_eq!(
            parse_github_url("https://github.com/owner/repo.git"),
            Some(("owner".to_string(), "repo".to_string()))
        );
        assert_eq!(
            parse_github_url("git@github.com:owner/repo"),
            Some(("owner".to_string(), "repo".to_string()))
        );
        assert_eq!(parse_github_url("https://example.com/x/y"), None);
    }

    #[test]
    fn accepts_safe_clone_urls() {
        assert!(validate_clone_url("https://github.com/owner/repo.git").is_ok());
        assert!(validate_clone_url("http://host/repo.git").is_ok());
        assert!(validate_clone_url("git://host/repo.git").is_ok());
        assert!(validate_clone_url("ssh://git@host/repo.git").is_ok());
        assert!(validate_clone_url("git@github.com:owner/repo.git").is_ok());
    }

    #[test]
    fn rejects_dangerous_clone_urls() {
        // ext:: runs an arbitrary command; file:/fd: read local resources.
        assert!(validate_clone_url("ext::sh -c 'touch /tmp/pwned'").is_err());
        assert!(validate_clone_url("file:///etc/passwd").is_err());
        assert!(validate_clone_url("fd::17/foo").is_err());
        // Leading dash → parsed as a git flag.
        assert!(validate_clone_url("--upload-pack=evil").is_err());
        assert!(validate_clone_url("").is_err());
    }
}
