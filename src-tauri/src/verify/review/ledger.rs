//! V33 — the git-notes evidence ledger.
//!
//! A verification record is stored as JSON in a git note on
//! `refs/notes/gitbaro-verification`. Three rules hold everywhere in this file:
//!
//! - **Off by default.** Writing is refused until the repository opts in, so
//!   nobody grows a notes ref they never asked for.
//! - **Local only.** Nothing here touches a remote and the ref is never pushed.
//!   Shared verification records would turn into a compliance artefact, which is
//!   the failure mode this feature is meant to avoid.
//! - **Attributed.** An anonymous entry is not evidence, so a missing git
//!   identity is a hard error rather than a record signed by nobody.
//!
//! git notes need no hooks, so `git2` is the right engine here — the hybrid
//! strategy only requires the CLI for hook-bearing operations.

use std::collections::BTreeSet;
use std::path::PathBuf;

use git2::Repository;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::error::AppError;
use crate::verify::paths::shared_state_dir;
use crate::verify::types::{
    EvidenceLedgerEntry, LedgerCheck, LedgerOutcome, VerificationReport,
};

use super::commits::{resolve_commit_id, resolve_commit_oid};
use super::store::{load_json, save_json};
use super::{identity_of, now_millis, require_signature};

/// The notes ref. Local only — never a push refspec.
pub const NOTES_REF: &str = "refs/notes/gitbaro-verification";

const LEDGER_CONFIG_FILE: &str = "ledger.json";

/// Per-repository opt-in. `Default` is the off state, which is what a missing
/// or unreadable document degrades to.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct LedgerConfig {
    enabled: bool,
}

fn config_path(repo: &Repository) -> Result<PathBuf, AppError> {
    Ok(shared_state_dir(repo)?.join(LEDGER_CONFIG_FILE))
}

/// Whether this repository has opted into the ledger. Off unless it says on.
pub fn is_ledger_enabled(repo: &Repository) -> bool {
    match config_path(repo) {
        Ok(path) => load_json::<LedgerConfig>(&path).enabled,
        Err(e) => {
            warn!("[verify] could not resolve ledger config path: {}", e);
            false
        }
    }
}

pub fn set_ledger_enabled(repo: &Repository, enabled: bool) -> Result<(), AppError> {
    save_json(&config_path(repo)?, &LedgerConfig { enabled })?;
    info!("[verify] evidence ledger enabled={}", enabled);
    Ok(())
}

/// Read the ledger entry for a commit.
///
/// A commit with no note is the normal case and returns `Ok(None)`. A note this
/// version cannot parse also returns `Ok(None)`: a record written by a different
/// GitBaro version must not break the screen that displays it.
pub fn read_evidence_ledger(
    repo: &Repository,
    oid: &str,
) -> Result<Option<EvidenceLedgerEntry>, AppError> {
    let commit_oid = resolve_commit_oid(repo, oid)?;

    let note = match repo.find_note(Some(NOTES_REF), commit_oid) {
        Ok(note) => note,
        Err(_) => return Ok(None),
    };

    let Some(raw) = note.message() else {
        warn!("[verify] ledger note on {} is not valid UTF-8", commit_oid);
        return Ok(None);
    };

    match serde_json::from_str::<EvidenceLedgerEntry>(raw) {
        Ok(entry) => Ok(Some(entry)),
        Err(e) => {
            warn!("[verify] ledger note on {} is unreadable: {}", commit_oid, e);
            Ok(None)
        }
    }
}

/// Write the ledger entry for a commit, replacing any previous entry.
///
/// Refuses while the ledger is disabled — the gate lives here rather than in the
/// caller so it cannot be skipped by accident.
pub fn write_evidence_ledger(
    repo: &Repository,
    entry: &EvidenceLedgerEntry,
) -> Result<(), AppError> {
    if !is_ledger_enabled(repo) {
        return Err(AppError::Verify(
            "The verification ledger is disabled for this repository".to_string(),
        ));
    }

    let commit_oid = resolve_commit_oid(repo, &entry.commit_id)?;
    let signature = require_signature(repo)?;
    let json = serde_json::to_string(entry)?;

    repo.note(
        &signature,
        &signature,
        Some(NOTES_REF),
        commit_oid,
        &json,
        true, // replace an existing record for this commit
    )?;

    info!("[verify] ledger entry recorded on {}", commit_oid);
    Ok(())
}

