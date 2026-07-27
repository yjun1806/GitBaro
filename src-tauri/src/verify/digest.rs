//! Content digests (contract §2.10).
//!
//! Two questions need a stable answer: "is the working tree still the one the
//! tests ran against?" (V11) and "is this diff still the one that was reviewed?"
//! (V13). Both are content hashes, and `git2::Oid::hash_object` / `hash_file`
//! already provide SHA-1 content hashing — no extra hashing crate is needed.
//!
//! The manifest algorithm is fixed by the contract down to the ordering so the
//! digest is reproducible across processes and machines.

use std::collections::BTreeMap;

use git2::{ObjectType, Oid, Repository, Status, StatusOptions};

use crate::error::AppError;

const ZERO_OID: &str = "0000000000000000000000000000000000000000";
/// Marks a path that exists in the index/HEAD but not on disk.
const DELETED: &str = "deleted";

/// Lines describing the working tree: the HEAD tree oid, then one
/// `"{path}\t{oid}"` per dirty or untracked file, sorted by path bytes.
///
/// The manifest grows with the number of *dirty* files, not with repository
/// size, so storing it alongside the evidence stays cheap.
pub fn worktree_manifest(repo: &Repository) -> Result<Vec<String>, AppError> {
    let head_tree = match repo.head() {
        Ok(head) => head
            .peel_to_tree()
            .map(|tree| tree.id().to_string())
            .unwrap_or_else(|_| ZERO_OID.to_string()),
        // Unborn HEAD (a fresh repository) is a normal state, not an error.
        Err(_) => ZERO_OID.to_string(),
    };

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false);

    let statuses = repo.statuses(Some(&mut options))?;
    let workdir = repo.workdir().map(|p| p.to_path_buf());

    let mut entries: Vec<String> = Vec::with_capacity(statuses.len());
    for entry in statuses.iter() {
        let Some(path) = entry.path() else {
            continue;
        };
        let oid = blob_oid(workdir.as_deref(), path, entry.status());
        entries.push(format!("{}\t{}", path, oid));
    }

    entries.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

    let mut manifest = Vec::with_capacity(entries.len() + 1);
    manifest.push(format!("HEAD\t{}", head_tree));
    manifest.extend(entries);
    Ok(manifest)
}

/// SHA-1 of the joined manifest — the value stored with a test run.
pub fn worktree_hash(repo: &Repository) -> Result<String, AppError> {
    let manifest = worktree_manifest(repo)?;
    Ok(hash_lines(&manifest))
}

/// SHA-1 of `lines` joined with `\n` and terminated with `\n`.
pub fn hash_lines(lines: &[String]) -> String {
    let mut joined = lines.join("\n");
    joined.push('\n');
    hash_bytes(joined.as_bytes())
}

/// Content hash of a diff text (V13 review invalidation).
pub fn diff_hash(diff_text: &str) -> String {
    hash_bytes(diff_text.as_bytes())
}

/// How many paths differ between two manifests. Feeds
/// `EvidenceFreshness::Stale { changed_files }`.
pub fn manifest_diff_count(before: &[String], after: &[String]) -> usize {
    let before = index_manifest(before);
    let after = index_manifest(after);

    let mut changed = 0usize;
    for (path, oid) in &before {
        if after.get(path) != Some(oid) {
            changed += 1;
        }
    }
    for path in after.keys() {
        if !before.contains_key(path) {
            changed += 1;
        }
    }
    changed
}

fn index_manifest(lines: &[String]) -> BTreeMap<&str, &str> {
    lines
        .iter()
        .filter_map(|line| line.split_once('\t'))
        .collect()
}

/// The working-tree blob oid of `path`, or `"deleted"` when it is gone.
fn blob_oid(workdir: Option<&std::path::Path>, path: &str, status: Status) -> String {
    if status.is_wt_deleted() || status.is_index_deleted() {
        return DELETED.to_string();
    }

    let Some(workdir) = workdir else {
        // A bare repository has no working tree to hash.
        return DELETED.to_string();
    };

    let absolute = workdir.join(path);
    match Oid::hash_file(ObjectType::Blob, &absolute) {
        Ok(oid) => oid.to_string(),
        // A file that vanished between `statuses()` and here is "deleted" for
        // digest purposes; the next scan will settle it.
        Err(_) => DELETED.to_string(),
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    match Oid::hash_object(ObjectType::Blob, bytes) {
        Ok(oid) => oid.to_string(),
        Err(e) => {
            tracing::warn!("[verify] hash_object failed: {}", e);
            ZERO_OID.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "gitbaro-digest-{}-{}-{}",
                tag,
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn write(&self, name: &str, body: &str) {
            std::fs::write(self.0.join(name), body).expect("write file");
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn diff_hash_is_stable_and_content_sensitive() {
        assert_eq!(diff_hash("+a\n"), diff_hash("+a\n"));
        assert_ne!(diff_hash("+a\n"), diff_hash("+b\n"));
    }

    #[test]
    fn worktree_hash_is_deterministic_and_order_independent() {
        let dir = TempDir::new("det");
        let repo = Repository::init(&dir.0).expect("init");
        dir.write("b.txt", "b");
        dir.write("a.txt", "a");

        let first = worktree_hash(&repo).expect("hash");
        let second = worktree_hash(&repo).expect("hash again");
        assert_eq!(first, second);

        let manifest = worktree_manifest(&repo).expect("manifest");
        assert!(manifest[0].starts_with("HEAD\t"));
        let paths: Vec<&str> = manifest[1..]
            .iter()
            .filter_map(|line| line.split_once('\t').map(|(p, _)| p))
            .collect();
        assert_eq!(paths, vec!["a.txt", "b.txt"], "sorted by path bytes");
    }

    #[test]
    fn changing_a_file_changes_the_hash() {
        let dir = TempDir::new("change");
        let repo = Repository::init(&dir.0).expect("init");
        dir.write("a.txt", "a");
        let before = worktree_hash(&repo).expect("hash");
        dir.write("a.txt", "aa");
        let after = worktree_hash(&repo).expect("hash");
        assert_ne!(before, after);
    }

    #[test]
    fn manifest_diff_count_sees_modified_added_and_removed_paths() {
        let before = vec![
            "HEAD\t1111111111111111111111111111111111111111".to_string(),
            "a.txt\taaaa".to_string(),
            "b.txt\tbbbb".to_string(),
        ];
        let after = vec![
            "HEAD\t1111111111111111111111111111111111111111".to_string(),
            "a.txt\tzzzz".to_string(),
            "c.txt\tcccc".to_string(),
        ];
        // a modified, b removed, c added.
        assert_eq!(manifest_diff_count(&before, &after), 3);
        assert_eq!(manifest_diff_count(&before, &before), 0);
    }
}
