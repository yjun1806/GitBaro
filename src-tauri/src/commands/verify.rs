//! Static scan and rule-configuration commands (contract §3.1).
//!
//! This file is where the six independently built verify modules are finally
//! combined. Each module produces a self-contained [`VerificationReport`] that
//! already accounts for the *whole* registry, so combining two reports means
//! reconciling their accounting — see [`merge_reports`].
//!
//! Every `git2` call happens inside `spawn_blocking`; the diff helpers here are
//! synchronous on purpose so they can be composed inside one blocking closure.

use std::path::{Path, PathBuf};

use git2::{Commit, Repository};

use crate::error::AppError;
use crate::git::commit::validate_commit_oid;
use crate::git::diff::convert_diff;
use crate::git::engine::DiffOutput;
use crate::verify::config::{load_rule_config, save_rule_config, RuleConfig};
use crate::verify::registry::{find as find_rule, registry};
use crate::verify::rules::{context_from_diff, run_diff_rules, CommitContext};
use crate::verify::types::{
    CommitVerificationSummary, Finding, FindingKind, RuleDescriptor, ScanLimit, Severity,
    UncheckedReason, VerificationReport,
};
use crate::verify::{deps, hygiene};

/// Bounds a history-badge batch so one call cannot walk a whole repository.
const MAX_RANGE_COMMITS: usize = 100;

// ── §3.1 commands ────────────────────────────────────────────────────────────

/// Static diff rules (V2 · V3 · V5 · V6 · V10) over the working tree.
///
/// Execution evidence (V11) and coverage (V12) have their own commands; they
/// appear here as `unchecked`, which is the honest answer for a scan that never
/// looked at them.
#[tauri::command]
pub async fn verify_working_tree(
    repo_path: String,
    staged: bool,
    draft_message: Option<String>,
) -> Result<VerificationReport, AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        let diff = working_tree_diff(&repo, staged)?;
        let config = load_rule_config();
        let ctx = context_from_diff(Path::new(&repo_path), &diff, None, draft_message);
        Ok(run_diff_rules(&ctx, &config))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// Full per-commit report: static diff rules plus commit hygiene (V31 · V32 · V35).
