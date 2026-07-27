//! V29 — per-commit review state and the "what landed since I last looked"
//! queue, which is the primary post-commit surface.
//!
//! A commit is immutable, so a commit mark can never go `Stale`; only files
//! (V13) have that problem. Marks are shared across worktrees because "I have
//! read this commit" is a fact about the commit, not about a checkout.
//!
//! Only reviewed commits are stored. The absence of an entry *is* the
//! unreviewed state, which keeps the document proportional to what was actually
//! reviewed instead of to the size of the history.

use std::collections::BTreeMap;
use std::path::PathBuf;

use git2::{Oid, Repository, Sort};
use tracing::debug;

use crate::error::AppError;
use crate::git::commit::validate_commit_oid;
use crate::verify::paths::shared_state_dir;
use crate::verify::types::{CommitReviewState, ReviewQueue, ReviewStatus};

use super::store::{load_json, save_json};
use super::{now_millis, reviewer_identity};

const COMMIT_REVIEW_FILE: &str = "commit-review.json";

/// How many ids the queue returns when the caller does not say.
pub const DEFAULT_QUEUE_LIMIT: usize = 50;

/// Hard ceiling on the revision walk, so a repository where nothing has ever
/// been reviewed cannot turn one query into a full-history traversal.
pub const MAX_QUEUE_WALK: usize = 500;

fn reviews_path(repo: &Repository) -> Result<PathBuf, AppError> {
    Ok(shared_state_dir(repo)?.join(COMMIT_REVIEW_FILE))
}

/// Every stored commit mark.
pub fn load_commit_reviews(repo: &Repository) -> Result<Vec<CommitReviewState>, AppError> {
    Ok(load_json::<Vec<CommitReviewState>>(&reviews_path(repo)?))
}

/// Reviewed commits keyed by full commit id.
///
/// Anything that is not `Reviewed` is dropped on the way in: only reviewed
/// commits are supposed to be persisted, and a hand-edited document must not be
/// able to invent a third state.
pub fn reviewed_commit_map(
    repo: &Repository,
) -> Result<BTreeMap<String, CommitReviewState>, AppError> {
    Ok(load_commit_reviews(repo)?
        .into_iter()
        .filter(|state| state.status == ReviewStatus::Reviewed)
        .map(|state| (state.commit_id.clone(), state))
        .collect())
}

/// Review state for each requested commit, in the order requested.
///
/// `oids` are expected to be the full ids the history query returns; an
/// abbreviated id will not match a stored mark.
pub fn get_commit_review_states(
    repo: &Repository,
    oids: &[String],
) -> Result<Vec<CommitReviewState>, AppError> {
    let reviewed = reviewed_commit_map(repo)?;

    Ok(oids
        .iter()
        .map(|oid| {
            reviewed
                .get(oid)
                .cloned()
                .unwrap_or_else(|| unreviewed(oid))
        })
        .collect())
}

pub fn mark_commit_reviewed(
    repo: &Repository,
    oid: &str,
) -> Result<CommitReviewState, AppError> {
    let commit_id = resolve_commit_id(repo, oid)?;
    let state = CommitReviewState {
        commit_id: commit_id.clone(),
        status: ReviewStatus::Reviewed,
        reviewed_at: Some(now_millis()),
        reviewer: Some(reviewer_identity(repo)),
    };

    let mut next: Vec<CommitReviewState> = load_commit_reviews(repo)?
        .into_iter()
        .filter(|s| s.commit_id != commit_id)
        .collect();
    next.push(state.clone());
    next.sort_by(|a, b| a.commit_id.cmp(&b.commit_id));

    save_json(&reviews_path(repo)?, &next)?;
    debug!("[verify] commit marked reviewed: {}", commit_id);

    Ok(state)
}

/// Drop the mark for a commit. Unmarking an unreviewed commit is a no-op.
pub fn unmark_commit_reviewed(repo: &Repository, oid: &str) -> Result<(), AppError> {
    let commit_id = resolve_commit_id(repo, oid)?;

    let existing = load_commit_reviews(repo)?;
    let next: Vec<CommitReviewState> = existing
        .iter()
        .filter(|s| s.commit_id != commit_id)
        .cloned()
        .collect();

    if next.len() == existing.len() {
        return Ok(());
    }

    save_json(&reviews_path(repo)?, &next)?;
    debug!("[verify] commit review mark cleared: {}", commit_id);
    Ok(())
}

