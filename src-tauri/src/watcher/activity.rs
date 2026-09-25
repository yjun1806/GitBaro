//! Activity watcher: tracks *when* files last changed across many
//! repositories and worktrees at once, for the sidebar's "지금 바뀌는 곳"
//! section, live-changed-line highlighting, and the workspace review screen.
//!
//! This is a separate watcher from `commands::watch::WatcherState`, which
//! watches exactly one active repository and drives its status refresh
//! (`fs:change` / `fs:git-dir-change`). That one keeps doing its job
//! unchanged; this one only ever emits a timestamp, for up to
//! [`MAX_ACTIVITY_TARGETS`] paths at a time.

use git2::Repository;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::path::{Component, Path, PathBuf};
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

/// What kind of change a `repo:activity` event reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityKind {
    /// A file in the working tree changed (not ignored, not build output).
    WorkTree,
    /// Git metadata of that path changed: a commit, staging, a branch switch
    /// or a branch moved (HEAD, index, `refs/heads/*`, `packed-refs`). Nothing
    /// in the working tree has to change for this — e.g. `git commit`.
    Git,
}

/// Where a watched path keeps its git metadata. Both paths are canonical.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitLayout {
    /// The path's own git dir: `<repo>/.git`, or `<repo>/.git/worktrees/<name>`
    /// for a linked worktree (its HEAD and index live here).
    pub git_dir: PathBuf,
    /// The dir shared by all worktrees of the repository, where branches
    /// (`refs/heads/*`, `packed-refs`) live. Same as `git_dir` for the main
    /// working tree.
    pub common_dir: PathBuf,
}

/// Reads the git layout of a watched path. `None` when it is not a repository
/// or worktree root.
pub fn git_layout(root: &Path) -> Option<GitLayout> {
    let repo = Repository::open(root).ok()?;
    Some(GitLayout {
        git_dir: canonicalize_best_effort(repo.path()),
        common_dir: canonicalize_best_effort(&crate::commands::watch::common_dir(repo.path())),
    })
}

/// The branch `git_dir/HEAD` points at (`main`), or `None` when detached or
/// unreadable.
pub fn head_branch(git_dir: &Path) -> Option<String> {
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    head.trim().strip_prefix("ref: refs/heads/").map(str::to_string)
}

/// Watched paths whose git metadata `path` belongs to. Only changes that can
/// alter what the review screen shows count: HEAD and index of that path's
/// own git dir, and the branch it has checked out (`refs/heads/<branch>`,
/// `packed-refs`) in the shared dir. `objects/`, `logs/`, lock files and
/// other worktrees' metadata are noise.
pub fn classify_git_change(
    path: &Path,
    layouts: &[(PathBuf, GitLayout)],
    branch_of: &dyn Fn(&Path) -> Option<String>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for (root, layout) in layouts {
        let own = path
            .strip_prefix(&layout.git_dir)
            .is_ok_and(|rel| rel == Path::new("HEAD") || rel == Path::new("index"));
        let shared = path.strip_prefix(&layout.common_dir).is_ok_and(|rel| {
            if rel == Path::new("packed-refs") {
                return true;
            }
            match rel.strip_prefix("refs/heads") {
                Ok(name) => branch_of(&layout.git_dir).is_some_and(|b| Path::new(&b) == name),
                Err(_) => false,
            }
        });
        if (own || shared) && !roots.contains(root) {
            roots.push(root.clone());
        }
    }
    roots
}

/// Attributes a changed path to the watched roots it belongs to and says what
/// kind of change it is. Empty when it should not count as activity.
///
/// - Git metadata counts as [`ActivityKind::Git`] for the paths it affects
///   (see [`classify_git_change`]); all other `.git` internals never count.
/// - Build output and dependency installs inside the root (`super::fs_events::
///   IGNORED_DIRS` — `node_modules`, `target`, `dist`, `.next`, `build`) never
///   count either, matching the existing single-repo watcher: otherwise
///   `cargo build` or `pnpm install` inside a watched repo would mark it as
///   "just changed" even though no tracked or untracked source file moved.
///   Files matched by `.gitignore` are dropped later, by [`IgnoreCache`].
/// - When a watched root sits inside another watched root (a worktree folder
///   under its parent repository, `.gitignore:23`/`:39` — `.claude/worktrees/x`,
///   `.worktrees/x`), the change is attributed to the deepest (most specific)
///   containing root only, so it is never double-counted.
pub fn classify_activity(
    path: &Path,
    watched: &[PathBuf],
    layouts: &[(PathBuf, GitLayout)],
    branch_of: &dyn Fn(&Path) -> Option<String>,
) -> Vec<(PathBuf, ActivityKind)> {
    let git_roots = classify_git_change(path, layouts, branch_of);
    if !git_roots.is_empty() {
        return git_roots.into_iter().map(|root| (root, ActivityKind::Git)).collect();
    }
    let in_git_dir = layouts
        .iter()
        .any(|(_, l)| path.starts_with(&l.git_dir) || path.starts_with(&l.common_dir));
    if in_git_dir {
        return Vec::new();
    }
    worktree_root(path, watched).map(|root| vec![(root, ActivityKind::WorkTree)]).unwrap_or_default()
}