#[tauri::command]
pub async fn verify_commit(repo_path: String, oid: String) -> Result<VerificationReport, AppError> {
    validate_commit_oid(&oid)?;

    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        let config = load_rule_config();
        commit_report(&repo, Path::new(&repo_path), &oid, &config)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// Lightweight batch for history badges.
///
/// Only the cheap rules run: the static diff scan plus V31 (a message/path
/// heuristic). V32 walks later history per commit, which is far too expensive
/// to repeat across a screenful of rows — it stays in [`verify_commit`].
#[tauri::command]
pub async fn verify_commit_range(
    repo_path: String,
    oids: Vec<String>,
) -> Result<Vec<CommitVerificationSummary>, AppError> {
    for oid in &oids {
        validate_commit_oid(oid)?;
    }

    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)?;
        let config = load_rule_config();
        let base = Path::new(&repo_path);

        let summaries = oids
            .iter()
            .take(MAX_RANGE_COMMITS)
            .filter_map(|oid| match light_commit_report(&repo, base, oid, &config) {
                Ok(report) => Some(summarize(oid, &report)),
                Err(e) => {
                    // One unreadable commit must not blank the whole history list.
                    tracing::warn!("[verify] skipping commit {}: {}", oid, e);
                    None
                }
            })
            .collect();

        Ok(summaries)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// Every rule, including `Planned` ones — the settings screen has to be able to
/// show what is *not* being checked (§7-①).
#[tauri::command]
pub async fn get_verify_rules() -> Result<Vec<RuleDescriptor>, AppError> {
    tokio::task::spawn_blocking(|| {
        let config = load_rule_config();
        registry()
            .iter()
            .map(|entry| RuleDescriptor {
                rule_id: entry.id.to_string(),
                kind: entry.kind,
                v_number: entry.v_number.to_string(),
                layer: entry.layer,
                default_severity: entry.default_severity,
                status: entry.status,
                enabled: config.is_enabled(entry.id),
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))
}

#[tauri::command]
pub async fn set_verify_rule_enabled(rule_id: String, enabled: bool) -> Result<(), AppError> {
    if find_rule(&rule_id).is_none() {
        return Err(AppError::Verify(format!("Unknown rule: {}", rule_id)));
    }

    tokio::task::spawn_blocking(move || {
        let mut config = load_rule_config();
        config.set(rule_id, enabled);
        save_rule_config(&config)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V4. With `allow_registry == false` (the default) nothing leaves the machine.
#[tauri::command]
pub async fn check_dependencies(
    repo_path: String,
    oid: Option<String>,
    allow_registry: bool,
) -> Result<VerificationReport, AppError> {
    if let Some(oid) = &oid {
        validate_commit_oid(oid)?;
    }

    let path = PathBuf::from(&repo_path);
    let target = path.clone();
    let (diff, config) = tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&target)?;
        let diff = match &oid {
            Some(oid) => commit_diff(&repo, &resolve_commit(&repo, oid)?)?,
            None => working_tree_diff(&repo, false)?,
        };
        Ok::<_, AppError>((diff, load_rule_config()))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    deps::check_dependencies(path, diff, config, allow_registry).await
}

// ── Shared helpers (used by commands/review.rs and commands/session.rs) ───────

/// The staged or unstaged working-tree diff.
pub(crate) fn working_tree_diff(repo: &Repository, staged: bool) -> Result<DiffOutput, AppError> {
    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, None)?
    } else {
        repo.diff_index_to_workdir(None, None)?
    };
    convert_diff(&diff)
}

/// A commit against its first parent. A root commit is diffed against nothing,
/// which git2 renders as "everything added".
pub(crate) fn commit_diff(repo: &Repository, commit: &Commit<'_>) -> Result<DiffOutput, AppError> {
    let tree = commit.tree()?;
    let parent_tree = match commit.parent_count() {
        0 => None,
        _ => Some(commit.parent(0)?.tree()?),
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    convert_diff(&diff)
}

pub(crate) fn resolve_commit<'r>(repo: &'r Repository, oid: &str) -> Result<Commit<'r>, AppError> {
    Ok(repo.revparse_single(oid)?.peel_to_commit()?)
}

/// The rule engine's view of a commit. Trailers are parsed by the hygiene
/// module so V6 and V35 cannot disagree about what a trailer is.
pub(crate) fn commit_context(commit: &Commit<'_>) -> CommitContext {
    let message = commit.message().unwrap_or("").to_string();
    let trailers = hygiene::parse_trailers(&message)
        .into_iter()
        .map(|trailer| (trailer.key, trailer.value))
        .collect();

    CommitContext {
        oid: commit.id().to_string(),
        message,
        parent_ids: commit.parent_ids().map(|id| id.to_string()).collect(),
        author_email: commit.author().email().unwrap_or_default().to_string(),
        trailers,
    }
}

/// Static diff rules + V31 for one commit. Cheap enough to run in a batch.
pub(crate) fn light_commit_report(
    repo: &Repository,
    repo_path: &Path,
    oid: &str,
    config: &RuleConfig,
) -> Result<VerificationReport, AppError> {
    let commit = resolve_commit(repo, oid)?;
    let diff = commit_diff(repo, &commit)?;
    let ctx = context_from_diff(repo_path, &diff, Some(commit_context(&commit)), None);
    let static_report = run_diff_rules(&ctx, config);

    let tangle_report = tangle_only_report(repo, &commit, config)?;
    Ok(merge_reports(vec![static_report, tangle_report]))
}

/// The full per-commit report: everything `light_commit_report` does, plus the
/// history-walking hygiene rules (V32) and trailer cross-check (V35).
pub(crate) fn commit_report(
    repo: &Repository,
    repo_path: &Path,
    oid: &str,
    config: &RuleConfig,
) -> Result<VerificationReport, AppError> {
    let commit = resolve_commit(repo, oid)?;
    let diff = commit_diff(repo, &commit)?;
    let ctx = context_from_diff(repo_path, &diff, Some(commit_context(&commit)), None);
    let static_report = run_diff_rules(&ctx, config);

    // No session evidence at this layer: V35 then records a `MissingArtifact`
    // limit rather than a finding — absent evidence is not negative evidence.
    let hygiene = hygiene::analyze_commit(repo, commit.id(), None, config)?;
    let hygiene_report = VerificationReport::new(hygiene.findings, hygiene.checked, hygiene.limits);

    Ok(merge_reports(vec![static_report, hygiene_report]))
}

/// V31 alone, as a report so it can be merged.
fn tangle_only_report(
    repo: &Repository,
    commit: &Commit<'_>,
    config: &RuleConfig,
) -> Result<VerificationReport, AppError> {
    let rule_id = FindingKind::TangledCommit.rule_id();
    if !config.is_enabled(rule_id) {
        return Ok(VerificationReport::new(
            Vec::new(),
            Vec::new(),
            vec![ScanLimit {
                rule_id: rule_id.to_string(),
                reason: UncheckedReason::Disabled,
                detail: None,
            }],
        ));
    }

    // A merge commit's file list is an artifact of the merge, not of authorship.
    if commit.parent_count() > 1 {
        return Ok(VerificationReport::new(
            Vec::new(),
            Vec::new(),
            vec![ScanLimit {
                rule_id: rule_id.to_string(),
                reason: UncheckedReason::NotApplicable,
                detail: Some("merge commit".to_string()),
            }],
        ));
    }

    let paths = hygiene::commit_changed_paths(repo, commit)?;
    let score = hygiene::score_tangle(commit.message().unwrap_or(""), &paths);
    let findings = if score.is_tangled {
        vec![hygiene::tangle_finding(&score)]
    } else {
        Vec::new()
    };

    Ok(VerificationReport::new(
        findings,
        vec![rule_id.to_string()],
        Vec::new(),
    ))
}

/// Combine reports produced by independent scans.
///
/// Each module fills the registry gaps it did not look at with
/// `NotApplicable`, so a naive concatenation would list nearly every rule as
/// both checked and unchecked. A rule that genuinely ran somewhere is checked;
/// only its `NotApplicable` placeholders are dropped. Every other reason
/// (`Disabled`, `MissingArtifact`, `ParseFailed`, `BudgetExceeded`,
/// `UnsupportedLanguage`, `NotImplemented`) survives, because those describe a
/// target that really was skipped.
pub(crate) fn merge_reports(reports: Vec<VerificationReport>) -> VerificationReport {
    let mut findings: Vec<Finding> = Vec::new();
    let mut checked: Vec<String> = Vec::new();
    let mut limits: Vec<ScanLimit> = Vec::new();

    for report in reports {
        findings.extend(report.findings);
        checked.extend(report.checked);
        limits.extend(report.limits);
    }

    limits.retain(|limit| {
        limit.reason != UncheckedReason::NotApplicable
            || !checked.iter().any(|id| id == &limit.rule_id)
    });

    VerificationReport::new(findings, checked, limits)
}

pub(crate) fn summarize(oid: &str, report: &VerificationReport) -> CommitVerificationSummary {
    CommitVerificationSummary {
        commit_id: oid.to_string(),
        max_severity: report.max_severity(),
        danger_count: report.count_of(Severity::Danger),
        warn_count: report.count_of(Severity::Warn),
        info_count: report.count_of(Severity::Info),
        unchecked_count: report.unchecked.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::registry::RuleStatus;
    use std::collections::BTreeSet;

    fn limit(rule_id: &str, reason: UncheckedReason) -> ScanLimit {
        ScanLimit {
            rule_id: rule_id.to_string(),
            reason,
            detail: None,
        }
    }

    #[test]
    fn merging_promotes_a_rule_that_ran_in_either_report() {
        let ran =
            VerificationReport::new(Vec::new(), vec!["v2.testSkipAdded".to_string()], Vec::new());
        let skipped = VerificationReport::new(
            Vec::new(),
            Vec::new(),
            vec![limit("v2.testSkipAdded", UncheckedReason::NotApplicable)],
        );

        let merged = merge_reports(vec![ran, skipped]);
        assert!(merged.checked.contains(&"v2.testSkipAdded".to_string()));
        assert!(!merged.unchecked.contains(&"v2.testSkipAdded".to_string()));
    }

    #[test]
    fn merging_keeps_real_limits_even_when_the_rule_ran_elsewhere() {
        let ran = VerificationReport::new(
            Vec::new(),
            vec!["v4.hallucinatedDependency".to_string()],
            Vec::new(),
        );
        let partial = VerificationReport::new(
            Vec::new(),
            Vec::new(),
            vec![limit(
                "v4.hallucinatedDependency",
                UncheckedReason::MissingArtifact,
            )],
        );

        let merged = merge_reports(vec![ran, partial]);
        assert!(merged
            .checked
            .contains(&"v4.hallucinatedDependency".to_string()));
        assert!(
            merged
                .unchecked
                .contains(&"v4.hallucinatedDependency".to_string()),
            "a partially checked rule appears in both lists"
        );
    }

    #[test]
    fn merging_keeps_the_registry_fully_accounted_for() {
        let a = VerificationReport::new(
            vec![Finding::new(FindingKind::ScopeDrift, "", "drift")],
            vec!["v6.scopeDrift".to_string()],
            registry()
                .iter()
                .filter(|e| e.id != "v6.scopeDrift")
                .map(|e| {
                    limit(
                        e.id,
                        match e.status {
                            RuleStatus::Planned => UncheckedReason::NotImplemented,
                            RuleStatus::Implemented => UncheckedReason::NotApplicable,
                        },
                    )
                })
                .collect(),
        );
        let b = VerificationReport::new(
            Vec::new(),
            vec!["v31.tangledCommit".to_string()],
            Vec::new(),
        );

        let merged = merge_reports(vec![a, b]);
        let covered: BTreeSet<&str> = merged
            .checked
            .iter()
            .chain(merged.unchecked.iter())
            .map(String::as_str)
            .collect();
        for entry in registry() {
            assert!(covered.contains(entry.id), "{} unaccounted for", entry.id);
        }
    }

    /// The synthetic merge tests above prove `merge_reports` preserves whatever
    /// coverage it is handed. This one proves the *production* path actually
    /// produces full coverage — contract §2.3's registry invariant, measured on
    /// a real commit rather than on a hand-built report.
    #[test]
    fn commit_report_accounts_for_every_registry_rule() {
        let temp = crate::verify::hygiene::test_support::TempRepo::new();
        temp.commit("feat(app): seed", &[("src/app.ts", "export const a = 1;\n")]);
        let head = temp.commit(
            "feat(app): change",
            &[("src/app.ts", "export const a = 2;\n")],
        );

        let report = commit_report(
            &temp.repo,
            &temp.dir,
            &head.to_string(),
            &RuleConfig::default(),
        )
        .expect("commit report");

        let covered: BTreeSet<&str> = report
            .checked
            .iter()
            .chain(report.unchecked.iter())
            .map(String::as_str)
            .collect();
        for entry in registry() {
            assert!(covered.contains(entry.id), "{} unaccounted for", entry.id);
        }
        assert_eq!(
            report.unchecked,
            report
                .limits
                .iter()
                .map(|l| l.rule_id.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>(),
            "unchecked must be the deduplicated, sorted limit set"
        );
    }

    /// Same invariant for the working-tree scan, which takes a different route
    /// (no commit context, no hygiene report to merge).
    #[test]
    fn working_tree_report_accounts_for_every_registry_rule() {
        let temp = crate::verify::hygiene::test_support::TempRepo::new();
        temp.commit("feat(app): seed", &[("src/app.ts", "export const a = 1;\n")]);
        std::fs::write(temp.dir.join("src/app.ts"), "export const a = 2;\n").ok();

        let diff = working_tree_diff(&temp.repo, false).expect("working tree diff");
        let ctx = context_from_diff(&temp.dir, &diff, None, Some("chore: tweak".to_string()));
        let report = run_diff_rules(&ctx, &RuleConfig::default());

        let covered: BTreeSet<&str> = report
            .checked
            .iter()
            .chain(report.unchecked.iter())
            .map(String::as_str)
            .collect();
        for entry in registry() {
            assert!(covered.contains(entry.id), "{} unaccounted for", entry.id);
        }
    }

    #[test]
    fn summary_counts_by_severity() {
        let report = VerificationReport::new(
            vec![
                Finding::new(FindingKind::TestFileDeleted, "a.ts", "danger"),
                Finding::new(FindingKind::ScopeDrift, "", "warn"),
                Finding::new(FindingKind::ReadLessEdit, "", "info"),
            ],
            Vec::new(),
            vec![limit("v1.structuralDiff", UncheckedReason::NotImplemented)],
        );

        let summary = summarize("abc", &report);
        assert_eq!(summary.max_severity, Some(Severity::Danger));
        assert_eq!(summary.danger_count, 1);
        assert_eq!(summary.warn_count, 1);
        assert_eq!(summary.info_count, 1);
        assert_eq!(summary.unchecked_count, 1);
    }
}
