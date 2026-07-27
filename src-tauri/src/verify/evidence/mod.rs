//! V11 test-run evidence and V12 diff coverage — spec principle **P7**:
//! *evidence is bound to a state and expires automatically.*
//!
//! "Tests passed" is not a fact about a repository, it is a fact about one
//! exact worktree state. This module therefore never records a bare result: a
//! run is stored together with the worktree digest captured **immediately
//! before** the process started, and any later query re-computes that digest
//! and downgrades the evidence to `Stale` the moment the tree differs.
//!
//! ## Which worktree hash
//!
//! The digest algorithm lives in [`crate::verify::digest`] (owned by the
//! scaffold phase) and is intentionally content-based rather than
//! `git status --porcelain`-based: line 1 is the HEAD tree oid, every following
//! line is `"{path}\t{oid}"` for each dirty/untracked path (`"deleted"` for
//! removed files), sorted by path, hashed as a blob. Consequences this module
//! relies on:
//!
//! - Two identical trees hash identically regardless of enumeration order, so a
//!   touch-without-edit (mtime change) does not expire evidence.
//! - The manifest grows only with the number of dirty files, which is why we
//!   can store it next to the evidence and later count *how many* files changed
//!   instead of merely knowing *that* something changed.
//!
//! Capturing the digest *before* the run is deliberate. If the tree changes
//! while tests run, the evidence stays bound to the state that was actually
//! tested and immediately reads as stale — the conservative outcome.
//!
//! ## Nothing runs by itself
//!
//! [`run_and_record`] is only ever reached from an explicit user action, and
//! the command string comes from user settings (see [`runner`] for the full
//! constraint list). Detection ([`detect_test_command`]) proposes, it never
//! executes.

mod coverage;
mod detect;
mod istanbul;
mod lcov;
mod model;
mod runner;
#[cfg(test)]
mod testutil;

pub use coverage::{
    added_lines_from_diff, coverage_for_diff, find_coverage_report, CoverageLookup, CoverageStatus,
};
pub use detect::{detect_test_command, resolve_test_command};
pub use runner::DEFAULT_TEST_TIMEOUT;

use std::path::Path;
use std::time::Duration;

use chrono::Utc;

use crate::error::AppError;
use crate::verify::digest;
use crate::verify::paths;
use crate::verify::types::{
    CoverageResult, EvidenceFreshness, Finding, FindingKind, TestEvidence, TestEvidenceStatus,
};

const EVIDENCE_FILE: &str = "test-evidence.json";

/// Above this the manifest is dropped from the stored evidence (contract §2.8).
/// Freshness then degrades from "N files changed" to "the tree changed".
const MAX_MANIFEST_LINES: usize = 5_000;

// ── V11: recorded evidence ───────────────────────────────────────────────────

/// Current evidence for this worktree, with freshness computed against the tree
/// as it is right now.
pub fn evidence_status(repo: &git2::Repository) -> Result<TestEvidenceStatus, AppError> {
    let manifest = digest::worktree_manifest(repo)?;
    let current_worktree_hash = digest::worktree_hash(repo)?;
    let evidence = load_evidence(repo)?;
    let freshness = freshness_from(evidence.as_ref(), &current_worktree_hash, &manifest);

    Ok(TestEvidenceStatus {
        evidence,
        freshness,
        current_worktree_hash,
    })
}

/// Pure freshness rule — the whole of P7 in one function.
pub fn freshness_from(
    evidence: Option<&TestEvidence>,
    current_hash: &str,
    current_manifest: &[String],
) -> EvidenceFreshness {
    match evidence {
        None => EvidenceFreshness::Absent,
        Some(recorded) if recorded.worktree_hash == current_hash => EvidenceFreshness::Fresh,
        Some(recorded) => EvidenceFreshness::Stale {
            // An empty manifest means it was dropped for size, not that the
            // tree was empty (line 1 is always the HEAD tree oid).
            changed_files: if recorded.manifest.is_empty() {
                None
            } else {
                Some(digest::manifest_diff_count(
                    &recorded.manifest,
                    current_manifest,
                ))
            },
        },
    }
}

/// Reads the recorded evidence. A missing or unreadable file is `Ok(None)`:
/// absent evidence is a legitimate answer, and "we cannot tell" must degrade to
/// "no evidence", never to "fine".
pub fn load_evidence(repo: &git2::Repository) -> Result<Option<TestEvidence>, AppError> {
    load_evidence_at(&paths::worktree_state_dir(repo)?)
}

pub fn save_evidence(
    repo: &git2::Repository,
    evidence: &TestEvidence,
) -> Result<(), AppError> {
    save_evidence_at(&paths::worktree_state_dir(repo)?, evidence)
}

fn load_evidence_at(state_dir: &Path) -> Result<Option<TestEvidence>, AppError> {
    let path = state_dir.join(EVIDENCE_FILE);
    let raw = match std::fs::read(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(AppError::Io(err)),
    };
    match serde_json::from_slice::<TestEvidence>(&raw) {
        Ok(evidence) => Ok(Some(evidence)),
        Err(_) => {
            tracing::warn!("[verify] unreadable test evidence file, treating as no evidence");
            Ok(None)
        }
    }
}

