//! Hermetic git fixtures for the hygiene tests.
//!
//! Commits are built straight into the object database through an in-memory
//! index, so no checkout, no working-tree writes, and no `git` binary are
//! involved. The repository lives in a uniquely named directory under the
//! system temp dir and is removed on drop.

use std::path::PathBuf;

use git2::{Commit, IndexEntry, IndexTime, Oid, Repository};

pub struct TempRepo {
    pub dir: PathBuf,
    pub repo: Repository,
}

impl TempRepo {
    pub fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("gitbaro-hygiene-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let repo = Repository::init(&dir).expect("init repo");
        {
            let mut config = repo.config().expect("repo config");
            config.set_str("user.name", "Test User").expect("user.name");
            config
                .set_str("user.email", "test@example.com")
                .expect("user.email");
        }
        Self { dir, repo }
    }

    /// Commit on top of the current HEAD (root commit if HEAD is unborn) and
    /// move HEAD to it.
    pub fn commit(&self, message: &str, files: &[(&str, &str)]) -> Oid {
        let parent = self
            .repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok())
            .map(|commit| commit.id());
        let parents: Vec<Oid> = parent.into_iter().collect();
        self.write_commit(&parents, message, files, true)
    }

    /// Commit on top of an explicit parent without moving HEAD — used to build
    /// a side branch.
    pub fn commit_on(&self, parent: Oid, message: &str, files: &[(&str, &str)]) -> Oid {
        self.write_commit(&[parent], message, files, false)
    }

    /// Two-parent commit carrying `first`'s tree. Moves HEAD to it.
    pub fn merge_commit(&self, first: Oid, second: Oid, message: &str) -> Oid {
        let tree = self
            .repo
            .find_commit(first)
            .expect("first parent")
            .tree()
            .expect("first parent tree")
            .id();
        self.commit_tree(&[first, second], message, tree, true)
    }

    /// Point a remote-tracking ref (`origin/main` shorthand) at a commit.
    pub fn set_remote_ref(&self, shorthand: &str, oid: Oid) {
        self.repo
            .reference(
                &format!("refs/remotes/{}", shorthand),
                oid,
                true,
                "test fixture",
            )
            .expect("create remote-tracking ref");
    }

    fn write_commit(
        &self,
        parents: &[Oid],
        message: &str,
        files: &[(&str, &str)],
        update_head: bool,
    ) -> Oid {
        let tree = self.build_tree(parents.first().copied(), files);
        self.commit_tree(parents, message, tree, update_head)
    }

    fn build_tree(&self, parent: Option<Oid>, files: &[(&str, &str)]) -> Oid {
        let mut index = git2::Index::new().expect("in-memory index");
        if let Some(parent) = parent {
            let tree = self
                .repo
                .find_commit(parent)
                .expect("parent commit")
                .tree()
                .expect("parent tree");
            index.read_tree(&tree).expect("read parent tree");
        }
        for (path, content) in files {
            let blob = self.repo.blob(content.as_bytes()).expect("write blob");
            index
                .add(&IndexEntry {
                    ctime: IndexTime::new(0, 0),
                    mtime: IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: 0o100644,
                    uid: 0,
                    gid: 0,
                    file_size: content.len() as u32,
                    id: blob,
                    flags: 0,
                    flags_extended: 0,
                    path: path.as_bytes().to_vec(),
                })
                .expect("add index entry");
        }
        index.write_tree_to(&self.repo).expect("write tree")
    }

    fn commit_tree(&self, parents: &[Oid], message: &str, tree: Oid, update_head: bool) -> Oid {
        let signature = git2::Signature::now("Test User", "test@example.com").expect("signature");
        let tree = self.repo.find_tree(tree).expect("find tree");
        let parent_commits: Vec<Commit<'_>> = parents
            .iter()
            .map(|oid| self.repo.find_commit(*oid).expect("parent commit"))
            .collect();
        let parent_refs: Vec<&Commit<'_>> = parent_commits.iter().collect();
        self.repo
            .commit(
                update_head.then_some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &parent_refs,
            )
            .expect("write commit")
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