/// Turn a finished report into the record to store on a commit.
pub fn ledger_entry_from_report(
    repo: &Repository,
    oid: &str,
    report: &VerificationReport,
) -> Result<EvidenceLedgerEntry, AppError> {
    let signature = require_signature(repo)?;

    Ok(EvidenceLedgerEntry {
        commit_id: resolve_commit_id(repo, oid)?,
        recorded_at: now_millis(),
        recorded_by: identity_of(&signature),
        checks: ledger_checks(report),
        tool_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// One row per rule the report mentions: a rule that ran is `Passed` or
/// `Flagged`, a rule that could not run is `Skipped`.
///
/// A rule that appears in both lists ran on part of the change, so it is
/// recorded as having run. The ledger therefore never says "everything passed"
/// on the strength of an empty findings list.
fn ledger_checks(report: &VerificationReport) -> Vec<LedgerCheck> {
    let checked: BTreeSet<&str> = report.checked.iter().map(String::as_str).collect();
    let all: BTreeSet<&str> = checked
        .iter()
        .copied()
        .chain(report.unchecked.iter().map(String::as_str))
        .collect();

    all.into_iter()
        .map(|rule_id| {
            let finding_count = report
                .findings
                .iter()
                .filter(|f| f.rule_id == rule_id)
                .count();

            let outcome = if !checked.contains(rule_id) {
                LedgerOutcome::Skipped
            } else if finding_count > 0 {
                LedgerOutcome::Flagged
            } else {
                LedgerOutcome::Passed
            };

            LedgerCheck {
                rule_id: rule_id.to_string(),
                outcome,
                finding_count,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::review::test_support::{commit, TempRepo};
    use crate::verify::types::{Finding, FindingKind, ScanLimit, Severity, UncheckedReason};

    fn entry(commit_id: &str) -> EvidenceLedgerEntry {
        EvidenceLedgerEntry {
            commit_id: commit_id.to_string(),
            recorded_at: 1_700_000_000_000,
            recorded_by: "Review Tester <review@example.com>".to_string(),
            checks: vec![LedgerCheck {
                rule_id: "v2.testSkipAdded".to_string(),
                outcome: LedgerOutcome::Passed,
                finding_count: 0,
            }],
            tool_version: "0.0.0-test".to_string(),
        }
    }

    fn finding(kind: FindingKind, rule_id: &str) -> Finding {
        Finding {
            kind,
            severity: Severity::Warn,
            file: "src/a.ts".to_string(),
            line: None,
            message: "evidence".to_string(),
            detail: None,
            rule_id: rule_id.to_string(),
        }
    }

    fn report(
        findings: Vec<Finding>,
        checked: &[&str],
        unchecked: &[&str],
    ) -> VerificationReport {
        VerificationReport {
            findings,
            checked: checked.iter().map(|s| s.to_string()).collect(),
            unchecked: unchecked.iter().map(|s| s.to_string()).collect(),
            limits: unchecked
                .iter()
                .map(|id| ScanLimit {
                    rule_id: id.to_string(),
                    reason: UncheckedReason::NotImplemented,
                    detail: None,
                })
                .collect(),
            generated_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn ledger_is_disabled_by_default() {
        let temp = TempRepo::new("ledger-default");
        assert!(!is_ledger_enabled(&temp.open()));
    }

    #[test]
    fn writing_while_disabled_is_refused() {
        let temp = TempRepo::new("ledger-refuse");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        let result = write_evidence_ledger(&repo, &entry(&oid));

        assert!(result.is_err());
        assert!(read_evidence_ledger(&repo, &oid).expect("read").is_none());
    }

    #[test]
    fn enabling_then_writing_round_trips_through_git_notes() {
        let temp = TempRepo::new("ledger-roundtrip");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        set_ledger_enabled(&repo, true).expect("enable");
        write_evidence_ledger(&repo, &entry(&oid)).expect("write");

        let read = read_evidence_ledger(&temp.open(), &oid)
            .expect("read")
            .expect("entry present");

        assert_eq!(read.commit_id, oid);
        assert_eq!(read.recorded_by, "Review Tester <review@example.com>");
        assert_eq!(read.checks.len(), 1);
        assert_eq!(read.checks[0].outcome, LedgerOutcome::Passed);
    }

    #[test]
    fn a_commit_without_a_note_reads_as_none() {
        let temp = TempRepo::new("ledger-absent");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        assert!(read_evidence_ledger(&repo, &oid).expect("read").is_none());
    }

    #[test]
    fn writing_twice_replaces_the_previous_record() {
        let temp = TempRepo::new("ledger-replace");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        set_ledger_enabled(&repo, true).expect("enable");
        write_evidence_ledger(&repo, &entry(&oid)).expect("first write");

        let mut second = entry(&oid);
        second.tool_version = "0.0.1-test".to_string();
        write_evidence_ledger(&repo, &second).expect("second write");

        let read = read_evidence_ledger(&repo, &oid)
            .expect("read")
            .expect("entry present");
        assert_eq!(read.tool_version, "0.0.1-test");
    }

    #[test]
    fn an_unparseable_note_reads_as_none_instead_of_failing() {
        let temp = TempRepo::new("ledger-corrupt");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();
        let commit_oid = git2::Oid::from_str(&oid).expect("oid");
        let signature = repo.signature().expect("signature");

        repo.note(
            &signature,
            &signature,
            Some(NOTES_REF),
            commit_oid,
            "not json at all",
            true,
        )
        .expect("write raw note");

        assert!(read_evidence_ledger(&repo, &oid).expect("read").is_none());
    }

    #[test]
    fn disabling_again_blocks_further_writes() {
        let temp = TempRepo::new("ledger-toggle");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();

        set_ledger_enabled(&repo, true).expect("enable");
        write_evidence_ledger(&repo, &entry(&oid)).expect("write");
        set_ledger_enabled(&repo, false).expect("disable");

        assert!(write_evidence_ledger(&repo, &entry(&oid)).is_err());
        // The already-written record stays readable.
        assert!(read_evidence_ledger(&repo, &oid).expect("read").is_some());
    }

    #[test]
    fn checks_record_ran_rules_as_passed_or_flagged() {
        let report = report(
            vec![finding(FindingKind::TestSkipAdded, "v2.testSkipAdded")],
            &["v2.testSkipAdded", "v6.scopeDrift"],
            &[],
        );

        let checks = ledger_checks(&report);

        assert_eq!(checks.len(), 2);
        assert_eq!(checks[0].rule_id, "v2.testSkipAdded");
        assert_eq!(checks[0].outcome, LedgerOutcome::Flagged);
        assert_eq!(checks[0].finding_count, 1);
        assert_eq!(checks[1].rule_id, "v6.scopeDrift");
        assert_eq!(checks[1].outcome, LedgerOutcome::Passed);
        assert_eq!(checks[1].finding_count, 0);
    }

    #[test]
    fn checks_record_rules_that_could_not_run_as_skipped() {
        let report = report(vec![], &["v2.testSkipAdded"], &["v1.structuralDiff"]);

        let checks = ledger_checks(&report);

        assert_eq!(checks.len(), 2);
        assert_eq!(checks[0].rule_id, "v1.structuralDiff");
        assert_eq!(checks[0].outcome, LedgerOutcome::Skipped);
        assert_eq!(checks[1].outcome, LedgerOutcome::Passed);
    }

    #[test]
    fn a_partially_checked_rule_counts_as_having_run() {
        // Ran on the TypeScript files, skipped the Python ones.
        let report = report(vec![], &["v2.testSkipAdded"], &["v2.testSkipAdded"]);

        let checks = ledger_checks(&report);

        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].outcome, LedgerOutcome::Passed);
    }

    #[test]
    fn an_entry_built_from_a_report_carries_attribution_and_full_commit_id() {
        let temp = TempRepo::new("ledger-build");
        let repo = temp.open();
        let oid = commit(&repo, "a.txt", "a").to_string();
        let report = report(vec![], &["v2.testSkipAdded"], &["v1.structuralDiff"]);

        let built = ledger_entry_from_report(&repo, &oid[..8], &report).expect("build");

        assert_eq!(built.commit_id, oid);
        assert_eq!(built.recorded_by, "Review Tester <review@example.com>");
        assert_eq!(built.checks.len(), 2);
        assert!(built.recorded_at > 0);
    }
}
