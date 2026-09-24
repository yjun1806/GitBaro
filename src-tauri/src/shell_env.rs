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
//! in the background for the next launch. When there is no cache yet and the
//! shell is too slow for startup, the background refresh still runs (with a
//! longer timeout) so the next launch has a cache.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

/// How long startup waits for the shell. A slow shell config must not hold up
/// the first window.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(3);

/// How long the background refresh waits. Nothing is blocked on it, so slow
/// shell configs (nvm, conda, oh-my-zsh) still get cached.
const BACKGROUND_TIMEOUT: Duration = Duration::from_secs(60);

/// How often the reader checks whether the shell has exited.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Common install locations added even when the shell cannot be queried.
const FALLBACK_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/sbin"];

/// Brackets the value so banners printed by shell rc files are ignored.
const MARKER: &str = "__GITBARO_PATH__";

const CACHE_FILE: &str = "shell-path.txt";

/// Merge the login shell's `PATH` into this process's `PATH`. Must run before
/// any other thread starts (it mutates the process environment).
pub fn apply_login_shell_path() {
    let cache = crate::state::app_state::get_state_dir().join(CACHE_FILE);
    let shell = login_shell();
    let original = std::env::var("PATH").unwrap_or_default();

    let startup = startup_shell_path(&cache, &shell, &original, STARTUP_TIMEOUT);
    if startup.path.is_none() {
        tracing::warn!("Could not read PATH from the login shell; using fallback directories");
    }
    let merged = merge_path(startup.path.as_deref(), &original, &FALLBACK_DIRS);
    tracing::info!("PATH set to {}", merged);
    std::env::set_var("PATH", merged);

    if startup.needs_refresh {
        // Refresh for the next launch without delaying this one. The thread
        // only spawns a process and writes a file, and it hands the shell the
        // original PATH explicitly, so the change above does not leak into
        // the cached value.
        std::thread::spawn(move || refresh_cache(&cache, &shell, &original, BACKGROUND_TIMEOUT));
    }
}

struct StartupPath {
    path: Option<String>,
    /// The cache is missing or may be stale; refresh it in the background.
    needs_refresh: bool,
}

/// Use the cached value when there is one; otherwise ask the shell, waiting at
/// most `timeout`.
fn startup_shell_path(cache: &Path, shell: &str, base_path: &str, timeout: Duration) -> StartupPath {
    let cached = std::fs::read_to_string(cache)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(path) = cached {
        return StartupPath { path: Some(path), needs_refresh: true };
    }

    match query_shell_path(shell, base_path, timeout) {
        Some(path) => {
            write_cache(cache, &path);
            StartupPath { path: Some(path), needs_refresh: false }
        }
        // Too slow (or failed) for startup — try again off the startup path so
        // the next launch does not wait again.
        None => StartupPath { path: None, needs_refresh: true },
    }
}

fn refresh_cache(cache: &Path, shell: &str, base_path: &str, timeout: Duration) {
    if let Some(path) = query_shell_path(shell, base_path, timeout) {
        write_cache(cache, &path);
    }
}

fn write_cache(cache: &Path, path: &str) {
    if let Err(e) = std::fs::write(cache, path) {
        tracing::warn!("Could not cache the login shell PATH: {}", e);
    }
}

fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| s.starts_with('/'))
        .unwrap_or_else(|| "/bin/zsh".to_string())
}

