//! V13 — per-file review state.
//!
//! A file counts as reviewed only while the diff the reviewer actually looked at
//! is still the diff on disk. The mark stores the content hash of that diff, so
//! any later edit flips the file back to `Stale` on its own — nothing has to
//! remember to invalidate anything, and there is no cache to go wrong.
//!
//! Marks are worktree-local: the same file has different pending changes in
//! different checkouts, so its review state must differ too.

use std::collections::BTreeMap;
use std::path::PathBuf;

use git2::Repository;
use tracing::debug;

use crate::error::AppError;
use crate::verify::digest::diff_hash;
use crate::verify::paths::worktree_state_dir;
use crate::verify::types::{FileReviewEntry, FileReviewMark, ReviewStatus};

use super::store::{load_json, save_json};
use super::{now_millis, reviewer_identity};

const FILE_REVIEW_FILE: &str = "file-review.json";

fn marks_path(repo: &Repository) -> Result<PathBuf, AppError> {
    Ok(worktree_state_dir(repo)?.join(FILE_REVIEW_FILE))
}

/// Every mark recorded in this worktree, sorted by path.
pub fn load_file_marks(repo: &Repository) -> Result<Vec<FileReviewMark>, AppError> {
    Ok(load_json::<Vec<FileReviewMark>>(&marks_path(repo)?))
}

/// The heart of V13: a mark is only worth something against the exact diff it
/// was taken on.
pub fn resolve_file_status(mark: Option<&FileReviewMark>, current_hash: &str) -> ReviewStatus {
    match mark {
        None => ReviewStatus::Unreviewed,
        Some(mark) if mark.reviewed_diff_hash == current_hash => ReviewStatus::Reviewed,
        Some(_) => ReviewStatus::Stale,
    }
}

/// Build the entry the UI renders for one file.
///
/// `Stale` keeps the old attribution on purpose, so the UI can say "you
/// reviewed this at T and it changed after that". `Unreviewed` carries none.
pub fn file_review_entry(
    path: &str,
    mark: Option<&FileReviewMark>,
    current_hash: &str,
) -> FileReviewEntry {
    let status = resolve_file_status(mark, current_hash);
    let attribution = match status {
        ReviewStatus::Unreviewed => None,
        _ => mark,
    };

    FileReviewEntry {
        path: path.to_string(),
        status,
        reviewed_at: attribution.map(|m| m.reviewed_at),
        reviewer: attribution.map(|m| m.reviewer.clone()),
    }
}

/// Review state for a set of files.
///
/// `current_hashes` maps a repository-relative path to the
/// [`diff_hash`](crate::verify::digest::diff_hash) of that file's *current*
/// diff — the caller computes the diff, this module never does. Its key set
/// decides which files are reported, and its ordering makes the result stable.
pub fn file_review_states(
    repo: &Repository,
    current_hashes: &BTreeMap<String, String>,
) -> Result<Vec<FileReviewEntry>, AppError> {
    let marks = load_file_marks(repo)?;
    let by_path: BTreeMap<&str, &FileReviewMark> =
        marks.iter().map(|m| (m.path.as_str(), m)).collect();

    Ok(current_hashes
        .iter()
        .map(|(path, hash)| {
            file_review_entry(path, by_path.get(path.as_str()).copied(), hash)
        })
        .collect())
}

/// Record that `path` was reviewed at the diff currently in `diff_text`.
///
/// The hash is computed here rather than accepted from the caller so a mark can
/// never be written against a hash produced by a different algorithm.
pub fn mark_file_reviewed(
    repo: &Repository,
    path: &str,
    diff_text: &str,
) -> Result<FileReviewEntry, AppError> {
    let mark = FileReviewMark {
        path: path.to_string(),
        reviewed_diff_hash: diff_hash(diff_text),
        reviewed_at: now_millis(),
        reviewer: reviewer_identity(repo),
    };

    let mut next: Vec<FileReviewMark> = load_file_marks(repo)?
        .into_iter()
        .filter(|m| m.path != path)
        .collect();
    next.push(mark.clone());
    next.sort_by(|a, b| a.path.cmp(&b.path));

    save_json(&marks_path(repo)?, &next)?;
    debug!("[verify] file marked reviewed: {}", path);

    Ok(file_review_entry(path, Some(&mark), &mark.reviewed_diff_hash))
}

