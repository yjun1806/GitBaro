//! V32 — revert safety analysis.
//!
//! Answers three questions about one commit, all with `git2` and all read-only:
//!
//! 1. Is it already pushed? (present in any remote-tracking ref)
//! 2. Would `git revert` apply cleanly? (in-memory revert against HEAD)
//! 3. Which later commits touch the same files?
//!
//! The remediation options differ by push state — that branch is the whole
//! point of the feature: unpushed history can still be amended/reset/rebased,
//! pushed history can only be reverted forward.
//!
//! These are plain synchronous functions. The caller wraps them in
//! `tokio::task::spawn_blocking`.

use std::collections::{BTreeMap, BTreeSet};

use git2::{Commit, MergeOptions, Oid, Repository};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::verify::types::{Finding, FindingKind};

use super::{commit_changed_paths, truncate_detail};

/// Upper bound on commits walked between HEAD and the target when looking for
/// later commits that touch the same files.
pub const MAX_LATER_COMMITS_SCANNED: usize = 200;
/// Upper bound on later commits reported back to the UI.
pub const MAX_LATER_COMMITS_REPORTED: usize = 20;

/// What an in-memory revert against HEAD produces.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RevertOutcome {
    /// The revert merges without conflicts.
    Clean,
    /// The revert conflicts. Paths are repo-relative and sorted.
    #[serde(rename_all = "camelCase")]
    Conflicting { paths: Vec<String> },
    /// A single-parent revert cannot be computed (root or merge commit).
    #[serde(rename_all = "camelCase")]
    NotApplicable { reason: String },
}

/// A commit newer than the target that changed at least one of its files.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaterCommitTouch {
    pub commit_id: String,
    pub summary: String,
    /// The overlapping paths only, sorted.
    pub paths: Vec<String>,
}

/// A remediation the user can still reach for. The set differs by push state.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemediationOption {
    /// Rewrite the tip commit in place. Only when the commit *is* HEAD.
    Amend,
    /// Move the branch back. Discards or unstages later work.
    Reset,
    /// Replay history without (or with an edited) this commit.
    Rebase,
    /// Add a forward commit that undoes this one. Keeps the audit trail.
    Revert,
}

/// Everything the UI needs to explain "can this commit be undone, and how".
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevertSafety {
    pub commit_id: String,
    /// Present in at least one remote-tracking ref — history rewrites are off
    /// the table.
    pub is_pushed: bool,
    /// Shorthand names of the remote-tracking refs that contain the commit.
    pub remote_refs: Vec<String>,
    /// The commit is the current HEAD.
    pub is_head: bool,
    /// HEAD contains this commit. When false, `later_commits_touching` is empty
    /// because "later" is undefined off the current branch.
    pub head_contains: bool,
    pub revert_outcome: RevertOutcome,
    pub later_commits_touching: Vec<LaterCommitTouch>,
    /// The later-commit walk hit a budget and stopped early.
    pub later_commits_truncated: bool,
    pub options: Vec<RemediationOption>,
}

/// Analyze how safely `commit` can be undone in `repo`.
pub fn analyze_revert_safety(
    repo: &Repository,
    commit: &Commit<'_>,
) -> Result<RevertSafety, AppError> {
    let oid = commit.id();
    let remote_refs = remote_refs_containing(repo, oid);
    let is_pushed = !remote_refs.is_empty();

    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let is_head = head.as_ref().is_some_and(|h| h.id() == oid);
    let head_contains = match head.as_ref() {
        Some(h) => h.id() == oid || repo.graph_descendant_of(h.id(), oid).unwrap_or(false),
        None => false,
    };

    let revert_outcome = match head.as_ref() {
        Some(h) => revert_outcome(repo, commit, h)?,
        None => RevertOutcome::NotApplicable {
            reason: "HEAD is unborn".to_string(),
        },
    };

    let (later_commits_touching, later_commits_truncated) = if head_contains && !is_head {
        let target_paths = commit_changed_paths(repo, commit)?;
        later_commits_touching(repo, oid, &target_paths)?
    } else {
        (Vec::new(), false)
    };

    Ok(RevertSafety {
        commit_id: oid.to_string(),
        is_pushed,
        remote_refs,
        is_head,
        head_contains,
        revert_outcome,
        later_commits_touching,
        later_commits_truncated,
        options: remediation_options(is_pushed, is_head),
    })
}

/// Unpushed history can still be rewritten; pushed history can only move
/// forward. `Amend` additionally requires the commit to be the tip.
fn remediation_options(is_pushed: bool, is_head: bool) -> Vec<RemediationOption> {
    if is_pushed {
        return vec![RemediationOption::Revert];
    }
    let mut options = Vec::new();
    if is_head {
        options.push(RemediationOption::Amend);
    }
    options.push(RemediationOption::Reset);
    options.push(RemediationOption::Rebase);
    options.push(RemediationOption::Revert);
    options
}