/// Run `shell -ilc 'printf ...'` and return the `PATH` it prints, or `None` if
/// it fails or does not report within `timeout` (the shell is then killed).
///
/// This does not wait for stdout to close: a process started in the
/// background by an rc file can inherit stdout and keep the pipe open long
/// after the shell exits. It returns as soon as the marked value has arrived,
/// or once the shell has exited and nothing more is buffered.
fn query_shell_path(shell: &str, base_path: &str, timeout: Duration) -> Option<String> {
    let script = format!("printf '{m}%s{m}' \"$PATH\"", m = MARKER);
    let mut child = Command::new(shell)
        .args(["-ilc", &script])
        .env("PATH", base_path)
        // Keep oh-my-zsh and similar from prompting for updates.
        .env("DISABLE_AUTO_UPDATE", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    // Read on another thread so a shell that never exits cannot block us. The
    // thread ends when the pipe closes or when this function has returned.
    std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(chunk[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let deadline = Instant::now() + timeout;
    let mut output = Vec::new();
    let mut shell_exited = false;
    let result = loop {
        if let Some(path) = extract_marked(&String::from_utf8_lossy(&output)) {
            break Some(path);
        }
        let now = Instant::now();
        if now >= deadline {
            tracing::warn!("Login shell {} did not report PATH within {:?}", shell, timeout);
            break None;
        }
        match rx.recv_timeout((deadline - now).min(POLL_INTERVAL)) {
            Ok(chunk) => output.extend_from_slice(&chunk),
            // stdout closed without the marker.
            Err(RecvTimeoutError::Disconnected) => break None,
            Err(RecvTimeoutError::Timeout) => {
                // What the shell wrote before exiting is already in the pipe,
                // so a quiet poll after it exited means nothing more is coming.
                if shell_exited {
                    break None;
                }
                shell_exited = matches!(child.try_wait(), Ok(Some(_)));
            }
        }
    };

    if !matches!(child.try_wait(), Ok(Some(_))) {
        let _ = child.kill();
    }
    let _ = child.wait();
    result
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

    /// A throwaway directory for one test.
    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("gitbaro-shell-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Write an executable `sh` script that stands in for the login shell.
    fn fake_shell(dir: &Path, body: &str) -> String {
        let fake = dir.join("fake-shell");
        std::fs::write(&fake, format!("#!/bin/sh\n{body}\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        fake.to_string_lossy().into_owned()
    }

    #[test]
    fn a_shell_that_hangs_times_out() {
        let dir = temp_dir("hang");
        let shell = fake_shell(&dir, "sleep 30");

        let started = Instant::now();
        let out = query_shell_path(&shell, "/usr/bin:/bin", Duration::from_millis(300));
        assert_eq!(out, None);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_background_process_holding_stdout_does_not_delay_the_answer() {
        let dir = temp_dir("background");
        let shell = fake_shell(
            &dir,
            &format!("printf '{m}/from/shell{m}'\n(sleep 30) &\nexit 0", m = MARKER),
        );

        let started = Instant::now();
        let out = query_shell_path(&shell, "/usr/bin:/bin", Duration::from_secs(10));
        assert_eq!(out.as_deref(), Some("/from/shell"));
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    }

    #[test]
    fn a_shell_that_exits_without_the_marker_fails_fast_despite_a_background_process() {
        let dir = temp_dir("no-marker");
        let shell = fake_shell(&dir, "echo hello\n(sleep 30) &\nexit 0");

        let started = Instant::now();
        let out = query_shell_path(&shell, "/usr/bin:/bin", Duration::from_secs(10));
        assert_eq!(out, None);
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    }

    #[test]
    fn reads_path_from_a_real_shell() {
        assert!(query_shell_path("/bin/sh", "/usr/bin:/bin", Duration::from_secs(5)).is_some());
    }

    #[test]
    fn a_fast_shell_is_used_and_cached_at_startup() {
        let dir = temp_dir("fast");
        let cache = dir.join(CACHE_FILE);
        let shell = fake_shell(&dir, &format!("printf '{m}/fast{m}'", m = MARKER));

        let startup = startup_shell_path(&cache, &shell, "/usr/bin", Duration::from_secs(5));
        assert_eq!(startup.path.as_deref(), Some("/fast"));
        assert!(!startup.needs_refresh);
        assert_eq!(std::fs::read_to_string(&cache).unwrap(), "/fast");
    }

    #[test]
    fn a_cached_value_is_used_without_running_the_shell() {
        let dir = temp_dir("cached");
        let cache = dir.join(CACHE_FILE);
        std::fs::write(&cache, "/cached\n").unwrap();

        let startup = startup_shell_path(&cache, "/nonexistent/shell", "/usr/bin", Duration::from_secs(5));
        assert_eq!(startup.path.as_deref(), Some("/cached"));
        assert!(startup.needs_refresh);
    }

    #[test]
    fn a_shell_too_slow_for_startup_is_still_cached_by_the_background_refresh() {
        let dir = temp_dir("slow");
        let cache = dir.join(CACHE_FILE);
        let shell = fake_shell(&dir, &format!("sleep 1\nprintf '{m}/slow{m}'", m = MARKER));

        let startup = startup_shell_path(&cache, &shell, "/usr/bin", Duration::from_millis(200));
        assert_eq!(startup.path, None);
        assert!(startup.needs_refresh);
        assert!(!cache.exists());

        refresh_cache(&cache, &shell, "/usr/bin", Duration::from_secs(10));
        assert_eq!(std::fs::read_to_string(&cache).unwrap(), "/slow");
    }

    #[test]
    fn the_shell_starts_from_the_given_path() {
        // /bin/sh keeps the PATH it was started with, so the value it reports
        // is the one we passed, not this test process's PATH.
        let path = query_shell_path("/bin/sh", "/only/this:/bin", Duration::from_secs(5));
        assert!(path.is_some_and(|p| p.contains("/only/this")));
    }
}
