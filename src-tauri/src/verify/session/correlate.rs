//! V30 — session ↔ commit correlation.
//!
//! This file does no grading of its own. It fans every (session, commit) pair
//! out to [`attribution::grade_pair`], lets [`attribution::arbitrate`] settle
//! commits two sessions both claim, and then folds the surviving verdicts into
//! one [`SessionCommitLink`] per session.
//!
//! Three properties the fold guarantees, because the previous implementation
//! got each of them wrong (contract §5.1):
//!
//! * A candidate graded `Low` is **removed** from the link, not kept while
//!   dragging the grade down. `confidence` is the **best** surviving commit.
//! * A session with no surviving commit produces no link at all. "Unknown" is
//!   the honest answer; a guess is not.
//! * Every dropped candidate that was close enough to consider is listed in
//!   `rejected` with its reason, so the UI can explain the absence.

use std::collections::{BTreeMap, BTreeSet};

use crate::verify::types::{
    CommitLinkDetail, LinkConfidence, RejectedCommit, SessionCommitLink, SessionSummary,
    MAX_REJECTED_COMMITS,
};

use super::attribution::{self, Claim, PairVerdict, SessionFacts};

// Correlation inputs are declared in `attribution`, but callers reach for them
// alongside `correlate` — re-exported so they need only one import.
pub use super::attribution::{AttributionContext, CommitFacts};

/// Correlate sessions to commits.
///
/// Sessions with no plausible commit are omitted entirely — an empty link list
/// is the correct answer when nothing lines up.
pub fn correlate(
    ctx: &AttributionContext,
    sessions: &[SessionSummary],
    commits: &[CommitFacts],
) -> Vec<SessionCommitLink> {
    let facts: Vec<SessionFacts<'_>> = sessions
        .iter()
        .map(|s| SessionFacts::new(ctx, s))
        .collect();

    // Grade every pair, then index the attributed ones by commit so parallel
    // sessions can be arbitrated before anything is reported.
    let mut verdicts: Vec<Vec<PairVerdict>> = Vec::with_capacity(facts.len());
    for session in &facts {
        verdicts.push(
            commits
                .iter()
                .map(|commit| attribution::grade_pair(ctx, session, commit))
                .collect(),
        );
    }

    let mut by_commit: BTreeMap<String, Vec<Claim>> = BTreeMap::new();
    for (index, session_verdicts) in verdicts.iter().enumerate() {
        for verdict in session_verdicts {
            if verdict.is_attributed() {
                by_commit
                    .entry(verdict.commit_id.clone())
                    .or_default()
                    .push(Claim {
                        session: index,
                        verdict: verdict.clone(),
                    });
            }
        }
    }

    attribution::arbitrate(&facts, &mut by_commit);

    // Fold the arbitration outcome back onto the per-session verdicts.
    let settled: BTreeMap<(usize, String), PairVerdict> = by_commit
        .into_values()
        .flatten()
        .map(|claim| ((claim.session, claim.verdict.commit_id.clone()), claim.verdict))
        .collect();

    facts
        .iter()
        .enumerate()
        .filter_map(|(index, session)| {
            let final_verdicts: Vec<PairVerdict> = verdicts[index]
                .iter()
                .map(|verdict| {
                    settled
                        .get(&(index, verdict.commit_id.clone()))
                        .cloned()
                        .unwrap_or_else(|| verdict.clone())
                })
                .collect();
            link_for(session.summary, final_verdicts)
        })
        .collect()
}

fn link_for(session: &SessionSummary, verdicts: Vec<PairVerdict>) -> Option<SessionCommitLink> {
    let (attributed, dropped): (Vec<PairVerdict>, Vec<PairVerdict>) =
        verdicts.into_iter().partition(PairVerdict::is_attributed);

    if attributed.is_empty() {
        return None;
    }

    let confidence = attributed
        .iter()
        .map(|v| v.confidence)
        .max()
        .unwrap_or(LinkConfidence::Low);
    let basis: BTreeSet<&'static str> = attributed.iter().flat_map(|v| v.basis.clone()).collect();
    let ambiguous_with = attributed
        .iter()
        .map(|v| v.ambiguous_with)
        .max()
        .unwrap_or(0);

    Some(SessionCommitLink {
        session_id: session.session_id.clone(),
        session_path: session.file_path.clone(),
        commit_ids: attributed.iter().map(|v| v.commit_id.clone()).collect(),
        confidence,
        basis: basis.into_iter().map(str::to_string).collect(),
        commits: attributed.into_iter().map(detail).collect(),
        // A commit the session never touched was never a candidate; listing it
        // would bury the near-misses that actually explain the grade.
        rejected: dropped
            .into_iter()
            .filter(|v| v.rejection.is_some() && v.commit_coverage > 0.0)
            .take(MAX_REJECTED_COMMITS)
            .map(|v| RejectedCommit {
                commit_id: v.commit_id,
                reason: v.rejection.expect("filtered above"),
            })
            .collect(),
        ambiguous_with,
    })
}