/// The deepest watched root containing `path`, unless the path is inside
/// `.git` or build/dependency output.
fn worktree_root(path: &Path, watched: &[PathBuf]) -> Option<PathBuf> {
    let root = watched
        .iter()
        .filter(|root| path.starts_with(root.as_path()))
        .max_by_key(|root| root.as_os_str().len())?;

    let rel = path.strip_prefix(root).unwrap_or(path);
    let ignored = rel
        .components()
        .any(|c| matches!(c, Component::Normal(name) if super::fs_events::IGNORED_DIRS.contains(&name.to_string_lossy().as_ref())));
    if ignored {
        return None;
    }

    Some(root.clone())
}

/// Git dirs to watch besides the roots themselves: a linked worktree keeps
/// its HEAD and index under the main repository's `.git`, which may not be
/// inside any watched root. Dirs already covered by a watched root (or by
/// another entry) are left out.
pub fn extra_git_watches(watched: &[PathBuf], layouts: &[(PathBuf, GitLayout)]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for (_, layout) in layouts {
        for dir in [&layout.common_dir, &layout.git_dir] {
            let covered = watched.iter().chain(dirs.iter()).any(|root| dir.starts_with(root));
            if !covered {
                dirs.push(dir.clone());
            }
        }
    }
    dirs
}

/// Answers "is this changed file ignored by `.gitignore`?" per watched root,
/// keeping one opened repository per root. `__pycache__`, `.pytest_cache`,
/// coverage output and the like must not count as live changes: they never
/// show up in `git status` either.
#[derive(Default)]
pub struct IgnoreCache {
    repos: HashMap<PathBuf, Option<Repository>>,
}

impl IgnoreCache {
    /// Forgets roots that are no longer watched.
    pub fn retain(&mut self, watched: &[PathBuf]) {
        self.repos.retain(|root, _| watched.contains(root));
    }

    /// `true` when `path` (inside `root`) is ignored and not tracked. A tracked
    /// file stays visible even if an ignore rule matches it, like in git.
    pub fn is_ignored(&mut self, root: &Path, path: &Path) -> bool {
        let repo = self.repos.entry(root.to_path_buf()).or_insert_with(|| Repository::open(root).ok());
        let Some(repo) = repo.as_ref() else { return false };
        let Ok(rel) = path.strip_prefix(root) else { return false };
        if rel.as_os_str().is_empty() || !repo.is_path_ignored(rel).unwrap_or(false) {
            return false;
        }
        let tracked = repo.index().ok().is_some_and(|mut index| {
            // The cached index may be stale; re-read it only if it changed on disk.
            let _ = index.read(false);
            index.get_path(rel, 0).is_some()
        });
        !tracked
    }
}

/// Coalesces repeated activity on the same root into one emission per
/// [`ACTIVITY_WINDOW`]. The first change after a quiet period emits
/// immediately (fast feedback); further changes during the window are
/// recorded and flushed once, after the window elapses.
pub struct ActivityThrottle<K = PathBuf> {
    window: Duration,
    last_emit: HashMap<K, Instant>,
    pending: HashMap<K, Instant>,
}

impl<K: Clone + Eq + Hash> ActivityThrottle<K> {
    pub fn new(window: Duration) -> Self {
        Self { window, last_emit: HashMap::new(), pending: HashMap::new() }
    }

