//! State directories inside `.git/` (contract §2.11).
//!
//! Two directories, because two kinds of state have different lifetimes:
//!
//! - **worktree-local** (`{repo.path()}/gitbaro/`) — file review marks, test-run
//!   evidence. These describe *this* checkout and must not follow it around.
//! - **worktree-shared** (`{common_dir}/gitbaro/`) — commit review marks,
//!   session summary cache. A commit is reviewed regardless of which worktree
//!   you were standing in when you reviewed it.
//!
//! Living under `.git/` means git already ignores everything here, so no
//! `.gitignore` has to be touched.

use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::AppError;

const STATE_DIR: &str = "gitbaro";

/// `{repo.path()}/gitbaro/`, created if missing.
pub fn worktree_state_dir(repo: &Repository) -> Result<PathBuf, AppError> {
    ensure_dir(repo.path().join(STATE_DIR))
}

/// `{common_dir}/gitbaro/`, created if missing.
///
/// `git2 0.19` has no `Repository::commondir()`, so the `commondir` pointer file
/// a linked worktree carries is resolved by hand.
pub fn shared_state_dir(repo: &Repository) -> Result<PathBuf, AppError> {
    ensure_dir(common_dir(repo).join(STATE_DIR))
}

/// The shared git directory: `repo.path()` for a normal checkout, the resolved
/// `commondir` pointer for a linked worktree.
fn common_dir(repo: &Repository) -> PathBuf {
    let git_dir = repo.path().to_path_buf();
    if !repo.is_worktree() {
        return git_dir;
    }

    let pointer = git_dir.join("commondir");
    let raw = match std::fs::read_to_string(&pointer) {
        Ok(raw) => raw,
        Err(e) => {
            tracing::warn!(
                "[verify] could not read {:?}: {} — falling back to the worktree git dir",
                pointer,
                e
            );
            return git_dir;
        }
    };

    let target = Path::new(raw.trim());
    let resolved = if target.is_absolute() {
        target.to_path_buf()
    } else {
        git_dir.join(target)
    };

    // `canonicalize` collapses the `../..` a commondir pointer normally holds.
    resolved.canonicalize().unwrap_or(resolved)
}

fn ensure_dir(dir: PathBuf) -> Result<PathBuf, AppError> {
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "gitbaro-paths-{}-{}-{}",
                tag,
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn plain_repository_uses_its_own_git_dir() {
        let dir = TempDir::new("plain");
        let repo = Repository::init(&dir.0).expect("init");
        let state = worktree_state_dir(&repo).expect("state dir");
        assert!(state.ends_with("gitbaro"));
        assert!(state.exists());
        assert_eq!(
            shared_state_dir(&repo).expect("shared"),
            state,
            "a non-worktree repo shares its own git dir"
        );
    }

    #[test]
    fn commondir_pointer_is_resolved_for_a_linked_worktree() {
        let dir = TempDir::new("wt");
        let main = dir.0.join("main");
        std::fs::create_dir_all(&main).expect("create main");
        let repo = Repository::init(&main).expect("init");

        // A commit is required before a worktree can be added.
        let sig = git2::Signature::now("T", "t@example.com").expect("sig");
        let tree_id = {
            let mut index = repo.index().expect("index");
            index.write_tree().expect("write tree")
        };
        let tree = repo.find_tree(tree_id).expect("tree");
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
            .expect("commit");

        let wt_path = dir.0.join("linked");
        let worktree = repo
            .worktree("linked", &wt_path, None)
            .expect("add worktree");
        let linked = Repository::open_from_worktree(&worktree).expect("open worktree");

        assert!(linked.is_worktree());
        let shared = shared_state_dir(&linked).expect("shared");
        let local = worktree_state_dir(&linked).expect("local");
        assert_ne!(shared, local, "a linked worktree has two distinct dirs");
        assert!(shared.starts_with(main.canonicalize().expect("canonical main")));
    }
}
