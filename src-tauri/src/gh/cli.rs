use std::path::{Path, PathBuf};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::AppError;

/// Known locations where `gh` may be installed on macOS GUI apps
/// (which may not inherit the user's shell PATH).
const GH_SEARCH_PATHS: &[&str] = &[
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/usr/bin/gh",
    "/run/current-system/sw/bin/gh",
];

const MIN_GH_MAJOR: u32 = 2;
const MIN_GH_MINOR: u32 = 40;

// ─── Types ───

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhAccount {
    pub username: String,
    pub active: bool,
}

pub struct GhLoginResult {
    pub username: String,
}

// ─── Binary Discovery ───

/// Find the `gh` binary by searching PATH and well-known install locations.
pub fn find_gh_binary() -> Result<PathBuf, AppError> {
    // 1. Try PATH via `which`
    if let Ok(output) = std::process::Command::new("which").arg("gh").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    // 2. Direct path search (macOS GUI apps often miss PATH entries)
    for candidate in GH_SEARCH_PATHS {
        let p = Path::new(candidate);
        if p.exists() {
            return Ok(p.to_path_buf());
        }
    }

    Err(AppError::GhCliNotFound)
}

/// Verify gh is installed and meets the minimum version requirement.
/// Returns the version string (e.g. "2.62.0") on success.
pub async fn check_gh_version() -> Result<String, AppError> {
    let gh = find_gh_binary()?;

    let output = tokio::process::Command::new(&gh)
        .arg("--version")
        .output()
        .await
        .map_err(|_| AppError::GhCliNotFound)?;

    if !output.status.success() {
        return Err(AppError::GhCliNotFound);
    }

    // "gh version 2.62.0 (2024-12-04)\n..."
    let version_line = String::from_utf8_lossy(&output.stdout);
    let version = version_line
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .nth(2)
        .unwrap_or("")
        .to_string();

    let parts: Vec<u32> = version.split('.').filter_map(|s| s.parse().ok()).collect();
    if parts.len() >= 2
        && (parts[0] < MIN_GH_MAJOR
            || (parts[0] == MIN_GH_MAJOR && parts[1] < MIN_GH_MINOR))
    {
        return Err(AppError::GhVersionTooOld(format!(
            "gh >= {}.{} required, found {}",
            MIN_GH_MAJOR, MIN_GH_MINOR, version
        )));
    }

    Ok(version)
}

// ─── Auth Status ───

/// List all logged-in GitHub accounts by parsing `gh auth status`.
pub async fn gh_auth_status() -> Result<Vec<GhAccount>, AppError> {
    let gh = find_gh_binary()?;

    let output = tokio::process::Command::new(&gh)
        .args(["auth", "status"])
        .output()
        .await
        .map_err(|e| AppError::GhCli(e.to_string()))?;

    // gh >= 2.80 writes to stdout; older versions write to stderr.
    // Parse whichever stream has the account info.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let mut accounts = parse_auth_status(&stdout);
    if accounts.is_empty() {
        accounts = parse_auth_status(&stderr);
    }

    Ok(accounts)
}

fn parse_auth_status(text: &str) -> Vec<GhAccount> {
    let mut accounts = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();

        // "✓ Logged in to github.com account USERNAME (source)"
        if let Some(username) = extract_logged_in_account(trimmed) {
            accounts.push(GhAccount {
                username,
                active: false,
            });
        }

        // "- Active account: true"
        if trimmed.contains("Active account: true") {
            if let Some(last) = accounts.last_mut() {
                last.active = true;
            }
        }
    }

    accounts
}

fn extract_logged_in_account(line: &str) -> Option<String> {
    let needle = "Logged in to github.com account ";
    let pos = line.find(needle)?;
    let after = &line[pos + needle.len()..];
    let username = if let Some(paren) = after.rfind('(') {
        after[..paren].trim()
    } else {
        after.trim()
    };

    if username.is_empty() {
        None
    } else {
        Some(username.to_string())
    }
}

// ─── Token ───

/// Get the OAuth token for a specific account via `gh auth token --user`.
pub async fn gh_auth_token(username: &str) -> Result<String, AppError> {
    let gh = find_gh_binary()?;

    let output = tokio::process::Command::new(&gh)
        .args(["auth", "token", "--user", username])
        .output()
        .await
        .map_err(|e| AppError::GhCli(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::GhCli(format!(
            "Failed to get token for {}: {}",
            username,
            stderr.trim()
        )));
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err(AppError::GhCli(format!(
            "Empty token returned for {}",
            username
        )));
    }

    Ok(token)
}

// ─── Login ───

