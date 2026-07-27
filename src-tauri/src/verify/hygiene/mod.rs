//! Commit-level hygiene analysis — the post-commit verification surface.
//!
//! | Rule | Question | Module |
//! |---|---|---|
//! | V31 `v31.tangledCommit` | can this commit be reverted cleanly at all? | [`tangle`] |
//! | V32 `v32.revertUnsafe` | if we undo it, what actually happens? | [`revert`] |
//! | V35 `v35.agentTrailerMismatch` | does the attribution match the session record? | [`trailer`] |
//!
//! Every `git2` entry point here is a plain synchronous function taking
//! `&git2::Repository`. **Nothing in this module spawns** — the command layer
//! wraps calls in `tokio::task::spawn_blocking`.

pub mod revert;
pub mod tangle;
pub mod trailer;

#[cfg(test)]
pub(crate) mod test_support;

use std::collections::BTreeSet;

use git2::{Commit, Oid, Repository};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::verify::config::RuleConfig;
use crate::verify::types::{Finding, FindingKind, ScanLimit, UncheckedReason};

pub use revert::{
    analyze_revert_safety, revert_finding, LaterCommitTouch, RemediationOption, RevertOutcome,
    RevertSafety,
};
pub use tangle::{
    score_tangle, tangle_finding, FileCategory, TangleReason, TangleScore, TANGLE_THRESHOLD,
};
pub use trailer::{
    ai_attribution, cross_check_attribution, parse_trailers, trailer_finding, AiAttribution,
    CommitTrailer, TrailerCrossCheck,
};

/// Maximum length of a `Finding::detail` string (contract §2.2).
const MAX_DETAIL_CHARS: usize = 512;

/// The full hygiene picture for one commit, plus the report accounting the
/// integration layer needs to keep §7-① honest.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitHygiene {
    pub commit_id: String,
    /// `None` when V31 did not run (disabled, or a merge commit).
    pub tangle: Option<TangleScore>,
    /// `None` when V32 did not run (disabled).
    pub revert: Option<RevertSafety>,
    /// Always computed — parsing trailers is free and never fails.
    pub attribution: AiAttribution,
    pub trailer_check: TrailerCrossCheck,
    pub findings: Vec<Finding>,
    /// Reasons a hygiene rule did not run, or ran only partially.
    pub limits: Vec<ScanLimit>,
    /// Hygiene rule ids that actually ran against this commit.
    pub checked: Vec<String>,
}

/// Run V31 + V32 + V35 against one commit.
///
/// `session_edited_files` carries the file set a correlated session edited
/// (V30's output). Pass `None` when there is no session evidence: V35 then
/// records a `MissingArtifact` limit instead of producing a finding — absent
/// evidence is not negative evidence (§7-⑥).
///
/// Synchronous by design; wrap the call in `spawn_blocking`.
pub fn analyze_commit(
    repo: &Repository,
    oid: Oid,
    session_edited_files: Option<&[String]>,
    config: &RuleConfig,
) -> Result<CommitHygiene, AppError> {
    let commit = repo.find_commit(oid)?;
    let message = commit.message().unwrap_or("").to_string();
    let paths = commit_changed_paths(repo, &commit)?;

    let mut findings = Vec::new();
    let mut limits = Vec::new();
    let mut checked = Vec::new();

    let tangle = run_tangle(
        &commit,
        &message,
        &paths,
        config,
        &mut findings,
        &mut limits,
        &mut checked,
    );
    let revert = run_revert(
        repo,
        &commit,
        config,
        &mut findings,
        &mut limits,
        &mut checked,
    )?;
    let (attribution, trailer_check) = run_trailer(
        &message,
        &paths,
        session_edited_files,
        config,
        &mut findings,
        &mut limits,
        &mut checked,
    );

    Ok(CommitHygiene {
        commit_id: oid.to_string(),
        tangle,
        revert,
        attribution,
        trailer_check,
        findings,
        limits,
        checked,
    })
}