/// V29 — the commits on the current branch that landed after the last reviewed
/// point, newest first.
///
/// The walk stops at the first reviewed ancestor: that commit *is* the
/// "last reviewed point", and everything older was reachable from it.
pub fn review_queue(repo: &Repository, limit: Option<usize>) -> Result<ReviewQueue, AppError> {
    let limit = limit.unwrap_or(DEFAULT_QUEUE_LIMIT);

    // An unborn HEAD is a fresh repository, not an error.
    if repo.head().is_err() {
        return Ok(empty_queue());
    }

    let reviewed = reviewed_commit_map(repo)?;

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    walk.push_head()?;

    let ids = walk.filter_map(Result::ok).map(|oid| oid.to_string());

    Ok(queue_from_walk(ids, &reviewed, limit, MAX_QUEUE_WALK))
}

/// The pure half of [`review_queue`]: fold a newest-first id stream into the
/// queue. Separated so the stop/limit/cap rules can be tested without a walk.
pub fn queue_from_walk<I>(
    walked: I,
    reviewed: &BTreeMap<String, CommitReviewState>,
    limit: usize,
    max_walk: usize,
) -> ReviewQueue
where
    I: IntoIterator<Item = String>,
{
    let mut unreviewed_commit_ids = Vec::new();
    let mut total_unreviewed = 0usize;
    let mut last_reviewed_at = None;
    let mut reached_reviewed = false;
    let mut walked_count = 0usize;

    for commit_id in walked {
        if walked_count >= max_walk {
            break;
        }
        walked_count += 1;

        if let Some(state) = reviewed.get(&commit_id) {
            last_reviewed_at = state.reviewed_at;
            reached_reviewed = true;
            break;
        }

        total_unreviewed += 1;
        if unreviewed_commit_ids.len() < limit {
            unreviewed_commit_ids.push(commit_id);
        }
    }

    // Truncated either because the id list was cut at `limit`, or because the
    // walk hit its ceiling before finding a reviewed point — in the second case
    // `total_unreviewed` is a lower bound, and the UI must say so.
    let truncated =
        total_unreviewed > unreviewed_commit_ids.len() || (!reached_reviewed && walked_count >= max_walk);

    ReviewQueue {
        unreviewed_commit_ids,
        total_unreviewed,
        truncated,
        last_reviewed_at,
    }
}

/// Full 40-character id for a possibly abbreviated commit id.
///
/// `validate_commit_oid` runs first so a revision *expression* (`HEAD~1`,
/// `:/fix`) can never reach `revparse_single`.
pub(crate) fn resolve_commit_oid(repo: &Repository, oid: &str) -> Result<Oid, AppError> {
    validate_commit_oid(oid)?;
    Ok(repo.revparse_single(oid)?.peel_to_commit()?.id())
}

pub(crate) fn resolve_commit_id(repo: &Repository, oid: &str) -> Result<String, AppError> {
    Ok(resolve_commit_oid(repo, oid)?.to_string())
}

fn unreviewed(commit_id: &str) -> CommitReviewState {
    CommitReviewState {
        commit_id: commit_id.to_string(),
        status: ReviewStatus::Unreviewed,
        reviewed_at: None,
        reviewer: None,
    }
}

