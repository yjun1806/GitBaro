//! Activity watcher: tracks *when* files last changed across many
//! repositories and worktrees at once, for the sidebar's "지금 바뀌는 곳"
//! section, live-changed-line highlighting, and the workspace review screen.
//!
//! This is a separate watcher from `commands::watch::WatcherState`, which
//! watches exactly one active repository and drives its status refresh
//! (`fs:change` / `fs:git-dir-change`). That one keeps doing its job
//! unchanged; this one only ever emits a timestamp, for up to
//! [`MAX_ACTIVITY_TARGETS`] paths at a time.

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::error::AppError;

/// Hard cap on how many paths the OS-level watcher tracks at once. Paths
/// beyond this fall back to the frontend's 20s `dirtyLatestMtime` poll.
pub const MAX_ACTIVITY_TARGETS: usize = 40;

/// How long a path's activity is coalesced into a single `repo:activity`
/// event. A path that keeps changing still gets one emission per window
/// (never silently dropped), just delayed to the window's end.
const ACTIVITY_WINDOW: Duration = Duration::from_secs(2);

/// Result of resolving a requested watch-path list against the cap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTargets {
    /// Deduplicated, in the caller's priority order, capped at
    /// [`MAX_ACTIVITY_TARGETS`].
    pub watched: Vec<PathBuf>,
    /// The tail that did not fit under the cap.
    pub overflow: Vec<PathBuf>,
}

/// Dedupes `requested` (keeping first occurrence) and splits it at the cap.
/// Pure and does not touch the filesystem — callers canonicalize paths
/// beforehand so nesting/dedup compare correctly.
pub fn resolve_targets(requested: &[PathBuf]) -> ResolvedTargets {
    let mut seen = HashSet::new();
    let mut all = Vec::with_capacity(requested.len());
    for path in requested {
        if seen.insert(path.clone()) {
            all.push(path.clone());
        }
    }
    if all.len() <= MAX_ACTIVITY_TARGETS {
        ResolvedTargets { watched: all, overflow: Vec::new() }
    } else {
        let overflow = all.split_off(MAX_ACTIVITY_TARGETS);
        ResolvedTargets { watched: all, overflow }
    }
}

/// What changed between the currently watched set and a newly resolved one.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TargetDiff {
    pub added: Vec<PathBuf>,
    pub removed: Vec<PathBuf>,
}

/// Diffs two watch-path lists (order-independent).
pub fn diff_targets(old: &[PathBuf], new: &[PathBuf]) -> TargetDiff {
    let old_set: HashSet<&PathBuf> = old.iter().collect();
    let new_set: HashSet<&PathBuf> = new.iter().collect();
    TargetDiff {
        added: new.iter().filter(|p| !old_set.contains(p)).cloned().collect(),
        removed: old.iter().filter(|p| !new_set.contains(p)).cloned().collect(),
    }
}

/// Attributes a changed path to the watched root it belongs to, or `None`
/// when it should not count as activity.
///
/// - `.git/` internals never count (staging, status refresh, and GitBaro's own
///   other watcher already cover that; this one is about working-tree edits).
/// - When a watched root sits inside another watched root (a worktree folder
///   under its parent repository, `.gitignore:23`/`:39` — `.claude/worktrees/x`,
///   `.worktrees/x`), the change is attributed to the deepest (most specific)
///   containing root only, so it is never double-counted.
pub fn classify_activity(path: &Path, watched: &[PathBuf]) -> Option<PathBuf> {
    if path.components().any(|c| c.as_os_str() == ".git") {
        return None;
    }
    watched
        .iter()
        .filter(|root| path.starts_with(root.as_path()))
        .max_by_key(|root| root.as_os_str().len())
        .cloned()
}

/// Coalesces repeated activity on the same root into one emission per
/// [`ACTIVITY_WINDOW`]. The first change after a quiet period emits
/// immediately (fast feedback); further changes during the window are
/// recorded and flushed once, after the window elapses.
pub struct ActivityThrottle {
    window: Duration,
    last_emit: HashMap<PathBuf, Instant>,
    pending: HashMap<PathBuf, Instant>,
}