fn run_tangle(
    commit: &Commit<'_>,
    message: &str,
    paths: &[String],
    config: &RuleConfig,
    findings: &mut Vec<Finding>,
    limits: &mut Vec<ScanLimit>,
    checked: &mut Vec<String>,
) -> Option<TangleScore> {
    let rule_id = FindingKind::TangledCommit.rule_id();
    if !config.is_enabled(rule_id) {
        limits.push(limit(rule_id, UncheckedReason::Disabled, None));
        return None;
    }
    if commit.parent_count() > 1 {
        limits.push(limit(
            rule_id,
            UncheckedReason::NotApplicable,
            Some("merge commit has no single-parent change set"),
        ));
        return None;
    }
    checked.push(rule_id.to_string());
    let score = score_tangle(message, paths);
    if score.is_tangled {
        findings.push(tangle_finding(&score));
    }
    Some(score)
}

fn run_revert(
    repo: &Repository,
    commit: &Commit<'_>,
    config: &RuleConfig,
    findings: &mut Vec<Finding>,
    limits: &mut Vec<ScanLimit>,
    checked: &mut Vec<String>,
) -> Result<Option<RevertSafety>, AppError> {
    let rule_id = FindingKind::RevertUnsafe.rule_id();
    if !config.is_enabled(rule_id) {
        limits.push(limit(rule_id, UncheckedReason::Disabled, None));
        return Ok(None);
    }
    checked.push(rule_id.to_string());
    let safety = analyze_revert_safety(repo, commit)?;
    // A rule may legitimately appear in both `checked` and `unchecked`: the push
    // state was determined, but the conflict probe could not run.
    if let RevertOutcome::NotApplicable { reason } = &safety.revert_outcome {
        limits.push(limit(
            rule_id,
            UncheckedReason::NotApplicable,
            Some(reason.as_str()),
        ));
    }
    if let Some(finding) = revert_finding(&safety) {
        findings.push(finding);
    }
    Ok(Some(safety))
}

fn run_trailer(
    message: &str,
    paths: &[String],
    session_edited_files: Option<&[String]>,
    config: &RuleConfig,
    findings: &mut Vec<Finding>,
    limits: &mut Vec<ScanLimit>,
    checked: &mut Vec<String>,
) -> (AiAttribution, TrailerCrossCheck) {
    let rule_id = FindingKind::AgentTrailerMismatch.rule_id();
    let attribution = ai_attribution(message);

    let session_files = match (config.is_enabled(rule_id), session_edited_files) {
        (false, _) => {
            limits.push(limit(rule_id, UncheckedReason::Disabled, None));
            None
        }
        (true, None) => {
            limits.push(limit(
                rule_id,
                UncheckedReason::MissingArtifact,
                Some("no correlated session for this commit"),
            ));
            None
        }
        (true, Some(files)) => Some(files),
    };

    let check = cross_check_attribution(&attribution, paths, session_files.unwrap_or(&[]));
    if session_files.is_some() {
        checked.push(rule_id.to_string());
        if let Some(finding) = trailer_finding(&check) {
            findings.push(finding);
        }
    }
    (attribution, check)
}

/// Repo-relative paths a commit changed, compared against its first parent.
/// Root commits are compared against the empty tree; merge commits return an
/// empty set (their change set is not well defined without a mainline).
pub fn commit_changed_paths(
    repo: &Repository,
    commit: &Commit<'_>,
) -> Result<Vec<String>, AppError> {
    if commit.parent_count() > 1 {
        return Ok(Vec::new());
    }
    let new_tree = commit.tree()?;
    let old_tree = match commit.parent(0) {
        Ok(parent) => Some(parent.tree()?),
        Err(_) => None,
    };
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)?;

    let mut paths = BTreeSet::new();
    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str());
        if let Some(path) = path {
            paths.insert(path.to_string());
        }
    }
    Ok(paths.into_iter().collect())
}

fn limit(rule_id: &str, reason: UncheckedReason, detail: Option<&str>) -> ScanLimit {
    ScanLimit {
        rule_id: rule_id.to_string(),
        reason,
        detail: detail.map(str::to_string),
    }
}