fn save_evidence_at(state_dir: &Path, evidence: &TestEvidence) -> Result<(), AppError> {
    std::fs::create_dir_all(state_dir)?;
    let json = serde_json::to_vec_pretty(evidence)?;
    std::fs::write(state_dir.join(EVIDENCE_FILE), json)?;
    Ok(())
}

/// Runs a test command and records the result bound to the worktree state
/// captured just before the process started.
///
/// `on_line` receives every output line (clipped to 2048 chars) so the command
/// layer can emit `verify:test-progress`. A failing or timing-out suite returns
/// `Ok` with `passed: false` — failure is evidence.
pub async fn run_and_record<F>(
    repo_path: &Path,
    command: &str,
    timeout: Duration,
    on_line: F,
) -> Result<TestEvidence, AppError>
where
    F: Fn(&str) + Send,
{
    let path = repo_path.to_path_buf();
    let capture_path = path.clone();
    let (worktree_hash, manifest) = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&capture_path)?;
        let manifest = digest::worktree_manifest(&repo)?;
        let hash = digest::worktree_hash(&repo)?;
        Ok::<_, AppError>((hash, manifest))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    // The command may carry secrets in env prefixes; log the shape, not the text.
    tracing::info!(
        "[verify] running test command in {} ({} dirty entries)",
        path.display(),
        manifest.len().saturating_sub(1)
    );

    let ran_at = Utc::now().timestamp_millis();
    let outcome = runner::execute(&path, command, timeout, on_line).await?;

    let evidence = TestEvidence {
        worktree_hash,
        manifest: if manifest.len() > MAX_MANIFEST_LINES {
            Vec::new()
        } else {
            manifest
        },
        command: command.to_string(),
        exit_code: outcome.exit_code,
        passed: outcome.passed,
        ran_at,
        duration_ms: outcome.duration_ms,
        output_tail: outcome.output_tail,
    };

    let stored = evidence.clone();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&path)?;
        save_evidence(&repo, &stored)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!(
        "[verify] test command finished: passed={} timed_out={} duration_ms={}",
        evidence.passed,
        outcome.timed_out,
        evidence.duration_ms
    );
    Ok(evidence)
}

// ── Findings ─────────────────────────────────────────────────────────────────

/// V11 findings. Commit-level (empty `file`).
///
/// A stale record yields only `TestEvidenceStale` even when it failed: a
/// failure observed against a tree that no longer exists may already be fixed,
/// and claiming otherwise is the kind of false signal that gets badges ignored.
pub fn evidence_findings(status: &TestEvidenceStatus) -> Vec<Finding> {
    match (&status.evidence, &status.freshness) {
        (_, EvidenceFreshness::Absent) => vec![Finding::new(
            FindingKind::TestEvidenceMissing,
            "",
            "no test run recorded for this worktree state",
        )],
        (Some(evidence), EvidenceFreshness::Stale { changed_files }) => {
            let message = match changed_files {
                Some(count) => format!("{} file(s) changed since the recorded test run", count),
                None => "worktree changed since the recorded test run".to_string(),
            };
            vec![Finding::new(FindingKind::TestEvidenceStale, "", message)
                .with_detail(evidence.command.clone())]
        }
        (Some(evidence), EvidenceFreshness::Fresh) if !evidence.passed => {
            let message = match evidence.exit_code {
                Some(code) => format!("test command exited with code {}", code),
                None => "test command did not complete".to_string(),
            };
            vec![Finding::new(FindingKind::TestEvidenceFailed, "", message)
                .with_detail(evidence.command.clone())]
        }
        _ => Vec::new(),
    }
}

