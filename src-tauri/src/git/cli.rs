use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::error::AppError;
use crate::git::engine::GitRemoteEngine;

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
        let askpass = AskpassScript::create(token).await?;
        let path_str = path.to_string_lossy().into_owned();
        let args = ["-c", "credential.helper=", "clone", "--", url, &path_str];

        tracing::info!("[git] git {}", args.join(" "));

        let output = Command::new("git")
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }

    async fn fetch(&self, remote: &str, token: &str) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;
        let args = ["-c", "credential.helper=", "fetch", "--prune", remote];

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }

    async fn push(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        force: bool,
    ) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

        let mut args = vec!["-c", "credential.helper=", "push"];
        if force {
            args.push("--force");
        }
        args.push(remote);
        args.push(&refspec);

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }

    async fn pull(
        &self,
        remote: &str,
        branch: &str,
        token: &str,
        rebase: bool,
    ) -> Result<(), AppError> {
        let askpass = AskpassScript::create(token).await?;

        let mut args = vec!["-c", "credential.helper=", "pull"];
        if rebase {
            args.push("--rebase");
        }
        args.push(remote);
        args.push(branch);

        tracing::info!("[git] git {} (cwd: {})", args.join(" "), self.repo_path.display());

        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", askpass.path())
            .output()
            .await
            .map_err(map_io_err)?;

        log_output(&output);
        check_output(output)
    }
}

// ── GIT_ASKPASS helper ────────────────────────────────────────────────────────

/// Temporary GIT_ASKPASS script that provides OAuth credentials.
///
/// Modeled after GitHub Desktop's credential approach:
/// - Uses remote name (not URL) so git updates tracking refs automatically.
/// - Clears existing credential helpers (`-c credential.helper=`) to prevent
///   interference, then GIT_ASKPASS provides the token.
/// - Token never appears in process arguments (unlike URL embedding).
/// - Script is cleaned up on drop.
struct AskpassScript {
    path: PathBuf,
}

impl AskpassScript {
    async fn create(token: &str) -> Result<Self, AppError> {
        let path = std::env::temp_dir().join(format!(
            "gitbaro-askpass-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));

        // Git calls GIT_ASKPASS with a prompt like "Username for ..." or "Password for ...".
        let script = format!(
            "#!/bin/sh\ncase \"$1\" in\n*sername*) echo 'x-access-token' ;;\n*assword*) echo '{}' ;;\nesac",
            token
        );

        tokio::fs::write(&path, &script).await?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).await?;
        }

        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for AskpassScript {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/// Map an IO error from spawning git, detecting "not found" specially.
fn map_io_err(e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::GitCliNotFound
    } else {
        AppError::Io(e)
    }
}

/// Log stdout/stderr from a git command for debugging.
fn log_output(output: &std::process::Output) {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stdout.trim().is_empty() {
        tracing::info!("[git] stdout: {}", stdout.trim());
    }
    if !stderr.trim().is_empty() {
        if output.status.success() {
            tracing::info!("[git] stderr: {}", stderr.trim());
        } else {
            tracing::error!("[git] stderr: {}", stderr.trim());
        }
    }
    tracing::info!("[git] exit: {}", output.status);
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
