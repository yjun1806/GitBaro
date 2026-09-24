//! Give the app the user's shell `PATH`.
//!
//! A macOS app launched from Finder or the Dock inherits launchd's minimal
//! `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`). Git hooks that run node
//! (husky, lint-staged), git-lfs, a Homebrew git and other CLI tools are then
//! not found. This asks the user's login shell for its `PATH` once at startup,
//! the way a terminal would see it, and merges it into the process
//! environment so every child process (git, gh, hooks) inherits it.
//!
//! An interactive login shell can take seconds to start, so the result is
//! cached: later launches use the cached value at once and refresh the cache
//! in the background for the next launch.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// A slow shell config must not hold up startup.
const SHELL_TIMEOUT: Duration = Duration::from_secs(3);

/// Common install locations added even when the shell cannot be queried.
const FALLBACK_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/sbin"];

/// Brackets the value so banners printed by shell rc files are ignored.
const MARKER: &str = "__GITBARO_PATH__";

const CACHE_FILE: &str = "shell-path.txt";

/// Merge the login shell's `PATH` into this process's `PATH`. Must run before
/// any other thread starts (it mutates the process environment).
pub fn apply_login_shell_path() {
    let cache = crate::state::app_state::get_state_dir().join(CACHE_FILE);
    let cached = std::fs::read_to_string(&cache)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let shell_path = match cached {
        Some(path) => {
            // Refresh for the next launch without delaying this one. The
            // thread only spawns a process and writes a file; it never touches
            // this process's environment.
            std::thread::spawn(move || refresh_cache(&cache));
            Some(path)
        }
        None => {
            let path = login_shell_path();
            if let Some(ref p) = path {
                write_cache(&cache, p);
            }
            path
        }
    };

    if shell_path.is_none() {
        tracing::warn!("Could not read PATH from the login shell; using fallback directories");
    }
    let current = std::env::var("PATH").unwrap_or_default();
    let merged = merge_path(shell_path.as_deref(), &current, &FALLBACK_DIRS);
    tracing::info!("PATH set to {}", merged);
    std::env::set_var("PATH", merged);
}

fn refresh_cache(cache: &std::path::Path) {
    if let Some(path) = login_shell_path() {
        write_cache(cache, &path);
    }
}

fn write_cache(cache: &std::path::Path, path: &str) {
    if let Err(e) = std::fs::write(cache, path) {
        tracing::warn!("Could not cache the login shell PATH: {}", e);
    }
}

fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| s.starts_with('/'))
        .unwrap_or_else(|| "/bin/zsh".to_string());
    run_with_timeout(&shell, SHELL_TIMEOUT).and_then(|out| extract_marked(&out))
}

/// Run `shell -ilc 'printf ...'` and return its stdout, or `None` if it fails
/// or does not finish within `timeout` (the shell is then killed).
fn run_with_timeout(shell: &str, timeout: Duration) -> Option<String> {
    let script = format!("printf '{m}%s{m}' \"$PATH\"", m = MARKER);
    let mut child = Command::new(shell)
        .args(["-ilc", &script])
        // Keep oh-my-zsh and similar from prompting for updates.
        .env("DISABLE_AUTO_UPDATE", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    // Read on another thread so a shell that never exits cannot block us; the
    // thread ends when the pipe closes (after the kill below at the latest).
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(out) => {
            let _ = child.wait();
            Some(out)
        }
        Err(_) => {
            tracing::warn!("Login shell {} did not report PATH within {:?}", shell, timeout);
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

fn extract_marked(output: &str) -> Option<String> {
    let start = output.find(MARKER)? + MARKER.len();
    let len = output[start..].find(MARKER)?;
    let value = output[start..start + len].trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// Shell entries first (they reflect the user's intended order), then any
/// existing entries the shell did not have, then fallback dirs; duplicates and
/// empty entries dropped.
fn merge_path(shell: Option<&str>, current: &str, fallback: &[&str]) -> String {
    let mut seen: Vec<&str> = Vec::new();
    let entries = shell
        .into_iter()
        .flat_map(|p| p.split(':'))
        .chain(current.split(':'))
        .chain(fallback.iter().copied());
    for entry in entries {
        if !entry.is_empty() && !seen.contains(&entry) {
            seen.push(entry);
        }
    }
    seen.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_entries_come_first_and_existing_ones_are_kept() {
        let merged = merge_path(
            Some("/Users/me/.volta/bin:/opt/homebrew/bin:/usr/bin:/bin"),
            "/usr/bin:/bin:/usr/sbin:/sbin",
            &FALLBACK_DIRS,
        );
        assert_eq!(
            merged,
            "/Users/me/.volta/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/sbin"
        );
    }

    #[test]
    fn without_a_shell_path_the_fallback_dirs_are_added() {
        let merged = merge_path(None, "/usr/bin:/bin", &FALLBACK_DIRS);
        assert_eq!(
            merged,
            "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin"
        );
    }

    #[test]
    fn empty_entries_are_dropped() {
        assert_eq!(merge_path(Some("::/a:"), "", &[]), "/a");
    }

    #[test]
    fn rc_file_noise_around_the_value_is_ignored() {
        let out = format!("Welcome!\nlast login...{m}/a:/b{m}bye", m = MARKER);
        assert_eq!(extract_marked(&out).as_deref(), Some("/a:/b"));
        assert_eq!(extract_marked("no markers here"), None);
        assert_eq!(extract_marked(&format!("{m}{m}", m = MARKER)), None);
    }

    #[test]
    fn a_shell_that_hangs_times_out() {
        let dir = std::env::temp_dir().join(format!("gitbaro-shell-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("slow-shell");
        std::fs::write(&fake, "#!/bin/sh\nsleep 30\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let started = std::time::Instant::now();
        let out = run_with_timeout(fake.to_str().unwrap(), Duration::from_millis(300));
        assert_eq!(out, None);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn reads_path_from_a_real_shell() {
        let out = run_with_timeout("/bin/sh", Duration::from_secs(5));
        assert!(out.and_then(|o| extract_marked(&o)).is_some());
    }
}
