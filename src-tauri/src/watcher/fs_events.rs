use crate::error::AppError;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Which part of the repository a debounced change touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    /// A file in the working tree (affects `git status`).
    WorkTree,
    /// Git metadata that other views depend on: HEAD, index, refs, and the
    /// state files of an in-progress merge / rebase / cherry-pick / revert.
    GitDir,
}

/// Directories inside the working tree whose changes never show up in
/// `git status` (dependency/build output) and only produce noise.
const IGNORED_DIRS: [&str; 6] = [".git", "node_modules", "target", "dist", ".next", "build"];

/// Top-level entries of a git dir whose changes matter to the UI. Everything
/// else (objects/, logs/, hooks/, config, FETCH_HEAD, ...) is ignored.
const RELEVANT_GIT_ENTRIES: [&str; 9] = [
    "HEAD",
    "index",
    "refs",
    "packed-refs",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
];

/// Paths the watcher needs to tell working-tree changes from git-dir changes.
/// All paths are canonicalized so they match what FSEvents reports
/// (e.g. `/private/var/...` rather than `/var/...`).
#[derive(Debug, Clone)]
pub struct WatchTargets {
    workdir: PathBuf,
    /// Git dirs, most specific first: the repo's own git dir, then the common
    /// dir shared by linked worktrees (where refs and packed-refs live).
    git_dirs: Vec<PathBuf>,
}

impl WatchTargets {
    pub fn new(workdir: &Path, git_dir: &Path, common_dir: &Path) -> Self {
        let git_dir = canonical(git_dir);
        let common_dir = canonical(common_dir);
        let git_dirs = if git_dir == common_dir {
            vec![git_dir]
        } else {
            vec![git_dir, common_dir]
        };
        Self {
            workdir: canonical(workdir),
            git_dirs,
        }
    }

    /// Directories to register with the OS watcher: the working tree plus
    /// every git dir that does not already live inside a watched directory
    /// (a linked worktree's git dir sits under the main repo's `.git`).
    fn roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![self.workdir.clone()];
        // Watch the broadest git dir first so a nested one is skipped.
        for dir in self.git_dirs.iter().rev() {
            if !roots.iter().any(|root| dir.starts_with(root)) {
                roots.push(dir.clone());
            }
        }
        roots
    }

    /// Classify a single changed path, or `None` when it should be ignored.
    pub fn classify(&self, path: &Path) -> Option<ChangeKind> {
        if let Some(rel) = self.git_dirs.iter().find_map(|dir| path.strip_prefix(dir).ok()) {
            return is_relevant_git_path(rel).then_some(ChangeKind::GitDir);
        }

        let rel = path.strip_prefix(&self.workdir).ok()?;
        // Only the part below the repo root counts — a parent folder named
        // `build` or `target` must not hide every change in the repo.
        let ignored = rel.components().any(|c| match c {
            Component::Normal(name) => IGNORED_DIRS.contains(&name.to_string_lossy().as_ref()),
            _ => false,
        });
        (!ignored).then_some(ChangeKind::WorkTree)
    }
}

/// Resolve symlinks. A path that does not exist yet keeps its file name under
/// the resolved parent, so it still lines up with the other canonical paths.
fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| {
        match (path.parent(), path.file_name()) {
            (Some(parent), Some(name)) => std::fs::canonicalize(parent)
                .map(|p| p.join(name))
                .unwrap_or_else(|_| path.to_path_buf()),
            _ => path.to_path_buf(),
        }
    })
}

/// `rel` is relative to a git dir. Lock files are transient; git renames them
/// onto the real file, and that rename is reported on its own.
fn is_relevant_git_path(rel: &Path) -> bool {
    let is_lock = rel.extension().is_some_and(|ext| ext == "lock");
    if is_lock {
        return false;
    }
    match rel.components().next() {
        Some(Component::Normal(first)) => {
            RELEVANT_GIT_ENTRIES.contains(&first.to_string_lossy().as_ref())
        }
        _ => false,
    }
}

pub struct RepoWatcher {
    watcher: RecommendedWatcher,
}

impl RepoWatcher {
    /// Watch the working tree and git dir(s) described by `targets`. Calls
    /// `callback` once per change kind after 100 ms without further events of
    /// that kind.
    pub fn new<F>(targets: WatchTargets, callback: F) -> Result<Self, AppError>
    where
        F: Fn(ChangeKind) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

        let mut watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

        for root in targets.roots() {
            watcher
                .watch(&root, RecursiveMode::Recursive)
                .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
        }

