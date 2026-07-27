//! V34 — the data behind the pre-push review prompt.
//!
//! **This never blocks and never returns a verdict.** It counts what is about to
//! leave the machine and hands the counts to the UI, which keeps the push button
//! enabled. A gate people cannot pass is a gate people learn to route around,
//! and then the counts stop being read at all.
//!
//! This module deliberately knows nothing about how findings are produced: the
//! command layer joins the commits ahead of the upstream with whatever the
//! verification pass already computed and passes the result in.

use std::collections::BTreeMap;

use crate::verify::types::{
    CommitReviewState, PushGateCommit, PushGateSummary, ReviewStatus, Severity,
};

/// A commit touching this many files is hard to revert cleanly (V31).
pub const TANGLED_FILE_THRESHOLD: usize = 15;

/// One commit ahead of the upstream, joined with its verification counters.
#[derive(Clone, Debug)]
pub struct PushGateInput {
    pub commit_id: String,
    /// Commit subject line.
    pub summary: String,
    pub files_changed: usize,
    /// Highest severity among this commit's findings. `None` means "no findings
    /// were produced", which is not the same as "safe".
    pub max_severity: Option<Severity>,
    pub finding_count: usize,
}

/// Summarise the commits about to be pushed.
///
/// The counts are *commit* counts, not finding counts: "3 commits carry a
/// danger-severity finding" is the sentence the UI needs.
pub fn push_gate_summary(
    inputs: &[PushGateInput],
    reviewed: &BTreeMap<String, CommitReviewState>,
) -> PushGateSummary {
    let commits: Vec<PushGateCommit> = inputs
        .iter()
        .map(|input| PushGateCommit {
            commit_id: input.commit_id.clone(),
            summary: input.summary.clone(),
            review_status: review_status_of(&input.commit_id, reviewed),
            files_changed: input.files_changed,
            max_severity: input.max_severity,
            finding_count: input.finding_count,
        })
        .collect();

    let unreviewed_count = commits
        .iter()
        .filter(|c| c.review_status != ReviewStatus::Reviewed)
        .count();
    let danger_count = commits
        .iter()
        .filter(|c| c.max_severity == Some(Severity::Danger))
        .count();
    let warn_count = commits
        .iter()
        .filter(|c| c.max_severity == Some(Severity::Warn))
        .count();
    let tangled_count = commits
        .iter()
        .filter(|c| c.files_changed >= TANGLED_FILE_THRESHOLD)
        .count();

    PushGateSummary {
        commits,
        unreviewed_count,
        danger_count,
        warn_count,
        tangled_count,
    }
}

/// A commit is immutable, so it is either reviewed or not — never stale.
fn review_status_of(
    commit_id: &str,
    reviewed: &BTreeMap<String, CommitReviewState>,
) -> ReviewStatus {
    match reviewed.get(commit_id) {
        Some(state) if state.status == ReviewStatus::Reviewed => ReviewStatus::Reviewed,
        _ => ReviewStatus::Unreviewed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(
        commit_id: &str,
        files_changed: usize,
        max_severity: Option<Severity>,
        finding_count: usize,
    ) -> PushGateInput {
        PushGateInput {
            commit_id: commit_id.to_string(),
            summary: format!("subject of {}", commit_id),
            files_changed,
            max_severity,
            finding_count,
        }
    }

    fn reviewed(ids: &[&str]) -> BTreeMap<String, CommitReviewState> {
        ids.iter()
            .map(|id| {
                (
                    id.to_string(),
                    CommitReviewState {
                        commit_id: id.to_string(),
                        status: ReviewStatus::Reviewed,
                        reviewed_at: Some(1),
                        reviewer: Some("Review Tester <review@example.com>".to_string()),
                    },
                )
            })
            .collect()
    }

    #[test]
    fn empty_push_summarises_to_zeroes() {
        let summary = push_gate_summary(&[], &BTreeMap::new());

        assert!(summary.commits.is_empty());
        assert_eq!(summary.unreviewed_count, 0);
        assert_eq!(summary.danger_count, 0);
        assert_eq!(summary.warn_count, 0);
        assert_eq!(summary.tangled_count, 0);
    }

    #[test]
    fn counts_unreviewed_commits() {
        let inputs = [
            input("c1", 1, None, 0),
            input("c2", 1, None, 0),
            input("c3", 1, None, 0),
        ];

        let summary = push_gate_summary(&inputs, &reviewed(&["c2"]));

        assert_eq!(summary.unreviewed_count, 2);
        assert_eq!(summary.commits[1].review_status, ReviewStatus::Reviewed);
        assert_eq!(summary.commits[0].review_status, ReviewStatus::Unreviewed);
    }

    #[test]
    fn counts_commits_by_their_highest_severity() {
        let inputs = [
            input("c1", 1, Some(Severity::Danger), 4),
            input("c2", 1, Some(Severity::Warn), 2),
            input("c3", 1, Some(Severity::Info), 1),
            input("c4", 1, None, 0),
        ];

        let summary = push_gate_summary(&inputs, &BTreeMap::new());

        assert_eq!(summary.danger_count, 1);
        assert_eq!(summary.warn_count, 1);
        assert_eq!(summary.commits.len(), 4);
    }

    #[test]
    fn counts_tangled_commits_at_the_threshold() {
        let inputs = [
            input("c1", TANGLED_FILE_THRESHOLD - 1, None, 0),
            input("c2", TANGLED_FILE_THRESHOLD, None, 0),
            input("c3", TANGLED_FILE_THRESHOLD + 5, None, 0),
        ];

        let summary = push_gate_summary(&inputs, &BTreeMap::new());

        assert_eq!(summary.tangled_count, 2);
    }

    #[test]
    fn commit_order_is_preserved() {
        let inputs = [input("c1", 1, None, 0), input("c2", 1, None, 0)];

        let summary = push_gate_summary(&inputs, &BTreeMap::new());

        assert_eq!(summary.commits[0].commit_id, "c1");
        assert_eq!(summary.commits[1].commit_id, "c2");
        assert_eq!(summary.commits[0].summary, "subject of c1");
    }
}