fn detail(verdict: PairVerdict) -> CommitLinkDetail {
    CommitLinkDetail {
        commit_id: verdict.commit_id,
        confidence: verdict.confidence,
        basis: verdict.basis.into_iter().map(str::to_string).collect(),
        commit_coverage: verdict.commit_coverage,
        session_coverage: verdict.session_coverage,
        unattributed_files: verdict.unattributed_files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::session::attribution::TAIL_GRACE_MILLIS;
    use crate::verify::session::test_support::summary_fixture::{
        commit, named_commit, named_session, session, REPO, T0,
    };
    use crate::verify::types::RejectionReason;
    use std::path::PathBuf;

    fn ctx() -> AttributionContext {
        AttributionContext {
            repo_path: PathBuf::from(REPO),
            common_dir: None,
            known_emails: ["dev@example.com".to_string()].into_iter().collect(),
        }
    }

    #[test]
    fn a_clean_match_produces_one_high_link() {
        let links = correlate(
            &ctx(),
            &[session(Some("main"), REPO, &["src/a.rs", "src/b.rs"])],
            &[commit(T0 + 30_000, &["src/a.rs", "src/b.rs"])],
        );
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].confidence, LinkConfidence::High);
        assert_eq!(links[0].commit_ids, vec!["abc123".to_string()]);
        assert_eq!(links[0].commits.len(), 1);
        assert_eq!(links[0].commits[0].commit_coverage, 1.0);
        assert!(links[0].basis.contains(&"branch".to_string()));
    }

    #[test]
    fn a_bad_candidate_is_dropped_instead_of_dragging_the_grade_down() {
        // Defect 8: `weakest()` downgraded the whole link while *keeping* the
        // candidate that caused the downgrade.
        let good = named_commit("good", T0 + 30_000, &["src/a.rs"]);
        let mut stale = named_commit("stale", T0 + 3 * 60 * 60 * 1000, &["src/a.rs"]);
        stale.branches.clear();
        let mut s = session(Some("main"), REPO, &["src/a.rs"]);
        s.git_branch = Some("main".into());

        let links = correlate(&ctx(), &[s], &[good, stale]);
        assert_eq!(links[0].commit_ids, vec!["good".to_string()]);
        assert_eq!(links[0].confidence, LinkConfidence::High);
        assert_eq!(
            links[0].rejected,
            vec![RejectedCommit {
                commit_id: "stale".into(),
                reason: RejectionReason::OutsideSessionWindow,
            }]
        );
    }

    #[test]
    fn a_hard_refusal_still_explains_itself() {
        // A refusal that reports zero overlap would be indistinguishable from a
        // commit that was never a candidate, and the UI could not explain the
        // absence.
        let good = named_commit("good", T0 + 30_000, &["src/a.rs"]);
        let mut foreign = named_commit("foreign", T0 + 31_000, &["src/a.rs"]);
        foreign.branches = ["release/1.0".to_string()].into_iter().collect();

        let links = correlate(
            &ctx(),
            &[session(Some("main"), REPO, &["src/a.rs"])],
            &[good, foreign],
        );
        assert_eq!(links[0].commit_ids, vec!["good".to_string()]);
        assert_eq!(
            links[0].rejected,
            vec![RejectedCommit {
                commit_id: "foreign".into(),
                reason: RejectionReason::BranchMismatch,
            }]
        );
    }

    #[test]
    fn two_sessions_touching_disjoint_files_each_keep_their_own_commit() {
        let links = correlate(
            &ctx(),
            &[
                named_session("a", Some("main"), REPO, &["src/a.rs"]),
                named_session("b", Some("main"), REPO, &["src/b.rs"]),
            ],
            &[
                named_commit("c-a", T0 + 10_000, &["src/a.rs"]),
                named_commit("c-b", T0 + 20_000, &["src/b.rs"]),
            ],
        );
        assert_eq!(links.len(), 2);
        for link in &links {
            assert_eq!(link.confidence, LinkConfidence::High);
            assert_eq!(link.commit_ids.len(), 1);
            assert_eq!(link.ambiguous_with, 0);
        }
    }

    #[test]
    fn two_sessions_on_the_same_files_both_lose_high() {
        // Defect 7: both used to be graded High, producing two contradictory
        // reports for one commit.
        let links = correlate(
            &ctx(),
            &[
                named_session("a", Some("main"), REPO, &["src/a.rs"]),
                named_session("b", Some("main"), REPO, &["src/a.rs"]),
            ],
            &[commit(T0 + 30_000, &["src/a.rs"])],
        );
        assert_eq!(links.len(), 2);
        for link in &links {
            assert_eq!(link.confidence, LinkConfidence::Medium);
            assert_eq!(link.ambiguous_with, 2);
        }
    }

    #[test]
    fn the_session_that_did_strictly_more_keeps_high() {
        let links = correlate(
            &ctx(),
            &[
                named_session("narrow", Some("main"), REPO, &["src/a.rs"]),
                named_session("wide", Some("main"), REPO, &["src/a.rs", "src/b.rs"]),
            ],
            &[commit(T0 + 30_000, &["src/a.rs", "src/b.rs"])],
        );
        // The narrow session never covered the whole commit, so it was Medium
        // from the start; the wide one is uncontested at High.
        let wide = links.iter().find(|l| l.session_id == "wide").expect("wide");
        assert_eq!(wide.confidence, LinkConfidence::High);
    }

    #[test]
    fn three_way_ambiguity_attributes_the_commit_to_nobody() {
        let links = correlate(
            &ctx(),
            &[
                named_session("a", Some("main"), REPO, &["src/a.rs"]),
                named_session("b", Some("main"), REPO, &["src/a.rs"]),
                named_session("c", Some("main"), REPO, &["src/a.rs"]),
            ],
            &[commit(T0 + 30_000, &["src/a.rs"])],
        );
        assert!(links.is_empty(), "three claimants is noise, not information");
    }

    #[test]
    fn sessions_that_never_overlapped_are_not_parallel() {
        let early = named_session("early", Some("main"), REPO, &["src/a.rs"]);
        let mut late = named_session("late", Some("main"), REPO, &["src/a.rs"]);
        late.started_at = T0 + 10 * 60 * 1000;
        late.ended_at = T0 + 11 * 60 * 1000;
        late.modified_at = late.ended_at;

        // The commit lands inside `early`'s tail grace and inside `late`'s
        // window, so both would claim it — but their windows do not overlap.
        let links = correlate(&ctx(), &[early, late], &[commit(T0 + 10 * 60 * 1000 + 1, &["src/a.rs"])]);
        let late_link = links.iter().find(|l| l.session_id == "late").expect("late");
        assert_eq!(late_link.confidence, LinkConfidence::High);
        assert_eq!(late_link.ambiguous_with, 0);
    }

    #[test]
    fn a_session_with_no_commits_produces_no_link() {
        let links = correlate(
            &ctx(),
            &[session(Some("main"), REPO, &["src/only-here.rs"])],
            &[commit(T0 + 30_000, &["src/somewhere-else.rs"])],
        );
        assert!(links.is_empty());
    }

    #[test]
    fn a_commit_with_no_session_produces_no_link() {
        let links = correlate(&ctx(), &[], &[commit(T0 + 30_000, &["src/a.rs"])]);
        assert!(links.is_empty());
    }

    #[test]
    fn commits_shortly_after_the_session_still_count() {
        let links = correlate(
            &ctx(),
            &[session(Some("main"), REPO, &["src/a.rs"])],
            &[commit(T0 + 60_000 + TAIL_GRACE_MILLIS - 1, &["src/a.rs"])],
        );
        assert_eq!(links[0].confidence, LinkConfidence::High);
    }

    #[test]
    fn empty_inputs_are_safe() {
        assert!(correlate(&ctx(), &[], &[]).is_empty());
        assert!(correlate(&ctx(), &[session(Some("main"), REPO, &[])], &[]).is_empty());
    }
}