    /// Records that `root` changed at `now`. Returns `true` when it should be
    /// emitted right away.
    pub fn record(&mut self, root: K, now: Instant) -> bool {
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
    pub fn due(&mut self, now: Instant) -> Vec<K> {
        let ready: Vec<K> = self
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
/// calls `callback(root, at_epoch_ms, kind)` at most once per
/// [`ACTIVITY_WINDOW`] per root and kind when something inside it changes.
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
    /// Git layout of each watched path that is a repository or worktree root.
    layouts: Arc<Mutex<Vec<(PathBuf, GitLayout)>>>,
    /// Git dirs watched in addition to the roots (see [`extra_git_watches`]).
    extra: Mutex<Vec<PathBuf>>,
}

impl ActivityWatcher {
    pub fn new<F>(callback: F) -> Result<Self, AppError>
    where
        F: Fn(PathBuf, i64, ActivityKind) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

        let watched: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
        let labels: Arc<Mutex<HashMap<PathBuf, PathBuf>>> = Arc::new(Mutex::new(HashMap::new()));
        let layouts: Arc<Mutex<Vec<(PathBuf, GitLayout)>>> = Arc::new(Mutex::new(Vec::new()));
        let watched_for_thread = watched.clone();
        let labels_for_thread = labels.clone();
        let layouts_for_thread = layouts.clone();

        std::thread::spawn(move || {
            let mut throttle = ActivityThrottle::<(PathBuf, ActivityKind)>::new(ACTIVITY_WINDOW);
            let mut ignores = IgnoreCache::default();
            loop {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(Ok(event)) => {
                        let now = Instant::now();
                        let targets = watched_for_thread.lock().unwrap().clone();
                        let layouts = layouts_for_thread.lock().unwrap().clone();
                        ignores.retain(&targets);
                        for path in &event.paths {
                            for (root, kind) in classify_activity(path, &targets, &layouts, &head_branch) {
                                if kind == ActivityKind::WorkTree && ignores.is_ignored(&root, path) {
                                    continue;
                                }
                                if throttle.record((root.clone(), kind), now) {
                                    callback(to_original(&labels_for_thread, &root), now_ms(), kind);
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

                for (root, kind) in throttle.due(Instant::now()) {
                    callback(to_original(&labels_for_thread, &root), now_ms(), kind);
                }
            }
        });

        Ok(Self { watcher: Mutex::new(watcher), watched, labels, layouts, extra: Mutex::new(Vec::new()) })
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
        self.update_git_watches(&resolved.watched);

        let label_of = |p: &PathBuf| canonical_to_original.get(p).cloned().unwrap_or_else(|| p.clone());
        ResolvedTargets {
            watched: resolved.watched.iter().map(label_of).collect(),
            overflow: resolved.overflow.iter().map(label_of).collect(),
        }
    }
}

impl ActivityWatcher {
    /// Records the git layout of each watched root and watches the git dirs
    /// that no root covers. A git dir that fails to watch only loses `git`
    /// events; working-tree events for its root are unaffected.
    fn update_git_watches(&self, roots: &[PathBuf]) {
        let layouts: Vec<(PathBuf, GitLayout)> =
            roots.iter().filter_map(|root| git_layout(root).map(|l| (root.clone(), l))).collect();
        let wanted = extra_git_watches(roots, &layouts);
        *self.layouts.lock().unwrap() = layouts;

        let mut extra = self.extra.lock().unwrap();
        let diff = diff_targets(&extra, &wanted);
        let mut w = self.watcher.lock().unwrap();
        for dir in &diff.removed {
            let _ = w.unwatch(dir);
        }
        let mut now_watched: Vec<PathBuf> = extra.iter().filter(|d| !diff.removed.contains(d)).cloned().collect();
        for dir in diff.added {
            match w.watch(&dir, RecursiveMode::Recursive) {
                Ok(()) => now_watched.push(dir),
                Err(e) => tracing::warn!("[activity] git dir not watched {}: {}", dir.display(), e),
            }
        }
        *extra = now_watched;
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

    /// Working-tree classification only (no git layouts known).
    fn worktree_of(path: &str, watched: &[PathBuf]) -> Option<PathBuf> {
        match classify_activity(Path::new(path), watched, &[], &|_| None).as_slice() {
            [] => None,
            [(root, ActivityKind::WorkTree)] => Some(root.clone()),
            other => panic!("unexpected {other:?}"),
        }
    }

    fn main_repo(root: &str) -> (PathBuf, GitLayout) {
        let git = p(root).join(".git");
        (p(root), GitLayout { git_dir: git.clone(), common_dir: git })
    }

    fn linked(root: &str, common: &str, name: &str) -> (PathBuf, GitLayout) {
        (p(root), GitLayout { git_dir: p(common).join("worktrees").join(name), common_dir: p(common) })
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
    fn classify_ignores_git_internals_without_a_layout() {
        let watched = vec![p("/repo")];
        assert_eq!(worktree_of("/repo/.git/index", &watched), None);
        assert_eq!(worktree_of("/repo/.git/refs/heads/main", &watched), None);
    }

    #[test]
    fn commits_staging_and_branch_moves_are_git_activity() {
        let watched = vec![p("/repo")];
        let layouts = vec![main_repo("/repo")];
        let on_main = |_: &Path| Some("main".to_string());
        for path in ["/repo/.git/HEAD", "/repo/.git/index", "/repo/.git/refs/heads/main", "/repo/.git/packed-refs"] {
            assert_eq!(
                classify_activity(Path::new(path), &watched, &layouts, &on_main),
                vec![(p("/repo"), ActivityKind::Git)],
                "{path}"
            );
        }
        // Noise: objects, logs, locks, other branches, remote-tracking refs.
        for path in [
            "/repo/.git/objects/ab/cdef",
            "/repo/.git/logs/HEAD",
            "/repo/.git/index.lock",
            "/repo/.git/refs/heads/other",
            "/repo/.git/refs/remotes/origin/main",
            "/repo/.git/FETCH_HEAD",
        ] {
            assert!(classify_activity(Path::new(path), &watched, &layouts, &on_main).is_empty(), "{path}");
        }
    }

    #[test]
    fn a_linked_worktree_gets_its_own_git_activity() {
        let watched = vec![p("/repo"), p("/wt")];
        let layouts = vec![main_repo("/repo"), linked("/wt", "/repo/.git", "wt")];
        // main checks out `main`, the worktree `feat`.
        let branch_of = |git_dir: &Path| {
            Some(if git_dir.ends_with("worktrees/wt") { "feat" } else { "main" }.to_string())
        };
        let kinds = |path: &str| classify_activity(Path::new(path), &watched, &layouts, &branch_of);
        assert_eq!(kinds("/repo/.git/worktrees/wt/index"), vec![(p("/wt"), ActivityKind::Git)]);
        assert_eq!(kinds("/repo/.git/worktrees/wt/HEAD"), vec![(p("/wt"), ActivityKind::Git)]);
        assert_eq!(kinds("/repo/.git/refs/heads/feat"), vec![(p("/wt"), ActivityKind::Git)]);
        assert_eq!(kinds("/repo/.git/refs/heads/main"), vec![(p("/repo"), ActivityKind::Git)]);
        assert!(kinds("/repo/.git/worktrees/wt/logs/HEAD").is_empty());
        // packed-refs may move either branch.
        assert_eq!(
            kinds("/repo/.git/packed-refs"),
            vec![(p("/repo"), ActivityKind::Git), (p("/wt"), ActivityKind::Git)]
        );
    }

    #[test]
    fn nested_branch_names_match_their_ref_path() {
        let watched = vec![p("/repo")];
        let layouts = vec![main_repo("/repo")];
        let on_feat = |_: &Path| Some("feat/x".to_string());
        assert_eq!(
            classify_activity(Path::new("/repo/.git/refs/heads/feat/x"), &watched, &layouts, &on_feat),
            vec![(p("/repo"), ActivityKind::Git)]
        );
    }

    #[test]
    fn git_dirs_outside_every_root_are_watched_once() {
        // Only the linked worktree is watched: its git dir lives in the main repo's `.git`.
        let layouts = vec![linked("/wt", "/repo/.git", "wt")];
        assert_eq!(extra_git_watches(&[p("/wt")], &layouts), vec![p("/repo/.git")]);
        // The main repo is watched too, so its `.git` is already covered.
        let layouts = vec![main_repo("/repo"), linked("/wt", "/repo/.git", "wt")];
        assert!(extra_git_watches(&[p("/repo"), p("/wt")], &layouts).is_empty());
    }

    #[test]
    fn classify_attributes_to_the_deepest_containing_root() {
        // A linked worktree living inside its parent repo's working tree
        // (`.gitignore:23`/`:39`): a change under it must count for the
        // worktree only, not for the parent repo too.
        let watched = vec![p("/repo"), p("/repo/.worktrees/feature")];
        assert_eq!(
            worktree_of("/repo/.worktrees/feature/src/lib.rs", &watched),
            Some(p("/repo/.worktrees/feature"))
        );
        assert_eq!(worktree_of("/repo/src/main.rs", &watched), Some(p("/repo")));
    }

    #[test]
    fn classify_ignores_build_and_dependency_output() {
        // Matches `watcher::fs_events::IGNORED_DIRS` so the same repo gets the
        // same answer whether it is watched here or polled via
        // `dirtyLatestMtime` — a `cargo build`/`pnpm install`/`vite build`
        // must not count as "지금 바뀌는 곳" activity.
        let watched = vec![p("/repo")];
        for path in [
            "/repo/target/debug/foo",
            "/repo/node_modules/pkg/index.js",
            "/repo/dist/bundle.js",
            "/repo/.next/cache/x",
            "/repo/build/out.bin",
        ] {
            assert_eq!(worktree_of(path, &watched), None, "{path}");
        }
        // A source file still counts.
        assert_eq!(worktree_of("/repo/src/main.rs", &watched), Some(p("/repo")));
    }

    #[test]
    fn classify_returns_none_outside_every_watched_root() {
        let watched = vec![p("/repo")];
        assert_eq!(worktree_of("/other/file.txt", &watched), None);
    }

    #[test]
    fn gitignored_files_do_not_count_but_tracked_ones_do() {
        let dir = TempDir::new("ignore");
        let root = dir.0.clone();
        git(&root, &["init", "-q"]);
        std::fs::write(root.join(".gitignore"), "__pycache__/\n.pytest_cache/\n*.log\n").unwrap();
        std::fs::write(root.join("kept.log"), "tracked despite the rule").unwrap();
        git(&root, &["add", "-f", ".gitignore", "kept.log"]);
        std::fs::create_dir_all(root.join("pkg/__pycache__")).unwrap();
        std::fs::write(root.join("pkg/__pycache__/m.pyc"), "x").unwrap();

        let mut cache = IgnoreCache::default();
        assert!(cache.is_ignored(&root, &root.join("pkg/__pycache__/m.pyc")));
        assert!(cache.is_ignored(&root, &root.join("pkg/__pycache__")));
        assert!(cache.is_ignored(&root, &root.join(".pytest_cache/v/cache/nodeids")));
        assert!(cache.is_ignored(&root, &root.join("run.log")));
        assert!(!cache.is_ignored(&root, &root.join("kept.log")), "tracked files still count");
        assert!(!cache.is_ignored(&root, &root.join("pkg/m.py")));
        // Not a repository: nothing is ignored.
        let plain = TempDir::new("ignore-plain");
        assert!(!cache.is_ignored(&plain.0, &plain.0.join("x.log")));
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

    /// A temp dir removed on drop, also when the test panics.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "gitbaro-activity-{}-{}-{}",
                name,
                std::process::id(),
                std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    /// Waits until `rx` receives an event for `expected` of `kind` (the
    /// callback echoes the caller's original path), up to `timeout`. Returns
    /// every event received before it, or `None` on timeout.
    fn wait_for_activity(
        rx: &mpsc::Receiver<(PathBuf, ActivityKind)>,
        expected: &Path,
        kind: ActivityKind,
        timeout: Duration,
    ) -> Option<Vec<(PathBuf, ActivityKind)>> {
        let deadline = Instant::now() + timeout;
        let mut before = Vec::new();
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok((path, k)) if path == expected && k == kind => return Some(before),
                Ok(other) => before.push(other),
                Err(_) => return None,
            }
        }
        None
    }

    fn recording_watcher() -> (ActivityWatcher, mpsc::Receiver<(PathBuf, ActivityKind)>) {
        let (tx, rx) = mpsc::channel();
        let watcher = ActivityWatcher::new(move |path, _at, kind| {
            let _ = tx.send((path, kind));
        })
        .unwrap();
        (watcher, rx)
    }

    /// `set_targets` must not just compute the diff — it has to actually call
    /// `watch`/`unwatch` on the OS watcher, so added paths start reporting
    /// activity and removed paths stop.
    ///
    /// The "no events after unwatch" check does not wait a fixed time: after
    /// writing into the removed path it writes into the still-watched one and
    /// waits for that event. Events arrive in order on one channel, so an
    /// event for the removed path would have arrived before it.
    #[test]
    fn set_targets_watches_added_paths_and_unwatches_removed_paths_on_the_real_watcher() {
        let a = TempDir::new("added");
        let b = TempDir::new("removed-later");
        let (a, b) = (&a.0, &b.0);
        let (watcher, rx) = recording_watcher();

        // Register both; original (non-canonical-looking) spelling is what
        // must come back in `watched` and in the emitted event.
        let resolved = watcher.set_targets(&[a.clone(), b.clone()]);
        assert!(resolved.watched.contains(a));
        assert!(resolved.watched.contains(b));
        std::thread::sleep(Duration::from_millis(300));

        std::fs::write(a.join("file.txt"), "hello").unwrap();
        assert!(
            wait_for_activity(&rx, a, ActivityKind::WorkTree, Duration::from_secs(5)).is_some(),
            "expected activity under {a:?}"
        );

        // Drop `b` from the target list — edits inside it must stop being
        // reported once unwatch() has actually run.
        let resolved = watcher.set_targets(std::slice::from_ref(a));
        assert!(!resolved.watched.contains(b));
        std::thread::sleep(Duration::from_millis(300));

        std::fs::write(b.join("file.txt"), "hello").unwrap();
        std::fs::write(a.join("sentinel.txt"), "after b").unwrap();
        // `a` emitted less than 2s ago, so its sentinel event is flushed at the window's end.
        let before = wait_for_activity(&rx, a, ActivityKind::WorkTree, Duration::from_secs(8))
            .expect("the sentinel write under `a` must be reported");
        assert!(
            !before.iter().any(|(path, _)| path == b),
            "expected no activity under {b:?} after it was unwatched: {before:?}"
        );
    }

    /// A commit changes nothing in the working tree, only git metadata. It
    /// must still be reported (as `git`), or the review screen keeps showing
    /// the committed files as uncommitted until the next poll.
    #[test]
    fn a_commit_without_file_changes_is_reported_as_git_activity() {
        let dir = TempDir::new("commit");
        let root = &dir.0;
        git(root, &["init", "-q", "-b", "main"]);
        git(root, &["commit", "-q", "--allow-empty", "-m", "init"]);
        let (watcher, rx) = recording_watcher();
        watcher.set_targets(std::slice::from_ref(root));
        std::thread::sleep(Duration::from_millis(300));

        git(root, &["commit", "-q", "--allow-empty", "-m", "second"]);
        let before = wait_for_activity(&rx, root, ActivityKind::Git, Duration::from_secs(5))
            .expect("expected git activity for the commit");
        assert!(before.iter().all(|(_, k)| *k == ActivityKind::Git), "no working-tree event: {before:?}");
    }

    /// A linked worktree keeps its HEAD and index under the main repository's
    /// `.git`, outside the watched folder. Its commits must be reported too.
    #[test]
    fn a_commit_in_a_linked_worktree_is_reported_for_that_worktree() {
        let dir = TempDir::new("linked");
        let main = dir.0.join("main");
        let wt = dir.0.join("wt");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["commit", "-q", "--allow-empty", "-m", "init"]);
        git(&main, &["worktree", "add", "-q", "-b", "feat", wt.to_str().unwrap()]);
        let (watcher, rx) = recording_watcher();
        let resolved = watcher.set_targets(std::slice::from_ref(&wt));
        assert_eq!(resolved.watched, vec![wt.clone()]);
        std::thread::sleep(Duration::from_millis(300));

        git(&wt, &["commit", "-q", "--allow-empty", "-m", "in the worktree"]);
        assert!(
            wait_for_activity(&rx, &wt, ActivityKind::Git, Duration::from_secs(5)).is_some(),
            "expected git activity for the linked worktree"
        );
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

        let watcher = ActivityWatcher::new(|_, _, _| {}).unwrap();
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
        // Removed on drop, also when an assertion below fails.
        let dirs: Vec<TempDir> = (0..MAX_ACTIVITY_TARGETS).map(|i| TempDir::new(&format!("cap{i}"))).collect();
        let paths: Vec<PathBuf> = dirs.iter().map(|d| d.0.clone()).collect();
        let watcher = ActivityWatcher::new(|_, _, _| {}).unwrap();

        let start = Instant::now();
        let resolved = watcher.set_targets(&paths);
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
    }
}