impl ActivityThrottle {
    pub fn new(window: Duration) -> Self {
        Self { window, last_emit: HashMap::new(), pending: HashMap::new() }
    }

    /// Records that `root` changed at `now`. Returns `true` when it should be
    /// emitted right away.
    pub fn record(&mut self, root: PathBuf, now: Instant) -> bool {
        let quiet = match self.last_emit.get(&root) {
            Some(&last) => now.duration_since(last) >= self.window,
            None => true,
        };
        if quiet {
            self.last_emit.insert(root.clone(), now);
            self.pending.remove(&root);
            true
        } else {
            self.pending.insert(root, now);
            false
        }
    }

    /// Roots whose pending change is now due (their window since the last
    /// emission has elapsed). Marks them emitted as of `now`.
    pub fn due(&mut self, now: Instant) -> Vec<PathBuf> {
        let ready: Vec<PathBuf> = self
            .pending
            .keys()
            .filter(|root| {
                let last = self.last_emit.get(*root).copied().unwrap_or(now);
                now.duration_since(last) >= self.window
            })
            .cloned()
            .collect();
        for root in &ready {
            self.pending.remove(root);
            self.last_emit.insert(root.clone(), now);
        }
        ready
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Resolve symlinks. A path that does not exist yet keeps its file name under
/// the resolved parent, matching what FSEvents reports (e.g. `/private/var/...`
/// rather than `/var/...`). Mirrors `watcher::fs_events::canonical`.
pub(crate) fn canonicalize_best_effort(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| {
        match (path.parent(), path.file_name()) {
            (Some(parent), Some(name)) => std::fs::canonicalize(parent)
                .map(|p| p.join(name))
                .unwrap_or_else(|_| path.to_path_buf()),
            _ => path.to_path_buf(),
        }
    })
}

/// Watches a dynamic set of directories (up to [`MAX_ACTIVITY_TARGETS`]) and
/// calls `callback(root, at_epoch_ms)` at most once per [`ACTIVITY_WINDOW`]
/// per root when something inside it changes.
pub struct ActivityWatcher {
    watcher: Mutex<RecommendedWatcher>,
    watched: Arc<Mutex<Vec<PathBuf>>>,
}

impl ActivityWatcher {
    pub fn new<F>(callback: F) -> Result<Self, AppError>
    where
        F: Fn(PathBuf, i64) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

        let watched: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
        let watched_for_thread = watched.clone();

