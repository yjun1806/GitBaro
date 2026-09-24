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

/// Moves any path whose `notify::Watcher::watch` call failed from `watched`
/// into `overflow`. A path notify rejects (e.g. it does not exist because a
/// volume is unmounted, or it was deleted) never gets `repo:activity` events,
/// so it must fall back to polling like any other overflowed path — otherwise
/// it silently gets neither.
fn demote_failed_watches(mut resolved: ResolvedTargets, failed: &HashSet<PathBuf>) -> ResolvedTargets {
    if failed.is_empty() {
        return resolved;
    }
    let (still_watched, newly_failed): (Vec<PathBuf>, Vec<PathBuf>) =
        resolved.watched.into_iter().partition(|p| !failed.contains(p));
    resolved.watched = still_watched;
    resolved.overflow.extend(newly_failed);
    resolved
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
///
/// Internally, everything is tracked and matched against incoming FS events
/// in **canonical** form (notify/FSEvents reports canonical paths — see
/// [`canonicalize_best_effort`]). But callers register paths in whatever form
/// they have them (e.g. `/tmp/foo`, a symlink, a trailing slash), and the
/// existing single-repo watcher (`commands::watch`) echoes the caller's
/// original path in its events. To keep `repo:activity` consistent with that
/// and with what `set_activity_watch`'s caller registered, `watched`/
/// `overflow` and the emitted event path are always translated back to the
/// caller's original spelling before leaving this module.
pub struct ActivityWatcher {
    watcher: Mutex<RecommendedWatcher>,
    /// Canonical paths currently *successfully* watched by the OS watcher.
    /// A path notify failed to `watch()` (e.g. it does not exist) is never
    /// kept here, so the next `set_targets` call — seeing it missing from
    /// this list — retries `watch()` on it instead of assuming it is covered.
    watched: Arc<Mutex<Vec<PathBuf>>>,
    /// Canonical path -> the original path the caller last registered it as.
    labels: Arc<Mutex<HashMap<PathBuf, PathBuf>>>,
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
        let labels: Arc<Mutex<HashMap<PathBuf, PathBuf>>> = Arc::new(Mutex::new(HashMap::new()));
        let watched_for_thread = watched.clone();
        let labels_for_thread = labels.clone();

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
                                    callback(to_original(&labels_for_thread, &root), now_ms());
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
                    callback(to_original(&labels_for_thread, &root), now_ms());
                }
            }
        });

        Ok(Self { watcher: Mutex::new(watcher), watched, labels })
    }

    /// Applies a new requested target list: canonicalizes, dedupes, caps at
    /// [`MAX_ACTIVITY_TARGETS`], and updates the OS-level watches to match.
    /// A path whose `watch()` call fails is reported in `overflow`, not
    /// `watched` — it gets neither events nor a slot, so the frontend's 20s
    /// poll fallback covers it like any other overflowed path.
    pub fn set_targets(&self, requested: &[PathBuf]) -> ResolvedTargets {
        // Canonicalize while deduping by canonical form (first occurrence's
        // original spelling wins), so two requested paths that resolve to the
        // same place are only watched once.
        let mut seen = HashSet::new();
        let mut canonical_order = Vec::with_capacity(requested.len());
        let mut canonical_to_original = HashMap::with_capacity(requested.len());
        for original in requested {
            let canonical = canonicalize_best_effort(original);
            if seen.insert(canonical.clone()) {
                canonical_to_original.insert(canonical.clone(), original.clone());
                canonical_order.push(canonical);
            }
        }
        *self.labels.lock().unwrap() = canonical_to_original.clone();

        let capped = resolve_targets(&canonical_order);

        let mut watched = self.watched.lock().unwrap();
        let diff = diff_targets(&watched, &capped.watched);
        let mut failed: HashSet<PathBuf> = HashSet::new();
        {
            let mut w = self.watcher.lock().unwrap();
            for path in &diff.removed {
                let _ = w.unwatch(path);
            }
            for path in &diff.added {
                if w.watch(path, RecursiveMode::Recursive).is_err() {
                    failed.insert(path.clone());
                }
            }
        }

        let resolved = demote_failed_watches(capped, &failed);
        *watched = resolved.watched.clone();

        let label_of = |p: &PathBuf| canonical_to_original.get(p).cloned().unwrap_or_else(|| p.clone());
        ResolvedTargets {
            watched: resolved.watched.iter().map(label_of).collect(),
            overflow: resolved.overflow.iter().map(label_of).collect(),
        }
    }
}