        std::thread::spawn(move || {
            let debounce = Duration::from_millis(100);
            // Time the latest event of each kind arrived, while one is pending.
            let mut work_tree: Option<Instant> = None;
            let mut git_dir: Option<Instant> = None;

            loop {
                match rx.recv_timeout(debounce) {
                    Ok(Ok(event)) => {
                        let now = Instant::now();
                        for path in &event.paths {
                            match targets.classify(path) {
                                Some(ChangeKind::WorkTree) => work_tree = Some(now),
                                Some(ChangeKind::GitDir) => git_dir = Some(now),
                                None => {}
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        tracing::error!("Watcher error: {}", e);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    // Channel closed — the watcher was dropped, exit the thread.
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }

                for (pending, kind) in [
                    (&mut work_tree, ChangeKind::WorkTree),
                    (&mut git_dir, ChangeKind::GitDir),
                ] {
                    if pending.is_some_and(|at| at.elapsed() >= debounce) {
                        *pending = None;
                        callback(kind);
                    }
                }
            }
        });

        Ok(RepoWatcher { watcher })
    }

    /// Stop watching by dropping the watcher (unregisters FSEvents handler).
    pub fn stop(self) {
        drop(self.watcher);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain_repo(root: &str) -> WatchTargets {
        let root = PathBuf::from(root);
        WatchTargets {
            workdir: root.clone(),
            git_dirs: vec![root.join(".git")],
        }
    }

    #[test]
    fn parent_folder_named_like_an_ignored_dir_does_not_hide_changes() {
        let targets = plain_repo("/Users/me/work/build/app");
        assert_eq!(
            targets.classify(Path::new("/Users/me/work/build/app/src/main.rs")),
            Some(ChangeKind::WorkTree)
        );
        let targets = plain_repo("/Users/me/target/app");
        assert_eq!(
            targets.classify(Path::new("/Users/me/target/app/README.md")),
            Some(ChangeKind::WorkTree)
        );
    }

    #[test]
    fn ignored_dirs_inside_the_repo_are_still_ignored() {
        let targets = plain_repo("/repo");
        assert_eq!(targets.classify(Path::new("/repo/node_modules/x/index.js")), None);
        assert_eq!(targets.classify(Path::new("/repo/pkg/dist/bundle.js")), None);
        assert_eq!(targets.classify(Path::new("/repo/target/debug/app")), None);
    }

    #[test]
    fn paths_outside_the_repo_are_ignored() {
        let targets = plain_repo("/repo");
        assert_eq!(targets.classify(Path::new("/other/file.txt")), None);
    }

    #[test]
    fn git_metadata_changes_are_reported_as_git_dir() {
        let targets = plain_repo("/repo");
        for p in [
            "/repo/.git/HEAD",
            "/repo/.git/index",
            "/repo/.git/packed-refs",
            "/repo/.git/refs/heads/feature/x",
            "/repo/.git/refs/stash",
            "/repo/.git/MERGE_HEAD",
            "/repo/.git/CHERRY_PICK_HEAD",
            "/repo/.git/REVERT_HEAD",
            "/repo/.git/rebase-merge/done",
            "/repo/.git/rebase-apply/next",
        ] {
            assert_eq!(targets.classify(Path::new(p)), Some(ChangeKind::GitDir), "{p}");
        }
    }

    #[test]
    fn git_noise_is_ignored() {
        let targets = plain_repo("/repo");
        for p in [
            "/repo/.git/objects/ab/cdef",
            "/repo/.git/logs/HEAD",
            "/repo/.git/index.lock",
            "/repo/.git/refs/heads/main.lock",
            "/repo/.git/FETCH_HEAD",
            "/repo/.git/config",
            "/repo/.git",
        ] {
            assert_eq!(targets.classify(Path::new(p)), None, "{p}");
        }
    }

    #[test]
    fn linked_worktree_uses_its_own_git_dir_and_the_common_refs() {
        let targets = WatchTargets {
            workdir: PathBuf::from("/wt/feature"),
            git_dirs: vec![
                PathBuf::from("/repo/.git/worktrees/feature"),
                PathBuf::from("/repo/.git"),
            ],
        };
        assert_eq!(
            targets.classify(Path::new("/repo/.git/worktrees/feature/HEAD")),
            Some(ChangeKind::GitDir)
        );
        assert_eq!(
            targets.classify(Path::new("/repo/.git/worktrees/feature/index")),
            Some(ChangeKind::GitDir)
        );
        assert_eq!(
            targets.classify(Path::new("/repo/.git/refs/heads/feature")),
            Some(ChangeKind::GitDir)
        );
        // Another worktree's HEAD is not ours.
        assert_eq!(targets.classify(Path::new("/repo/.git/worktrees/other/HEAD")), None);
        // The `.git` file in the worktree root is not a working-tree change.
        assert_eq!(targets.classify(Path::new("/wt/feature/.git")), None);
        assert_eq!(
            targets.classify(Path::new("/wt/feature/src/lib.rs")),
            Some(ChangeKind::WorkTree)
        );

        // Only the common dir needs its own registration; the worktree git dir
        // lives inside it.
        assert_eq!(
            targets.roots(),
            vec![PathBuf::from("/wt/feature"), PathBuf::from("/repo/.git")]
        );
    }

    #[test]
    fn plain_repo_registers_only_the_workdir() {
        assert_eq!(plain_repo("/repo").roots(), vec![PathBuf::from("/repo")]);
    }
}