/// Remote-tracking refs whose tip is, or descends from, `oid`.
///
/// Costs one graph walk per *distinct* remote tip, so refs parked on the same
/// commit are free. It is still linear in the number of remote branches, which
/// is why the batch/history path should read a cached push state rather than
/// call [`analyze_revert_safety`] per commit.
fn remote_refs_containing(repo: &Repository, oid: Oid) -> Vec<String> {
    let Ok(references) = repo.references() else {
        return Vec::new();
    };
    let mut by_tip: BTreeMap<Oid, BTreeSet<String>> = BTreeMap::new();
    for reference in references.flatten() {
        if !reference.is_remote() {
            continue;
        }
        let Some(name) = reference.shorthand() else {
            continue;
        };
        if name.ends_with("/HEAD") {
            continue;
        }
        let Ok(tip) = reference.peel_to_commit() else {
            continue;
        };
        by_tip.entry(tip.id()).or_default().insert(name.to_string());
    }

    let mut names = BTreeSet::new();
    for (tip, refs) in by_tip {
        if tip == oid || repo.graph_descendant_of(tip, oid).unwrap_or(false) {
            names.extend(refs);
        }
    }
    names.into_iter().collect()
}

/// Perform the revert entirely in memory (index only — the working tree and the
/// on-disk index are never touched) and inspect the result for conflicts.
fn revert_outcome(
    repo: &Repository,
    commit: &Commit<'_>,
    head: &Commit<'_>,
) -> Result<RevertOutcome, AppError> {
    match commit.parent_count() {
        0 => {
            return Ok(RevertOutcome::NotApplicable {
                reason: "root commit has no parent to revert against".to_string(),
            })
        }
        1 => {}
        n => {
            return Ok(RevertOutcome::NotApplicable {
                reason: format!("merge commit with {} parents needs an explicit mainline", n),
            })
        }
    }

    let options = MergeOptions::new();
    let index = repo.revert_commit(commit, head, 0, Some(&options))?;
    if !index.has_conflicts() {
        return Ok(RevertOutcome::Clean);
    }

    let mut paths = BTreeSet::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        for entry in [conflict.ancestor, conflict.our, conflict.their]
            .into_iter()
            .flatten()
        {
            if let Ok(path) = String::from_utf8(entry.path) {
                paths.insert(path);
            }
        }
    }
    Ok(RevertOutcome::Conflicting {
        paths: paths.into_iter().collect(),
    })
}

/// Commits reachable from HEAD but not from `target` that changed at least one
/// of `target_paths`. Returns `(touches, truncated)`.
fn later_commits_touching(
    repo: &Repository,
    target: Oid,
    target_paths: &[String],
) -> Result<(Vec<LaterCommitTouch>, bool), AppError> {
    if target_paths.is_empty() {
        return Ok((Vec::new(), false));
    }
    let wanted: BTreeSet<&str> = target_paths.iter().map(String::as_str).collect();

    let mut walk = repo.revwalk()?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL)?;
    if walk.push_head().is_err() {
        return Ok((Vec::new(), false));
    }
    walk.hide(target)?;

    let mut touches = Vec::new();
    let mut truncated = false;
    for (scanned, oid) in walk.enumerate() {
        if scanned >= MAX_LATER_COMMITS_SCANNED {
            truncated = true;
            break;
        }
        let commit = repo.find_commit(oid?)?;
        let overlapping: Vec<String> = commit_changed_paths(repo, &commit)?
            .into_iter()
            .filter(|path| wanted.contains(path.as_str()))
            .collect();
        if overlapping.is_empty() {
            continue;
        }
        touches.push(LaterCommitTouch {
            commit_id: commit.id().to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            paths: overlapping,
        });
        if touches.len() >= MAX_LATER_COMMITS_REPORTED {
            truncated = true;
            break;
        }
    }
    Ok((touches, truncated))
}

