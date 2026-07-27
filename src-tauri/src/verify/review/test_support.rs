//! Hermetic git fixtures for the review tests.
//!
//! No new crates: a repository is created directly in the system temp
//! directory and removed on drop, matching the pattern already used by
//! `commands/history.rs`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use git2::{Oid, Repository, Signature};

static COUNTER: AtomicU32 = AtomicU32::new(0);

pub struct TempRepo {
    path: PathBuf,
}

impl TempRepo {
    /// A fresh non-bare repository with a committed identity, so
    /// `repo.signature()` succeeds regardless of the machine's global config.
    pub fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "gitbaro-review-test-{}-{}-{}",
            tag,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");

        let repo = Repository::init(&path).expect("init repo");
        let mut config = repo.config().expect("open config");
        config.set_str("user.name", "Review Tester").expect("set name");
        config
            .set_str("user.email", "review@example.com")
            .expect("set email");

        TempRepo { path }
    }

    pub fn open(&self) -> Repository {
        Repository::open(&self.path).expect("open repo")
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Write `content` to `file` and commit it on top of HEAD.
pub fn commit(repo: &Repository, file: &str, content: &str) -> Oid {
    let workdir = repo.workdir().expect("non-bare repo");
    std::fs::write(workdir.join(file), content).expect("write file");

    let mut index = repo.index().expect("open index");
    index.add_path(Path::new(file)).expect("stage file");
    index.write().expect("write index");

    let tree_oid = index.write_tree().expect("write tree");
    let tree = repo.find_tree(tree_oid).expect("find tree");
    let sig = Signature::now("Review Tester", "review@example.com").expect("signature");
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();

    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("commit {}", file),
        &tree,
        &parents,
    )
    .expect("commit")
}