/// V12 findings, one per file with uncovered added lines.
///
/// Coverage proves execution, not verification — the caller must render these
/// next to the V3 test-quality state (contract §2.8).
pub fn coverage_findings(result: &CoverageResult) -> Vec<Finding> {
    result
        .files
        .iter()
        .filter(|file| !file.uncovered_added_lines.is_empty())
        .map(|file| {
            let finding = Finding::new(
                FindingKind::UncoveredNewLines,
                file.path.clone(),
                format!(
                    "{} of {} instrumented added lines never executed",
                    file.uncovered_added_lines.len(),
                    file.added_lines
                ),
            );
            match file.uncovered_added_lines.first() {
                Some(&line) => finding.at_line(line),
                None => finding,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::testutil::TempDir;
    use super::*;
    use crate::verify::types::DiffCoverage;

    fn evidence(hash: &str, manifest: &[&str], passed: bool) -> TestEvidence {
        TestEvidence {
            worktree_hash: hash.to_string(),
            manifest: manifest.iter().map(|line| line.to_string()).collect(),
            command: "pnpm test".to_string(),
            exit_code: Some(if passed { 0 } else { 1 }),
            passed,
            ran_at: 1_700_000_000_000,
            duration_ms: 1_234,
            output_tail: "ok".to_string(),
        }
    }

    #[test]
    fn no_record_is_absent_not_fresh() {
        assert!(matches!(
            freshness_from(None, "abc", &[]),
            EvidenceFreshness::Absent
        ));
    }

    #[test]
    fn a_matching_hash_is_fresh() {
        let recorded = evidence("abc", &["HEAD\tdeadbeef"], true);
        assert!(matches!(
            freshness_from(Some(&recorded), "abc", &["HEAD\tdeadbeef".to_string()]),
            EvidenceFreshness::Fresh
        ));
    }

    #[test]
    fn a_changed_tree_is_stale_and_counts_changed_files() {
        let recorded = evidence("abc", &["HEAD\tdead", "a.ts\t111", "b.ts\t222"], true);
        let current = vec![
            "HEAD\tdead".to_string(),
            "a.ts\t999".to_string(),
            "b.ts\t222".to_string(),
        ];
        match freshness_from(Some(&recorded), "zzz", &current) {
            EvidenceFreshness::Stale { changed_files } => {
                assert!(changed_files.is_some(), "manifest present -> exact count");
            }
            other => panic!("expected Stale, got {:?}", other),
        }
    }

    #[test]
    fn a_dropped_manifest_still_reports_stale_without_a_count() {
        let recorded = evidence("abc", &[], true);
        match freshness_from(Some(&recorded), "zzz", &["HEAD\tdead".to_string()]) {
            EvidenceFreshness::Stale { changed_files } => assert_eq!(changed_files, None),
            other => panic!("expected Stale, got {:?}", other),
        }
    }

    #[test]
    fn evidence_round_trips_through_the_state_dir() {
        let dir = TempDir::new("evidence-io");
        let state_dir = dir.path().join("gitbaro");
        assert!(load_evidence_at(&state_dir).expect("missing is ok").is_none());

        let recorded = evidence("abc", &["HEAD\tdead"], true);
        save_evidence_at(&state_dir, &recorded).expect("save");
        let loaded = load_evidence_at(&state_dir).expect("load").expect("some");
        assert_eq!(loaded.worktree_hash, "abc");
        assert_eq!(loaded.command, "pnpm test");
        assert!(loaded.passed);
    }

    #[test]
    fn a_corrupt_evidence_file_reads_as_no_evidence() {
        let dir = TempDir::new("evidence-corrupt");
        let state_dir = dir.path().join("gitbaro");
        std::fs::create_dir_all(&state_dir).expect("mkdir");
        std::fs::write(state_dir.join(EVIDENCE_FILE), b"{ truncated").expect("write");
        assert!(load_evidence_at(&state_dir).expect("no error").is_none());
    }

    #[test]
    fn absent_evidence_produces_a_missing_finding() {
        let status = TestEvidenceStatus {
            evidence: None,
            freshness: EvidenceFreshness::Absent,
            current_worktree_hash: "abc".to_string(),
        };
        let findings = evidence_findings(&status);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::TestEvidenceMissing);
        assert!(!findings[0].is_file_scoped());
    }

    #[test]
    fn stale_evidence_reports_stale_only_even_when_it_failed() {
        let status = TestEvidenceStatus {
            evidence: Some(evidence("old", &["HEAD\tdead"], false)),
            freshness: EvidenceFreshness::Stale {
                changed_files: Some(7),
            },
            current_worktree_hash: "new".to_string(),
        };
        let findings = evidence_findings(&status);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::TestEvidenceStale);
        assert!(findings[0].message.contains('7'));
    }

    #[test]
    fn a_fresh_failure_is_reported_and_a_fresh_pass_is_silent() {
        let failed = TestEvidenceStatus {
            evidence: Some(evidence("abc", &["HEAD\tdead"], false)),
            freshness: EvidenceFreshness::Fresh,
            current_worktree_hash: "abc".to_string(),
        };
        let findings = evidence_findings(&failed);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::TestEvidenceFailed);

        let passed = TestEvidenceStatus {
            evidence: Some(evidence("abc", &["HEAD\tdead"], true)),
            freshness: EvidenceFreshness::Fresh,
            current_worktree_hash: "abc".to_string(),
        };
        assert!(evidence_findings(&passed).is_empty());
    }

    #[test]
    fn coverage_findings_anchor_to_the_first_uncovered_line() {
        let result = CoverageResult {
            source: "coverage/lcov.info".to_string(),
            parsed_at: 0,
            files: vec![
                DiffCoverage {
                    path: "src/a.ts".to_string(),
                    added_lines: 4,
                    covered_added_lines: 2,
                    uncovered_added_lines: vec![12, 13],
                },
                DiffCoverage {
                    path: "src/b.ts".to_string(),
                    added_lines: 3,
                    covered_added_lines: 3,
                    uncovered_added_lines: vec![],
                },
            ],
            unmapped_files: vec![],
        };
        let findings = coverage_findings(&result);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::UncoveredNewLines);
        assert_eq!(findings[0].file, "src/a.ts");
        assert_eq!(findings[0].line, Some(12));
    }
}
