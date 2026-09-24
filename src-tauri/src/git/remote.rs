use crate::error::AppError;
use crate::git::engine::RemoteInfo;

const GITHUB_HOST: &str = "github.com";

/// A remote URL split into its host and repository path.
struct RemoteParts<'a> {
    host: &'a str,
    path: &'a str,
    is_ssh: bool,
}

/// Split a git remote URL into host and path. Supports `scheme://[user@]host[:port]/path`
/// (https, http, ssh, git, git+ssh) and scp-like `[user@]host:path`.
fn split_remote_url(url: &str) -> Option<RemoteParts<'_>> {
    let url = url.trim();
    if let Some((scheme, rest)) = url.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        if !matches!(scheme.as_str(), "https" | "http" | "ssh" | "git" | "git+ssh" | "ssh+git") {
            return None;
        }
        let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
        let host_port = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        let host = host_port.split(':').next().unwrap_or("");
        return Some(RemoteParts {
            host,
            path,
            is_ssh: scheme.contains("ssh"),
        });
    }

    // scp-like syntax: the first ':' must come before any '/'.
    let colon = url.find(':')?;
    if url[..colon].contains('/') {
        return None;
    }
    let authority = &url[..colon];
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    Some(RemoteParts {
        host,
        path: &url[colon + 1..],
        is_ssh: true,
    })
}

/// Extract `(owner, repo)` from a repository path like `owner/repo.git`.
fn owner_repo_from_path(path: &str) -> Option<(String, String)> {
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, repo) = path.split_once('/')?;
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// True when `url` points at github.com itself (any scheme). GitHub tokens and
/// the credential-helper override are only ever applied to such remotes.
pub fn is_github_com_url(url: &str) -> bool {
    split_remote_url(url).is_some_and(|p| p.host.eq_ignore_ascii_case(GITHUB_HOST))
}

/// Parse a GitHub remote URL and extract `(owner, repo)`.
///
/// Handles `https://github.com/o/r(.git)`, `http://`, `https://user@github.com/o/r`,
/// `git@github.com:o/r`, `ssh://git@github.com/o/r`, and SSH host aliases
/// (`git@github-work:o/r`) whose `ssh -G` HostName is github.com.
pub fn parse_github_url(url: &str) -> Option<(String, String)> {
    parse_github_url_with(url, resolve_ssh_hostname)
}

fn parse_github_url_with(
    url: &str,
    resolve_ssh_host: impl Fn(&str) -> Option<String>,
) -> Option<(String, String)> {
    let parts = split_remote_url(url)?;
    let is_github = parts.host.eq_ignore_ascii_case(GITHUB_HOST)
        || (parts.is_ssh
            && resolve_ssh_host(parts.host)
                .is_some_and(|h| h.eq_ignore_ascii_case(GITHUB_HOST)));
    if !is_github {
        return None;
    }
    owner_repo_from_path(parts.path)
}

/// Resolve an SSH host alias to its real HostName via `ssh -G`, cached per alias.
fn resolve_ssh_hostname(alias: &str) -> Option<String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    // Only plain host names — never let a remote URL inject ssh options.
    let is_safe = !alias.is_empty()
        && !alias.starts_with('-')
        && alias
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !is_safe {
        return None;
    }

    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(hit) = cache.lock().ok().and_then(|c| c.get(alias).cloned()) {
        return hit;
    }

    let resolved = std::process::Command::new("ssh")
        .args(["-G", alias])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout).lines().find_map(|line| {
                let (key, value) = line.split_once(' ')?;
                key.eq_ignore_ascii_case("hostname")
                    .then(|| value.trim().to_string())
            })
        });

    if let Ok(mut c) = cache.lock() {
        c.insert(alias.to_string(), resolved.clone());
    }
    resolved
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

    fn pair(owner: &str, repo: &str) -> Option<(String, String)> {
        Some((owner.to_string(), repo.to_string()))
    }

    fn no_alias(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn parses_github_urls() {
        let cases = [
            "https://github.com/owner/repo.git",
            "https://github.com/owner/repo",
            "https://github.com/owner/repo/",
            "http://github.com/owner/repo.git",
            "https://user@github.com/owner/repo.git",
            "https://x-access-token:abc@github.com/owner/repo",
            "git@github.com:owner/repo",
            "git@github.com:owner/repo.git",
            "ssh://git@github.com/owner/repo.git",
            "ssh://git@github.com:22/owner/repo",
            "git://github.com/owner/repo.git",
        ];
        for url in cases {
            assert_eq!(parse_github_url_with(url, no_alias), pair("owner", "repo"), "{url}");
        }
    }

    #[test]
    fn keeps_dots_in_repo_names() {
        assert_eq!(
            parse_github_url_with("https://github.com/vercel/next.js.git", no_alias),
            pair("vercel", "next.js")
        );
        assert_eq!(
            parse_github_url_with("git@github.com:user/user.github.io", no_alias),
            pair("user", "user.github.io")
        );
    }

    #[test]
    fn resolves_ssh_host_aliases() {
        let resolver = |alias: &str| (alias == "github-work").then(|| "github.com".to_string());
        assert_eq!(
            parse_github_url_with("git@github-work:org/repo.git", resolver),
            pair("org", "repo")
        );
        assert_eq!(
            parse_github_url_with("ssh://git@github-work/org/repo", resolver),
            pair("org", "repo")
        );
        // Aliases only apply to SSH URLs, and other hosts stay non-GitHub.
        assert_eq!(parse_github_url_with("https://github-work/org/repo", resolver), None);
        assert_eq!(parse_github_url_with("git@gitlab.com:org/repo", resolver), None);
    }

    #[test]
    fn rejects_non_github_urls() {
        assert_eq!(parse_github_url_with("https://example.com/x/y", no_alias), None);
        assert_eq!(parse_github_url_with("https://github.com.evil.com/x/y", no_alias), None);
        assert_eq!(parse_github_url_with("https://evil.com/github.com/x/y", no_alias), None);
        assert_eq!(parse_github_url_with("https://github.com/owner", no_alias), None);
        assert_eq!(parse_github_url_with("https://github.com/o/r/extra", no_alias), None);
        assert_eq!(parse_github_url_with("/local/path/repo", no_alias), None);
    }

    #[test]
    fn detects_github_com_hosts() {
        assert!(is_github_com_url("https://github.com/o/r.git"));
        assert!(is_github_com_url("https://user@GitHub.com/o/r"));
        assert!(is_github_com_url("git@github.com:o/r"));
        assert!(!is_github_com_url("https://gitlab.com/o/r.git"));
        assert!(!is_github_com_url("https://github.example.com/o/r.git"));
        assert!(!is_github_com_url("https://github.com.evil.com/o/r"));
    }

    #[test]
    fn ssh_alias_lookup_rejects_option_like_hosts() {
        assert_eq!(resolve_ssh_hostname("-oProxyCommand=touch"), None);
        assert_eq!(resolve_ssh_hostname("host name"), None);
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