        std::thread::spawn(move || {
            let mut throttle = ActivityThrottle::new(ACTIVITY_WINDOW);
            loop {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(Ok(event)) => {
                        let now = Instant::now();
                        let targets = watched_for_thread.lock().unwrap().clone();
                        for path in &event.paths {
                            if let Some(root) = classify_activity(path, &targets) {
                                if throttle.record(root.clone(), now) {
                                    callback(root, now_ms());
                                }
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        tracing::error!("Activity watcher error: {}", e);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    // Channel closed — the watcher was dropped, exit the thread.
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }

                for root in throttle.due(Instant::now()) {
                    callback(root, now_ms());
                }
            }
        });

        Ok(Self { watcher: Mutex::new(watcher), watched })
    }

    /// Applies a new requested target list: canonicalizes, dedupes, caps at
    /// [`MAX_ACTIVITY_TARGETS`], and updates the OS-level watches to match.
    pub fn set_targets(&self, requested: &[PathBuf]) -> ResolvedTargets {
        let canonical: Vec<PathBuf> = requested.iter().map(|p| canonicalize_best_effort(p)).collect();
        let resolved = resolve_targets(&canonical);

        let mut watched = self.watched.lock().unwrap();
        let diff = diff_targets(&watched, &resolved.watched);
        {
            let mut w = self.watcher.lock().unwrap();
            for path in &diff.removed {
                let _ = w.unwatch(path);
            }
            for path in &diff.added {
                let _ = w.watch(path, RecursiveMode::Recursive);
            }
        }
        *watched = resolved.watched.clone();
        resolved
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn resolve_targets_dedupes_and_keeps_order() {
        let resolved = resolve_targets(&[p("/a"), p("/b"), p("/a")]);
        assert_eq!(resolved.watched, vec![p("/a"), p("/b")]);
        assert!(resolved.overflow.is_empty());
    }

    #[test]
    fn resolve_targets_caps_at_the_limit_and_reports_overflow() {
        let requested: Vec<PathBuf> = (0..45).map(|i| p(&format!("/repo{i}"))).collect();
        let resolved = resolve_targets(&requested);
        assert_eq!(resolved.watched.len(), MAX_ACTIVITY_TARGETS);
        assert_eq!(resolved.overflow.len(), 5);
        assert_eq!(resolved.watched, requested[..40]);
        assert_eq!(resolved.overflow, requested[40..]);
    }

    #[test]
    fn diff_targets_finds_added_and_removed() {
        let old = vec![p("/a"), p("/b")];
        let new = vec![p("/b"), p("/c")];
        let diff = diff_targets(&old, &new);
        assert_eq!(diff.added, vec![p("/c")]);
        assert_eq!(diff.removed, vec![p("/a")]);
    }

    #[test]
    fn diff_targets_is_empty_when_unchanged() {
        let paths = vec![p("/a"), p("/b")];
        let diff = diff_targets(&paths, &paths);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
    }

    #[test]
    fn classify_ignores_git_internals() {
        let watched = vec![p("/repo")];
        assert_eq!(classify_activity(Path::new("/repo/.git/index"), &watched), None);
        assert_eq!(classify_activity(Path::new("/repo/.git/refs/heads/main"), &watched), None);
    }

    #[test]
    fn classify_attributes_to_the_deepest_containing_root() {
        // A linked worktree living inside its parent repo's working tree
        // (`.gitignore:23`/`:39`): a change under it must count for the
        // worktree only, not for the parent repo too.
        let watched = vec![p("/repo"), p("/repo/.worktrees/feature")];
        assert_eq!(
            classify_activity(Path::new("/repo/.worktrees/feature/src/lib.rs"), &watched),
            Some(p("/repo/.worktrees/feature"))
        );
        assert_eq!(
            classify_activity(Path::new("/repo/src/main.rs"), &watched),
            Some(p("/repo"))
        );
    }

    #[test]
    fn classify_returns_none_outside_every_watched_root() {
        let watched = vec![p("/repo")];
        assert_eq!(classify_activity(Path::new("/other/file.txt"), &watched), None);
    }

    #[test]
    fn throttle_emits_the_first_change_immediately() {
        let mut throttle = ActivityThrottle::new(Duration::from_secs(2));
        let t0 = Instant::now();
        assert!(throttle.record(p("/repo"), t0));
    }

    #[test]
    fn throttle_coalesces_repeated_changes_within_the_window() {
        let mut throttle = ActivityThrottle::new(Duration::from_secs(2));
        let t0 = Instant::now();
        assert!(throttle.record(p("/repo"), t0));
        assert!(!throttle.record(p("/repo"), t0 + Duration::from_millis(500)));
        assert!(!throttle.record(p("/repo"), t0 + Duration::from_millis(1000)));
        // Not due yet — window since the last emission (t0) has not elapsed.
        assert!(throttle.due(t0 + Duration::from_millis(1500)).is_empty());
    }

    #[test]
    fn throttle_flushes_the_pending_change_once_the_window_elapses() {
        let mut throttle = ActivityThrottle::new(Duration::from_secs(2));
        let t0 = Instant::now();
        throttle.record(p("/repo"), t0);
        throttle.record(p("/repo"), t0 + Duration::from_millis(1000));
        let ready = throttle.due(t0 + Duration::from_millis(2100));
        assert_eq!(ready, vec![p("/repo")]);
        // A change right after the flush starts a fresh window.
        assert!(!throttle.record(p("/repo"), t0 + Duration::from_millis(2200)));
    }

    #[test]
    fn throttle_tracks_each_root_independently() {
        let mut throttle = ActivityThrottle::new(Duration::from_secs(2));
        let t0 = Instant::now();
        assert!(throttle.record(p("/a"), t0));
        assert!(throttle.record(p("/b"), t0));
        assert!(!throttle.record(p("/a"), t0 + Duration::from_millis(100)));
        assert!(!throttle.record(p("/b"), t0 + Duration::from_millis(100)));
    }
}
