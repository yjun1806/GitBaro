use crate::error::AppError;
use crate::git::engine::RemoteInfo;

/// Parse a GitHub HTTPS URL and extract (owner, repo).
/// Handles: https://github.com/owner/repo and https://github.com/owner/repo.git
pub fn parse_github_url(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    // Strip protocol prefix
    let path = if let Some(s) = url.strip_prefix("https://github.com/") {
        s
    } else if let Some(s) = url.strip_prefix("git@github.com:") {
        s
    } else {
        return None;
    };

    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);

    let parts: Vec<&str> = path.splitn(2, '/').collect();
    if parts.len() == 2 {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

/// Build an authenticated HTTPS clone URL using a token.
/// Result: https://x-access-token:{token}@github.com/{owner}/{repo}.git
pub fn authenticated_url(base_url: &str, token: &str) -> String {
    // Strip any existing userinfo (credentials) from the URL.
    // e.g. "https://old-token@github.com/..." -> "https://github.com/..."
    let clean = if let Some(proto_end) = base_url.find("://") {
        let after_proto = &base_url[proto_end + 3..];
        if let Some(at_pos) = after_proto.find('@') {
            // There are existing credentials — remove them.
            let host_onward = &after_proto[at_pos + 1..];
            format!("{}{}", &base_url[..proto_end + 3], host_onward)
        } else {
            base_url.to_string()
        }
    } else {
        base_url.to_string()
    };

    // Insert token credentials after the protocol.
    if let Some(proto_end) = clean.find("://") {
        let proto = &clean[..proto_end + 3];
        let rest = &clean[proto_end + 3..];
        format!("{}x-access-token:{}@{}", proto, token, rest)
    } else {
        clean
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