/// `v32.revertUnsafe` — only a conflicting revert is a finding.
///
/// Later commits touching the same files are *reported data*, not a finding:
/// the in-memory revert already merges against HEAD, so a clean result means
/// the revert is mechanically safe despite the overlap. Flagging the overlap
/// too would be the kind of noise that gets the whole badge ignored (§7-②).
pub fn revert_finding(safety: &RevertSafety) -> Option<Finding> {
    let RevertOutcome::Conflicting { paths } = &safety.revert_outcome else {
        return None;
    };
    let scope = if safety.is_pushed {
        "revert is the only option and it conflicts"
    } else {
        "revert conflicts"
    };
    Some(
        Finding::new(
            FindingKind::RevertUnsafe,
            "",
            format!("{} in {} file(s) against HEAD", scope, paths.len()),
        )
        .with_detail(truncate_detail(&paths.join(", "))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::hygiene::test_support::TempRepo;

    #[test]
    fn clean_revert_of_an_independent_commit() {
        let temp = TempRepo::new();
        temp.commit("feat: a", &[("a.txt", "1\n")]);
        let target = temp.commit("feat: b", &[("b.txt", "2\n")]);
        temp.commit("feat: c", &[("c.txt", "3\n")]);

        let commit = temp.repo.find_commit(target).unwrap();
        let safety = analyze_revert_safety(&temp.repo, &commit).unwrap();
        assert_eq!(safety.revert_outcome, RevertOutcome::Clean);
        assert!(revert_finding(&safety).is_none());
        assert!(safety.later_commits_touching.is_empty());
    }

    #[test]
    fn conflicting_revert_when_a_later_commit_rewrites_the_same_lines() {
        let temp = TempRepo::new();
        temp.commit("feat: a", &[("file.txt", "one\n")]);
        let target = temp.commit("feat: b", &[("file.txt", "two\n")]);
        temp.commit("feat: c", &[("file.txt", "three\n")]);

        let commit = temp.repo.find_commit(target).unwrap();
        let safety = analyze_revert_safety(&temp.repo, &commit).unwrap();
        match &safety.revert_outcome {
            RevertOutcome::Conflicting { paths } => assert_eq!(paths, &["file.txt".to_string()]),
            other => panic!("expected a conflict, got {:?}", other),
        }
        let finding = revert_finding(&safety).expect("conflict is a finding");
        assert_eq!(finding.kind, FindingKind::RevertUnsafe);
        assert!(finding.file.is_empty());

        assert_eq!(safety.later_commits_touching.len(), 1);
        assert_eq!(
            safety.later_commits_touching[0].paths,
            vec!["file.txt".to_string()]
        );
    }

    #[test]
    fn unpushed_commit_offers_history_rewrites() {
        let temp = TempRepo::new();
        temp.commit("feat: a", &[("a.txt", "1\n")]);
        let tip = temp.commit("feat: b", &[("b.txt", "2\n")]);

        let commit = temp.repo.find_commit(tip).unwrap();
        let safety = analyze_revert_safety(&temp.repo, &commit).unwrap();
        assert!(!safety.is_pushed);
        assert!(safety.is_head);
        assert_eq!(
            safety.options,
            vec![
                RemediationOption::Amend,
                RemediationOption::Reset,
                RemediationOption::Rebase,
                RemediationOption::Revert,
            ]
        );
    }

    #[test]
    fn pushed_commit_offers_revert_only() {
        let temp = TempRepo::new();
        let first = temp.commit("feat: a", &[("a.txt", "1\n")]);
        let pushed = temp.commit("feat: b", &[("b.txt", "2\n")]);
        temp.set_remote_ref("origin/main", pushed);
        let unpushed = temp.commit("feat: c", &[("c.txt", "3\n")]);

        // The tip of the remote ref itself.
        let safety =
            analyze_revert_safety(&temp.repo, &temp.repo.find_commit(pushed).unwrap()).unwrap();
        assert!(safety.is_pushed);
        assert_eq!(safety.remote_refs, vec!["origin/main".to_string()]);
        assert_eq!(safety.options, vec![RemediationOption::Revert]);

        // An ancestor of the remote ref is pushed too.
        let safety =
            analyze_revert_safety(&temp.repo, &temp.repo.find_commit(first).unwrap()).unwrap();
        assert!(safety.is_pushed);

        // A commit made after the push is not.
        let safety =
            analyze_revert_safety(&temp.repo, &temp.repo.find_commit(unpushed).unwrap()).unwrap();
        assert!(!safety.is_pushed);
        assert!(safety.options.contains(&RemediationOption::Amend));
    }

    #[test]
    fn amend_is_unavailable_for_a_non_tip_commit() {
        let temp = TempRepo::new();
        let older = temp.commit("feat: a", &[("a.txt", "1\n")]);
        temp.commit("feat: b", &[("b.txt", "2\n")]);

        let safety =
            analyze_revert_safety(&temp.repo, &temp.repo.find_commit(older).unwrap()).unwrap();
        assert!(!safety.is_head);
        assert!(!safety.options.contains(&RemediationOption::Amend));
        assert!(safety.options.contains(&RemediationOption::Reset));
    }

    #[test]
    fn root_commit_cannot_be_reverted_against_a_parent() {
        let temp = TempRepo::new();
        let root = temp.commit("feat: a", &[("a.txt", "1\n")]);

        let safety =
            analyze_revert_safety(&temp.repo, &temp.repo.find_commit(root).unwrap()).unwrap();
        assert!(matches!(
            safety.revert_outcome,
            RevertOutcome::NotApplicable { .. }
        ));
        assert!(revert_finding(&safety).is_none());
    }

    #[test]
    fn merge_commit_needs_an_explicit_mainline() {
        let temp = TempRepo::new();
        let base = temp.commit("feat: base", &[("base.txt", "0\n")]);
        let side = temp.commit_on(base, "feat: side", &[("side.txt", "s\n")]);
        let main = temp.commit("feat: main", &[("main.txt", "m\n")]);
        let merge = temp.merge_commit(main, side, "chore: merge");

        let safety =
            analyze_revert_safety(&temp.repo, &temp.repo.find_commit(merge).unwrap()).unwrap();
        match &safety.revert_outcome {
            RevertOutcome::NotApplicable { reason } => assert!(reason.contains("mainline")),
            other => panic!("expected NotApplicable, got {:?}", other),
        }
    }
}