/// Drop the mark for `path`. Unmarking a file that was never marked is a no-op.
pub fn unmark_file_reviewed(repo: &Repository, path: &str) -> Result<(), AppError> {
    let existing = load_file_marks(repo)?;
    let next: Vec<FileReviewMark> = existing
        .iter()
        .filter(|m| m.path != path)
        .cloned()
        .collect();

    if next.len() == existing.len() {
        return Ok(());
    }

    save_json(&marks_path(repo)?, &next)?;
    debug!("[verify] file review mark cleared: {}", path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::review::test_support::TempRepo;

    const DIFF_A: &str = "@@ -1 +1 @@\n-old\n+new\n";
    const DIFF_B: &str = "@@ -1 +1 @@\n-old\n+newer\n";

    fn mark(path: &str, hash: &str) -> FileReviewMark {
        FileReviewMark {
            path: path.to_string(),
            reviewed_diff_hash: hash.to_string(),
            reviewed_at: 1_700_000_000_000,
            reviewer: "Review Tester <review@example.com>".to_string(),
        }
    }

    fn hashes(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(path, text)| (path.to_string(), diff_hash(text)))
            .collect()
    }

    #[test]
    fn unmarked_file_is_unreviewed() {
        assert_eq!(resolve_file_status(None, "abc"), ReviewStatus::Unreviewed);
    }

    #[test]
    fn matching_hash_is_reviewed() {
        let mark = mark("a.ts", "abc");
        assert_eq!(
            resolve_file_status(Some(&mark), "abc"),
            ReviewStatus::Reviewed
        );
    }

    #[test]
    fn changed_hash_is_stale() {
        let mark = mark("a.ts", "abc");
        assert_eq!(
            resolve_file_status(Some(&mark), "def"),
            ReviewStatus::Stale
        );
    }

    #[test]
    fn unreviewed_entry_carries_no_attribution() {
        let entry = file_review_entry("a.ts", None, "abc");

        assert_eq!(entry.status, ReviewStatus::Unreviewed);
        assert!(entry.reviewed_at.is_none());
        assert!(entry.reviewer.is_none());
    }

    #[test]
    fn stale_entry_keeps_previous_attribution() {
        let previous = mark("a.ts", "abc");
        let entry = file_review_entry("a.ts", Some(&previous), "def");

        assert_eq!(entry.status, ReviewStatus::Stale);
        assert_eq!(entry.reviewed_at, Some(1_700_000_000_000));
        assert_eq!(
            entry.reviewer.as_deref(),
            Some("Review Tester <review@example.com>")
        );
    }

    #[test]
    fn marking_a_file_makes_the_same_diff_reviewed() {
        let temp = TempRepo::new("file-mark");
        let repo = temp.open();

        let marked = mark_file_reviewed(&repo, "src/a.ts", DIFF_A).expect("mark");
        assert_eq!(marked.status, ReviewStatus::Reviewed);

        let states =
            file_review_states(&repo, &hashes(&[("src/a.ts", DIFF_A)])).expect("states");

        assert_eq!(states.len(), 1);
        assert_eq!(states[0].status, ReviewStatus::Reviewed);
        assert_eq!(
            states[0].reviewer.as_deref(),
            Some("Review Tester <review@example.com>")
        );
    }

    #[test]
    fn changing_the_diff_returns_the_file_to_stale() {
        let temp = TempRepo::new("file-stale");
        let repo = temp.open();

        mark_file_reviewed(&repo, "src/a.ts", DIFF_A).expect("mark");

        let states =
            file_review_states(&repo, &hashes(&[("src/a.ts", DIFF_B)])).expect("states");

        assert_eq!(states[0].status, ReviewStatus::Stale);
        assert!(states[0].reviewed_at.is_some());
    }

    #[test]
    fn re_marking_the_changed_diff_makes_it_reviewed_again() {
        let temp = TempRepo::new("file-remark");
        let repo = temp.open();

        mark_file_reviewed(&repo, "src/a.ts", DIFF_A).expect("mark");
        mark_file_reviewed(&repo, "src/a.ts", DIFF_B).expect("re-mark");

        let states =
            file_review_states(&repo, &hashes(&[("src/a.ts", DIFF_B)])).expect("states");

        assert_eq!(states[0].status, ReviewStatus::Reviewed);
        assert_eq!(load_file_marks(&repo).expect("marks").len(), 1);
    }

    #[test]
    fn unmarking_returns_the_file_to_unreviewed() {
        let temp = TempRepo::new("file-unmark");
        let repo = temp.open();

        mark_file_reviewed(&repo, "src/a.ts", DIFF_A).expect("mark");
        unmark_file_reviewed(&repo, "src/a.ts").expect("unmark");

        let states =
            file_review_states(&repo, &hashes(&[("src/a.ts", DIFF_A)])).expect("states");

        assert_eq!(states[0].status, ReviewStatus::Unreviewed);
        assert!(load_file_marks(&repo).expect("marks").is_empty());
    }

    #[test]
    fn unmarking_an_unknown_file_is_a_no_op() {
        let temp = TempRepo::new("file-unmark-missing");
        let repo = temp.open();

        unmark_file_reviewed(&repo, "src/never.ts").expect("unmark");
    }

    #[test]
    fn states_are_reported_for_every_requested_file() {
        let temp = TempRepo::new("file-many");
        let repo = temp.open();

        mark_file_reviewed(&repo, "src/a.ts", DIFF_A).expect("mark");

        let states = file_review_states(
            &repo,
            &hashes(&[("src/a.ts", DIFF_A), ("src/b.ts", DIFF_B)]),
        )
        .expect("states");

        assert_eq!(states.len(), 2);
        assert_eq!(states[0].path, "src/a.ts");
        assert_eq!(states[0].status, ReviewStatus::Reviewed);
        assert_eq!(states[1].path, "src/b.ts");
        assert_eq!(states[1].status, ReviewStatus::Unreviewed);
    }

    #[test]
    fn marks_survive_a_reopen_of_the_repository() {
        let temp = TempRepo::new("file-persist");
        mark_file_reviewed(&temp.open(), "src/a.ts", DIFF_A).expect("mark");

        let states = file_review_states(&temp.open(), &hashes(&[("src/a.ts", DIFF_A)]))
            .expect("states");

        assert_eq!(states[0].status, ReviewStatus::Reviewed);
    }
}