/// Clamp evidence text to the contract's 512-character detail budget without
/// splitting a UTF-8 code point.
fn truncate_detail(detail: &str) -> String {
    match detail.char_indices().nth(MAX_DETAIL_CHARS) {
        Some((idx, _)) => detail[..idx].to_string(),
        None => detail.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::TempRepo;
    use super::*;

    fn all_on() -> RuleConfig {
        let mut config = RuleConfig::default();
        for kind in [
            FindingKind::TangledCommit,
            FindingKind::RevertUnsafe,
            FindingKind::AgentTrailerMismatch,
        ] {
            config.enabled.insert(kind.rule_id().to_string(), true);
        }
        config
    }

    fn tangled_files() -> Vec<(&'static str, &'static str)> {
        vec![
            ("src/components/verify/Panel.tsx", "a\n"),
            ("src/stores/verify.ts", "b\n"),
            ("src-tauri/src/verify/hygiene.rs", "c\n"),
            ("src-tauri/src/commands/verify.rs", "d\n"),
            ("docs/plan.md", "e\n"),
            ("README.md", "f\n"),
            (".github/workflows/ci.yml", "g\n"),
            ("package.json", "h\n"),
            ("public/logo.svg", "i\n"),
        ]
    }

    #[test]
    fn changed_paths_include_nested_and_deleted_files() {
        let temp = TempRepo::new();
        temp.commit("feat: a", &[("src/a.ts", "1\n"), ("src/b.ts", "2\n")]);
        let second = temp.commit("feat: c", &[("docs/c.md", "3\n")]);

        let commit = temp.repo.find_commit(second).unwrap();
        assert_eq!(
            commit_changed_paths(&temp.repo, &commit).unwrap(),
            vec!["docs/c.md".to_string()]
        );

        let root = temp.repo.find_commit(commit.parent_id(0).unwrap()).unwrap();
        assert_eq!(
            commit_changed_paths(&temp.repo, &root).unwrap(),
            vec!["src/a.ts".to_string(), "src/b.ts".to_string()]
        );
    }

    #[test]
    fn tangled_commit_is_reported_and_atomic_one_is_not() {
        let temp = TempRepo::new();
        temp.commit("chore: init", &[("seed.txt", "0\n")]);
        let tangled = temp.commit("feat(verify): add subsystem", &tangled_files());
        let atomic = temp.commit(
            "feat(branch): compare view",
            &[("src/components/branch/Compare.tsx", "x\n")],
        );
        let config = all_on();

        let report = analyze_commit(&temp.repo, tangled, None, &config).unwrap();
        assert!(report.tangle.as_ref().unwrap().is_tangled);
        assert!(report
            .findings
            .iter()
            .any(|f| f.kind == FindingKind::TangledCommit));
        assert!(report.checked.contains(&"v31.tangledCommit".to_string()));

        let report = analyze_commit(&temp.repo, atomic, None, &config).unwrap();
        assert!(!report.tangle.as_ref().unwrap().is_tangled);
        assert!(!report
            .findings
            .iter()
            .any(|f| f.kind == FindingKind::TangledCommit));
    }

    #[test]
    fn merge_commit_skips_tangle_scoring_with_a_reason() {
        let temp = TempRepo::new();
        let base = temp.commit("chore: init", &[("seed.txt", "0\n")]);
        let side = temp.commit_on(base, "feat: side", &[("side.txt", "s\n")]);
        let main = temp.commit("feat: main", &[("main.txt", "m\n")]);
        let merge = temp.merge_commit(main, side, "chore: merge side");

        let report = analyze_commit(&temp.repo, merge, None, &all_on()).unwrap();
        assert!(report.tangle.is_none());
        let limit = report
            .limits
            .iter()
            .find(|l| l.rule_id == "v31.tangledCommit")
            .expect("merge commits record a tangle limit");
        assert_eq!(limit.reason, UncheckedReason::NotApplicable);
        assert!(!report.checked.contains(&"v31.tangledCommit".to_string()));
    }

    #[test]
    fn disabled_rules_become_limits_not_silence() {
        let temp = TempRepo::new();
        temp.commit("chore: init", &[("seed.txt", "0\n")]);
        let tangled = temp.commit("feat(verify): add subsystem", &tangled_files());

        // Default config: v31/v32 on, v35 off (contract §2.4).
        let report = analyze_commit(&temp.repo, tangled, None, &RuleConfig::default()).unwrap();
        let reasons: Vec<_> = report
            .limits
            .iter()
            .filter(|l| l.rule_id == "v35.agentTrailerMismatch")
            .map(|l| l.reason)
            .collect();
        assert_eq!(reasons, vec![UncheckedReason::Disabled]);

        let mut off = RuleConfig::default();
        off.enabled.insert("v31.tangledCommit".to_string(), false);
        off.enabled.insert("v32.revertUnsafe".to_string(), false);
        let report = analyze_commit(&temp.repo, tangled, None, &off).unwrap();
        assert!(report.checked.is_empty());
        assert!(report.findings.is_empty());
        assert!(report.tangle.is_none());
        assert!(report.revert.is_none());
        assert_eq!(report.limits.len(), 3);
    }

    #[test]
    fn every_hygiene_rule_lands_in_checked_or_limits() {
        let temp = TempRepo::new();
        temp.commit("chore: init", &[("seed.txt", "0\n")]);
        let target = temp.commit("fix: tweak", &[("seed.txt", "1\n")]);
        let session = vec!["seed.txt".to_string()];

        for files in [None, Some(session.as_slice())] {
            let report = analyze_commit(&temp.repo, target, files, &all_on()).unwrap();
            let covered: BTreeSet<String> = report
                .checked
                .iter()
                .cloned()
                .chain(report.limits.iter().map(|l| l.rule_id.clone()))
                .collect();
            for kind in [
                FindingKind::TangledCommit,
                FindingKind::RevertUnsafe,
                FindingKind::AgentTrailerMismatch,
            ] {
                assert!(
                    covered.contains(kind.rule_id()),
                    "{} missing from checked ∪ limits",
                    kind.rule_id()
                );
            }
        }
    }

    #[test]
    fn session_evidence_without_a_trailer_is_flagged() {
        let temp = TempRepo::new();
        temp.commit("chore: init", &[("seed.txt", "0\n")]);
        let plain = temp.commit("fix: tweak", &[("seed.txt", "1\n")]);
        let session = vec!["/abs/repo/seed.txt".to_string()];

        let report = analyze_commit(&temp.repo, plain, Some(&session), &all_on()).unwrap();
        assert!(matches!(
            report.trailer_check,
            TrailerCrossCheck::MissingTrailer { .. }
        ));
        assert!(report
            .findings
            .iter()
            .any(|f| f.kind == FindingKind::AgentTrailerMismatch));

        let attributed = temp.commit(
            "fix: tweak again\n\nAssisted-by: Claude Opus\n",
            &[("seed.txt", "2\n")],
        );
        let report = analyze_commit(&temp.repo, attributed, Some(&session), &all_on()).unwrap();
        assert_eq!(report.attribution.agents, vec!["claude".to_string()]);
        assert!(matches!(
            report.trailer_check,
            TrailerCrossCheck::Confirmed { .. }
        ));
        assert!(!report
            .findings
            .iter()
            .any(|f| f.kind == FindingKind::AgentTrailerMismatch));
    }

    #[test]
    fn missing_session_evidence_is_a_limit_not_a_finding() {
        let temp = TempRepo::new();
        temp.commit("chore: init", &[("seed.txt", "0\n")]);
        let plain = temp.commit("fix: tweak", &[("seed.txt", "1\n")]);

        let report = analyze_commit(&temp.repo, plain, None, &all_on()).unwrap();
        assert!(!report
            .findings
            .iter()
            .any(|f| f.kind == FindingKind::AgentTrailerMismatch));
        let limit = report
            .limits
            .iter()
            .find(|l| l.rule_id == "v35.agentTrailerMismatch")
            .expect("no session evidence records a limit");
        assert_eq!(limit.reason, UncheckedReason::MissingArtifact);
    }

    #[test]
    fn truncate_detail_respects_char_boundaries() {
        let short = "src/a.ts, src/b.ts";
        assert_eq!(truncate_detail(short), short);

        let long = "가".repeat(600);
        let cut = truncate_detail(&long);
        assert_eq!(cut.chars().count(), MAX_DETAIL_CHARS);
    }
}