/// Run `gh auth login --web` as a child process.
///
/// `on_device_code` is called once with `(user_code, verification_uri)` when
/// the one-time code is available. The caller should display this to the user.
///
/// Returns the logged-in username on success.
pub async fn run_gh_login(
    on_device_code: impl FnOnce(String, String) + Send,
) -> Result<GhLoginResult, AppError> {
    let gh = find_gh_binary()?;

    let mut child = tokio::process::Command::new(&gh)
        .args([
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--web",
            "--scopes",
            "repo,user:email,read:org",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::GhCli(format!("Failed to start gh: {}", e)))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::GhCli("Cannot capture stdout".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::GhCli("Cannot capture stderr".into()))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::GhCli("Cannot access stdin".into()))?;

    let mut stdout_buf = vec![0u8; 4096];
    let mut stderr_buf = vec![0u8; 4096];
    let mut accumulated = String::new();
    let mut on_device_code = Some(on_device_code);
    let mut username = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(300);

    let mut stdout_done = false;
    let mut stderr_done = false;

    // Read both stdout and stderr — gh may write to either depending on version.
    while !stdout_done || !stderr_done {
        tokio::select! {
            result = stdout.read(&mut stdout_buf), if !stdout_done => {
                match result {
                    Ok(0) | Err(_) => stdout_done = true,
                    Ok(n) => accumulated.push_str(&String::from_utf8_lossy(&stdout_buf[..n])),
                }
            }
            result = stderr.read(&mut stderr_buf), if !stderr_done => {
                match result {
                    Ok(0) | Err(_) => stderr_done = true,
                    Ok(n) => accumulated.push_str(&String::from_utf8_lossy(&stderr_buf[..n])),
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                return Err(AppError::GhCli("gh auth login timed out (5 min)".into()));
            }
        }

        // Detect device code: "one-time code: XXXX-XXXX"
        if on_device_code.is_some() {
            if let Some(code) = extract_device_code(&accumulated) {
                if let Some(cb) = on_device_code.take() {
                    cb(code, "https://github.com/login/device".to_string());
                }
                // Send Enter to stdin so gh opens the browser
                let _ = stdin.write_all(b"\n").await;
                let _ = stdin.flush().await;
            }
        }

        // Detect success: "Logged in as USERNAME"
        if let Some(name) = extract_logged_in_username(&accumulated) {
            username = name;
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::GhCli(e.to_string()))?;

    if !status.success() && username.is_empty() {
        return Err(AppError::GhCli("gh auth login failed".into()));
    }

    // Fallback: read username from gh auth status
    if username.is_empty() {
        let accounts = gh_auth_status().await?;
        username = accounts
            .iter()
            .find(|a| a.active)
            .or(accounts.first())
            .map(|a| a.username.clone())
            .unwrap_or_default();
    }

    if username.is_empty() {
        return Err(AppError::GhCli(
            "Login completed but could not determine username".into(),
        ));
    }

    Ok(GhLoginResult { username })
}

fn extract_device_code(text: &str) -> Option<String> {
    let needle = "one-time code: ";
    let pos = text.find(needle)?;
    let after = &text[pos + needle.len()..];
    let code: String = after
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '-')
        .collect();

    if code.is_empty() {
        None
    } else {
        Some(code)
    }
}

fn extract_logged_in_username(text: &str) -> Option<String> {
    let needle = "Logged in as ";
    let pos = text.rfind(needle)?;
    let after = &text[pos + needle.len()..];
    let name: String = after.chars().take_while(|c| !c.is_whitespace()).collect();

    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

// ─── Logout ───

/// Remove an account via `gh auth logout --user USERNAME`.
pub async fn gh_auth_logout(username: &str) -> Result<(), AppError> {
    let gh = find_gh_binary()?;

    let output = tokio::process::Command::new(&gh)
        .args([
            "auth",
            "logout",
            "--hostname",
            "github.com",
            "--user",
            username,
        ])
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| AppError::GhCli(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("not logged in") {
            return Err(AppError::GhCli(format!(
                "Failed to logout {}: {}",
                username,
                stderr.trim()
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_device_code() {
        let text = "! First copy your one-time code: AB12-CD34\nPress Enter to open...";
        assert_eq!(extract_device_code(text), Some("AB12-CD34".to_string()));
    }

    #[test]
    fn parse_device_code_missing() {
        assert_eq!(extract_device_code("no code here"), None);
    }

    #[test]
    fn parse_logged_in_username() {
        let text = "✓ Authentication complete.\n✓ Logged in as octocat\n";
        assert_eq!(
            extract_logged_in_username(text),
            Some("octocat".to_string())
        );
    }

    #[test]
    fn parse_auth_status_single() {
        let text = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n    - Active account: true\n";
        let accounts = parse_auth_status(text);
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].username, "octocat");
        assert!(accounts[0].active);
    }

    #[test]
    fn parse_auth_status_multiple() {
        let text = "github.com\n  ✓ Logged in to github.com account user1 (keyring)\n    - Active account: true\n  ✓ Logged in to github.com account user2 (keyring)\n    - Active account: false\n";
        let accounts = parse_auth_status(text);
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].username, "user1");
        assert!(accounts[0].active);
        assert_eq!(accounts[1].username, "user2");
        assert!(!accounts[1].active);
    }
}
