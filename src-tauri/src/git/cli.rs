use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::error::AppError;
use crate::git::engine::GitRemoteEngine;
use crate::git::remote::authenticated_url;

pub struct GitCliEngine {
    pub repo_path: PathBuf,
}

impl GitCliEngine {
    pub fn new(repo_path: &Path) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
        }
    }
}

impl GitRemoteEngine for GitCliEngine {
    async fn clone_repo(&self, url: &str, path: &Path, token: &str) -> Result<(), AppError> {
        let auth_url = authenticated_url(url, token);
        let path_str = path.to_string_lossy().into_owned();

        let output = Command::new("git")
            .args(["clone", "--", &auth_url, &path_str])
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)?;

        check_output(output)
    }

    async fn fetch(&self, remote: &str, token: &str) -> Result<(), AppError> {
        let remote_url = get_remote_url(&self.repo_path, remote).await?;
        let auth_url = authenticated_url(&remote_url, token);

        // Fetch using the authenticated URL directly so no stored credentials are needed.
        let output = Command::new("git")
            .args(["fetch", "--prune", "--", &auth_url])
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)?;

        check_output(output)
    }

    async fn push(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        force: bool,
    ) -> Result<(), AppError> {
        let remote_url = get_remote_url(&self.repo_path, remote).await?;
        let auth_url = authenticated_url(&remote_url, token);
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

        let mut args: Vec<String> = vec![
            "push".to_string(),
            "--".to_string(),
            auth_url,
            refspec,
        ];
        if force {
            args.push("--force".to_string());
        }

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)?;

        check_output(output)
    }

    async fn pull(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        rebase: bool,
    ) -> Result<(), AppError> {
        let remote_url = get_remote_url(&self.repo_path, remote).await?;
        let auth_url = authenticated_url(&remote_url, token);
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

        let mut args: Vec<String> = vec![
            "pull".to_string(),
            "--".to_string(),
            auth_url,
            refspec,
        ];
        if rebase {
            args.push("--rebase".to_string());
        }

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(map_io_err)?;

        check_output(output)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/// Resolve the URL of a named remote via `git remote get-url`.
async fn get_remote_url(repo_path: &Path, remote: &str) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(["remote", "get-url", remote])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(map_io_err)?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(AppError::GitCli {
            message: format!("Remote '{}' not found", remote),
            exit_code: output.status.code(),
        })
    }
}

/// Map an IO error from spawning git, detecting "not found" specially.
fn map_io_err(e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::GitCliNotFound
    } else {
        AppError::Io(e)
    }
}

/// Check command output and convert non-zero exit to `AppError::GitCli`.
fn check_output(output: std::process::Output) -> Result<(), AppError> {
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        Err(AppError::GitCli {
            message: parse_git_error(&stderr),
            exit_code: output.status.code(),
        })
    }
}

/// Strip "error: " / "fatal: " prefixes from git stderr output.
fn parse_git_error(stderr: &str) -> String {
    for line in stderr.lines() {
        let trimmed = line.trim();
        if let Some(msg) = trimmed.strip_prefix("error: ") {
            return msg.to_string();
        }
        if let Some(msg) = trimmed.strip_prefix("fatal: ") {
            return msg.to_string();
        }
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    stderr.trim().to_string()
}