fn to_original(labels: &Mutex<HashMap<PathBuf, PathBuf>>, canonical: &Path) -> PathBuf {
    labels
        .lock()
        .unwrap()
        .get(canonical)
        .cloned()
        .unwrap_or_else(|| canonical.to_path_buf())
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

    #[test]
    fn demote_failed_watches_moves_only_the_failed_paths_to_overflow() {
        let resolved = ResolvedTargets {
            watched: vec![p("/a"), p("/b"), p("/c")],
            overflow: vec![p("/d")],
        };
        let mut failed = HashSet::new();
        failed.insert(p("/b"));

        let result = demote_failed_watches(resolved, &failed);
        assert_eq!(result.watched, vec![p("/a"), p("/c")]);
        assert_eq!(result.overflow, vec![p("/d"), p("/b")]);
    }

    #[test]
    fn demote_failed_watches_is_a_no_op_when_nothing_failed() {
        let resolved = ResolvedTargets { watched: vec![p("/a")], overflow: vec![p("/b")] };
        let result = demote_failed_watches(resolved.clone(), &HashSet::new());
        assert_eq!(result, resolved);
    }

    // -- Integration tests against the real OS watcher (notify) --------

    fn unique_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gitbaro-activity-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Waits until `rx` receives an event whose path is `expected` (canonical
    /// comparison, since the callback echoes the caller's original path), up
    /// to a few seconds.
    fn wait_for_activity(rx: &mpsc::Receiver<PathBuf>, expected: &Path, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(path) if path == expected => return true,
                Ok(_) => continue,
                Err(_) => return false,
            }
        }
        false
    }

    /// `set_targets` must not just compute the diff — it has to actually call
    /// `watch`/`unwatch` on the OS watcher, so added paths start reporting
    /// activity and removed paths stop.
    #[test]
    fn set_targets_watches_added_paths_and_unwatches_removed_paths_on_the_real_watcher() {
        let a = unique_dir("added");
        let b = unique_dir("removed-later");
        let (tx, rx) = mpsc::channel::<PathBuf>();
        let watcher = ActivityWatcher::new(move |path, _at| {
            let _ = tx.send(path);
        })
        .unwrap();

        // Register both; original (non-canonical-looking) spelling is what
        // must come back in `watched` and in the emitted event.
        let resolved = watcher.set_targets(&[a.clone(), b.clone()]);
        assert!(resolved.watched.contains(&a));
        assert!(resolved.watched.contains(&b));
        std::thread::sleep(Duration::from_millis(300));

        std::fs::write(a.join("file.txt"), "hello").unwrap();
        assert!(wait_for_activity(&rx, &a, Duration::from_secs(5)), "expected activity under {a:?}");

        // Drop `b` from the target list — edits inside it must stop being
        // reported once unwatch() has actually run.
        let resolved = watcher.set_targets(std::slice::from_ref(&a));
        assert!(!resolved.watched.contains(&b));
        std::thread::sleep(Duration::from_millis(300));

        std::fs::write(b.join("file.txt"), "hello").unwrap();
        assert!(
            !wait_for_activity(&rx, &b, Duration::from_millis(800)),
            "expected no activity under {b:?} after it was unwatched"
        );

        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);
    }

    /// A path that does not exist (or was removed) fails `notify::Watcher::
    /// watch`. It must land in `overflow`, not `watched` — otherwise the
    /// frontend expects events that never arrive and the 20s poll fallback
    /// never covers it either.
    #[test]
    fn set_targets_demotes_a_path_that_fails_to_watch_to_overflow() {
        let missing = std::env::temp_dir().join(format!(
            "gitbaro-activity-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&missing); // make sure it does not exist

        let watcher = ActivityWatcher::new(|_, _| {}).unwrap();
        let resolved = watcher.set_targets(std::slice::from_ref(&missing));

        assert!(!resolved.watched.contains(&missing), "a path that fails to watch must not be reported as watched");
        assert!(resolved.overflow.contains(&missing), "it must fall back to the overflow/poll path instead");
    }

    /// Measures the cost of watching [`MAX_ACTIVITY_TARGETS`] real
    /// directories at once — the spec (review-redesign-tasks.md W1-T3) asks
    /// this be measured rather than assumed. Logged as the decision record
    /// for whether "지금 바뀌는 곳" needs to fall back to polling-only.
    #[test]
    fn measures_the_cost_of_watching_the_full_40_path_cap() {
        let dirs: Vec<PathBuf> = (0..MAX_ACTIVITY_TARGETS).map(|i| unique_dir(&format!("cap{i}"))).collect();
        let watcher = ActivityWatcher::new(|_, _| {}).unwrap();

        let start = Instant::now();
        let resolved = watcher.set_targets(&dirs);
        let elapsed = start.elapsed();

        assert_eq!(resolved.watched.len(), MAX_ACTIVITY_TARGETS);
        assert!(resolved.overflow.is_empty());
        // Measured on this machine: ~2.5s to register all 40 (see decisions
        // in the task report — notify's FSEvents backend rebuilds its merged
        // stream on every watch() call, so this is ~O(n) restarts, not O(1)).
        // This sanity bound only guards against a true hang/regression (e.g.
        // an accidental O(n^2) beyond what FSEvents already costs); it is not
        // a target to optimize toward in this test.
        assert!(
            elapsed < Duration::from_secs(10),
            "watching {} paths took {:?}, expected it to stay well under 10s",
            MAX_ACTIVITY_TARGETS,
            elapsed
        );
        eprintln!(
            "[activity bench] set_targets() for {} paths (initial registration, cold) took {:?}",
            MAX_ACTIVITY_TARGETS, elapsed
        );

        for dir in &dirs {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}