fn empty_queue() -> ReviewQueue {
    ReviewQueue {
        unreviewed_commit_ids: Vec::new(),
        total_unreviewed: 0,
        truncated: false,
        last_reviewed_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::review::test_support::{commit, TempRepo};

    fn reviewed_map(entries: &[(&str, i64)]) -> BTreeMap<String, CommitReviewState> {
        entries
            .iter()
            .map(|(id, at)| {
                (
                    id.to_string(),
                    CommitReviewState {
                        commit_id: id.to_string(),
                        status: ReviewStatus::Reviewed,
                        reviewed_at: Some(*at),
                        reviewer: Some("Review Tester <review@example.com>".to_string()),
                    },
                )
            })
            .collect()
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn queue_stops_at_the_last_reviewed_commit() {
        let queue = queue_from_walk(
            ids(&["c3", "c2", "c1"]),
            &reviewed_map(&[("c1", 42)]),
            10,
            100,
        );

        assert_eq!(queue.unreviewed_commit_ids, ids(&["c3", "c2"]));
        assert_eq!(queue.total_unreviewed, 2);
        assert!(!queue.truncated);
        assert_eq!(queue.last_reviewed_at, Some(42));
    }

    #[test]
    fn queue_with_nothing_reviewed_reports_every_walked_commit() {
        let queue = queue_from_walk(ids(&["c3", "c2", "c1"]), &BTreeMap::new(), 10, 100);

        assert_eq!(queue.total_unreviewed, 3);
        assert!(!queue.truncated);
        assert_eq!(queue.last_reviewed_at, None);
    }

    #[test]
    fn queue_truncates_the_id_list_but_keeps_the_true_total() {
        let queue = queue_from_walk(ids(&["c4", "c3", "c2", "c1"]), &BTreeMap::new(), 2, 100);

        assert_eq!(queue.unreviewed_commit_ids, ids(&["c4", "c3"]));
        assert_eq!(queue.total_unreviewed, 4);
        assert!(queue.truncated);
    }

    #[test]
    fn queue_marks_truncated_when_the_walk_ceiling_is_hit() {
        let queue = queue_from_walk(ids(&["c3", "c2", "c1"]), &BTreeMap::new(), 10, 2);

        assert_eq!(queue.total_unreviewed, 2);
        assert!(queue.truncated);
        assert_eq!(queue.last_reviewed_at, None);
    }

    #[test]
    fn queue_is_empty_when_the_newest_commit_is_already_reviewed() {
        let queue = queue_from_walk(ids(&["c3", "c2"]), &reviewed_map(&[("c3", 7)]), 10, 100);

        assert!(queue.unreviewed_commit_ids.is_empty());
        assert_eq!(queue.total_unreviewed, 0);
        assert!(!queue.truncated);
        assert_eq!(queue.last_reviewed_at, Some(7));
    }

    #[test]
    fn unknown_commits_report_as_unreviewed() {
        let temp = TempRepo::new("commit-unknown");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        let states =
            get_commit_review_states(&repo, std::slice::from_ref(&oid)).expect("states");

        assert_eq!(states.len(), 1);
        assert_eq!(states[0].commit_id, oid);
        assert_eq!(states[0].status, ReviewStatus::Unreviewed);
        assert!(states[0].reviewed_at.is_none());
    }

    #[test]
    fn marking_a_commit_persists_reviewed_state() {
        let temp = TempRepo::new("commit-mark");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        let marked = mark_commit_reviewed(&repo, &oid).expect("mark");
        assert_eq!(marked.status, ReviewStatus::Reviewed);
        assert!(marked.reviewed_at.is_some());

        let states = get_commit_review_states(&temp.open(), &[oid]).expect("states");
        assert_eq!(states[0].status, ReviewStatus::Reviewed);
        assert_eq!(
            states[0].reviewer.as_deref(),
            Some("Review Tester <review@example.com>")
        );
    }

    #[test]
    fn commit_review_never_becomes_stale() {
        let temp = TempRepo::new("commit-immutable");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        mark_commit_reviewed(&repo, &oid).expect("mark");
        // Later work in the repository cannot change an existing commit.
        commit(&repo, "b.txt", "b");

        let states = get_commit_review_states(&repo, &[oid]).expect("states");
        assert_eq!(states[0].status, ReviewStatus::Reviewed);
    }

    #[test]
    fn unmarking_a_commit_clears_it() {
        let temp = TempRepo::new("commit-unmark");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        mark_commit_reviewed(&repo, &oid).expect("mark");
        unmark_commit_reviewed(&repo, &oid).expect("unmark");

        let states = get_commit_review_states(&repo, &[oid]).expect("states");
        assert_eq!(states[0].status, ReviewStatus::Unreviewed);
        assert!(load_commit_reviews(&repo).expect("reviews").is_empty());
    }

    #[test]
    fn marking_an_abbreviated_id_stores_the_full_id() {
        let temp = TempRepo::new("commit-short");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        let marked = mark_commit_reviewed(&repo, &oid[..8]).expect("mark");

        assert_eq!(marked.commit_id, oid);
    }

    #[test]
    fn revision_expressions_are_rejected() {
        let temp = TempRepo::new("commit-expr");
        let repo = temp.open();
        commit(&repo, "a.txt", "a");

        assert!(mark_commit_reviewed(&repo, "HEAD").is_err());
        assert!(mark_commit_reviewed(&repo, "HEAD~1").is_err());
    }

    #[test]
    fn queue_walks_real_history_and_stops_at_the_reviewed_commit() {
        let temp = TempRepo::new("commit-queue");
        let repo = temp.open();
        let first = commit(&repo, "a.txt", "a").to_string();
        let second = commit(&repo, "b.txt", "b").to_string();
        let third = commit(&repo, "c.txt", "c").to_string();

        mark_commit_reviewed(&repo, &first).expect("mark");

        let queue = review_queue(&repo, None).expect("queue");

        assert_eq!(queue.unreviewed_commit_ids, vec![third, second]);
        assert_eq!(queue.total_unreviewed, 2);
        assert!(!queue.truncated);
        assert!(queue.last_reviewed_at.is_some());
    }

    #[test]
    fn queue_on_an_unborn_head_is_empty() {
        let temp = TempRepo::new("commit-unborn");
        let repo = temp.open();

        let queue = review_queue(&repo, None).expect("queue");

        assert!(queue.unreviewed_commit_ids.is_empty());
        assert_eq!(queue.total_unreviewed, 0);
    }
}
