//! Derived session signals (V19–V25): [`SessionSummary`] → [`VerificationReport`].
//!
//! Two invariants drive the shape of this file:
//!
//! * Every registry rule appears in `checked` or `unchecked` (contract §2.3).
//!   A session scan does not evaluate diff rules, so it must say so rather than
//!   let them silently vanish — an empty findings list never means "safe".
//! * A signal that cannot be derived for a given agent is reported as *not
//!   applicable*, never guessed. Codex has no distinct read tool and no
//!   sidechain or compaction records, so V19/V22/V23/V24 are unavailable
//!   there.

use std::collections::BTreeSet;

use crate::verify::config::RuleConfig;
use crate::verify::registry::{self, RuleStatus};
use crate::verify::types::{
    BashCommandKind, Finding, FindingKind, ScanLimit, SessionSource, SessionSummary,
    UncheckedReason, VerificationReport,
};

/// Failed test runs before a test file is edited, at or above which the
/// sequence is reported. Two is the smallest count that distinguishes
/// "iterating" from "the suite disagreed and the test changed".
pub const TEST_FAILURE_THRESHOLD: usize = 2;
/// Edits to one file at or above which the churn signal fires (V25).
pub const CHURN_THRESHOLD: u32 = 3;

/// Rules this module can evaluate, in report order.
const SESSION_KINDS: &[FindingKind] = &[
    FindingKind::ReadLessEdit,
    FindingKind::TestFailureThenTestEdited,
    FindingKind::TestsNeverRunInSession,
    FindingKind::HookBypassCommand,
    FindingKind::UnrewindableChange,
    FindingKind::SubagentEdit,
    FindingKind::PostCompactionEdit,
    FindingKind::RepeatedEdit,
];

/// Session-log rules this phase does not implement. They are reported as
/// `NotImplemented` rather than falling through to "not a session-log rule",
/// which would be a lie about why they never ran.
///
/// * V26 needs prompt→path extraction, and a weak version of it is a false
///   positive generator; it is default-off and deferred deliberately.
/// * V27 has no data source today: current Claude Code builds do not write the
///   injected CLAUDE.md into the session log at all (verified against live
///   logs — zero occurrences), so the digest is almost always `None`.
const UNIMPLEMENTED_KINDS: &[FindingKind] =
    &[FindingKind::PromptScopeDrift, FindingKind::StaleRulesInjected];

/// Rules that only Claude Code sessions carry the raw data for.
const CLAUDE_ONLY_KINDS: &[FindingKind] = &[
    FindingKind::ReadLessEdit,
    FindingKind::UnrewindableChange,
    FindingKind::SubagentEdit,
    FindingKind::PostCompactionEdit,
];

/// Evaluate every session rule against one summary.
pub fn run_session_rules(summary: &SessionSummary, config: &RuleConfig) -> VerificationReport {
    let mut findings = Vec::new();
    let mut checked = Vec::new();
    let mut limits = Vec::new();

    for kind in SESSION_KINDS {
        let rule_id = kind.rule_id();

        if !config.is_enabled(rule_id) {
            limits.push(limit(rule_id, UncheckedReason::Disabled, None));
            continue;
        }
        if summary.source != SessionSource::ClaudeCode && CLAUDE_ONLY_KINDS.contains(kind) {
            limits.push(limit(
                rule_id,
                UncheckedReason::NotApplicable,
                Some("codex sessions do not record reads, sidechains or compaction"),
            ));
            continue;
        }

        checked.push(rule_id.to_string());
        findings.extend(evaluate(*kind, summary));

        // A partially read log makes every derived signal a partial
        // observation, so the rule is reported as both checked and limited.
        if summary.truncated {
            limits.push(limit(
                rule_id,
                UncheckedReason::BudgetExceeded,
                Some("session log exceeded the parse budget; tail not read"),
            ));
        } else if summary.skipped_records > 0 {
            limits.push(limit(
                rule_id,
                UncheckedReason::ParseFailed,
                Some(&format!("{} unreadable records skipped", summary.skipped_records)),
            ));
        }
    }

    for kind in UNIMPLEMENTED_KINDS {
        limits.push(limit(kind.rule_id(), UncheckedReason::NotImplemented, None));
    }

    fill_registry_coverage(&checked, &mut limits);
    VerificationReport::new(findings, checked, limits)
}

fn evaluate(kind: FindingKind, summary: &SessionSummary) -> Vec<Finding> {
    match kind {
        FindingKind::ReadLessEdit => read_less_edits(summary),
        FindingKind::TestFailureThenTestEdited => test_failure_then_test_edited(summary),
        FindingKind::TestsNeverRunInSession => tests_never_run(summary),
        FindingKind::HookBypassCommand => hook_bypass_commands(summary),
        FindingKind::UnrewindableChange => unrewindable_changes(summary),
        FindingKind::SubagentEdit => subagent_edits(summary),
        FindingKind::PostCompactionEdit => post_compaction_edits(summary),
        FindingKind::RepeatedEdit => repeated_edits(summary),
        _ => Vec::new(),
    }
}

/// V19 — edited without ever being read in this session.
///
/// Bash-created files are excluded: a file written by a shell redirect was
/// never going to be "read" first, and flagging it adds noise to a signal the
/// spec says to treat as a review-priority weight, not a warning.
fn read_less_edits(summary: &SessionSummary) -> Vec<Finding> {
    summary
        .files_edited
        .iter()
        .filter(|f| !f.was_read_first && !f.via_bash)
        .map(|f| {
            Finding::new(
                FindingKind::ReadLessEdit,
                f.path.clone(),
                format!("edited {} time(s), never read in this session", f.edit_count),
            )
        })
        .collect()
}

/// V20 — the agent watched the suite fail, then changed a test.
///
/// This is the sequence that supplies the *motive* for V2 (test disabling):
/// static analysis sees only the resulting diff, the session log sees the
/// order events happened in.
fn test_failure_then_test_edited(summary: &SessionSummary) -> Vec<Finding> {
    let failures: Vec<i64> = summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::TestRun && c.is_error)
        .map(|c| c.at)
        .collect();
    if failures.len() < TEST_FAILURE_THRESHOLD {
        return Vec::new();
    }

    summary
        .files_edited
        .iter()
        .filter(|f| is_test_path(&f.path))
        .filter_map(|f| {
            let before = failures.iter().filter(|at| **at < f.last_edit_at).count();
            (before >= TEST_FAILURE_THRESHOLD).then(|| {
                Finding::new(
                    FindingKind::TestFailureThenTestEdited,
                    f.path.clone(),
                    format!("{} failing test run(s) preceded an edit to this test file", before),
                )
                .with_detail(failing_test_commands(summary))
            })
        })
        .collect()
}

fn failing_test_commands(summary: &SessionSummary) -> String {
    summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::TestRun && c.is_error)
        .map(|c| c.command.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// V20 — code changed but the suite was never run.
fn tests_never_run(summary: &SessionSummary) -> Vec<Finding> {
    if summary.files_edited.is_empty() {
        return Vec::new();
    }
    if summary
        .bash_commands
        .iter()
        .any(|c| c.kind == BashCommandKind::TestRun)
    {
        return Vec::new();
    }
    vec![Finding::new(
        FindingKind::TestsNeverRunInSession,
        "",
        format!(
            "{} file(s) edited, no test command run in this session",
            summary.files_edited.len()
        ),
    )]
}

/// V21 — hook and safety bypasses leave no trace in the diff.
fn hook_bypass_commands(summary: &SessionSummary) -> Vec<Finding> {
    summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::HookBypass)
        .map(|c| {
            Finding::new(
                FindingKind::HookBypassCommand,
                "",
                "verification bypass in a shell command".to_string(),
            )
            .with_detail(c.command.clone())
        })
        .collect()
}

/// V22 — changes made through the shell are outside checkpoint restore.
fn unrewindable_changes(summary: &SessionSummary) -> Vec<Finding> {
    let mut findings: Vec<Finding> = summary
        .files_edited
        .iter()
        .filter(|f| f.via_bash)
        .map(|f| {
            Finding::new(
                FindingKind::UnrewindableChange,
                f.path.clone(),
                "changed through a shell command; checkpoint restore does not cover it".to_string(),
            )
        })
        .collect();

    // Mutating commands whose target we could not name still deserve a
    // session-level note — silence would read as "nothing happened".
    let named: BTreeSet<&str> = summary
        .files_edited
        .iter()
        .filter(|f| f.via_bash)
        .map(|f| f.path.as_str())
        .collect();
    let unnamed: Vec<&str> = summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::FileMutation)
        .filter(|c| !named.iter().any(|path| c.command.contains(path)))
        .map(|c| c.command.as_str())
        .collect();

    if !unnamed.is_empty() {
        findings.push(
            Finding::new(
                FindingKind::UnrewindableChange,
                "",
                format!(
                    "{} shell command(s) mutated files outside checkpoint restore",
                    unnamed.len()
                ),
            )
            .with_detail(unnamed.join("\n")),
        );
    }
    findings
}

/// V23 — work the human *and* the main agent only ever saw summarised.
fn subagent_edits(summary: &SessionSummary) -> Vec<Finding> {
    summary
        .files_edited
        .iter()
        .filter(|f| f.by_subagent)
        .map(|f| {
            Finding::new(
                FindingKind::SubagentEdit,
                f.path.clone(),
                "edited inside a subagent sidechain; only a summary reached the main context"
                    .to_string(),
            )
        })
        .collect()
}

/// V24 — edited after the context was compacted.
fn post_compaction_edits(summary: &SessionSummary) -> Vec<Finding> {
    if summary.compaction_boundaries.is_empty() {
        return Vec::new();
    }
    summary
        .files_edited
        .iter()
        .filter(|f| f.after_compaction)
        .map(|f| {
            Finding::new(
                FindingKind::PostCompactionEdit,
                f.path.clone(),
                format!(
                    "edited after {} context compaction(s); earlier instructions may have been dropped",
                    summary.compaction_boundaries.len()
                ),
            )
        })
        .collect()
}

/// V25 — repeated edits to one file mean the agent was searching, not solving.
fn repeated_edits(summary: &SessionSummary) -> Vec<Finding> {
    summary
        .files_edited
        .iter()
        .filter(|f| f.edit_count >= CHURN_THRESHOLD)
        .map(|f| {
            Finding::new(
                FindingKind::RepeatedEdit,
                f.path.clone(),
                format!("edited {} times in one session", f.edit_count),
            )
        })
        .collect()
}

/// Path-based test detection, matching the convention used by the static rules.
pub fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.contains("__tests__/")
        || lower.contains("/tests/")
        || lower.starts_with("tests/")
        || lower.ends_with("_test.rs")
        || lower.ends_with("_test.go")
        || lower.contains("/test_")
}

fn limit(rule_id: &str, reason: UncheckedReason, detail: Option<&str>) -> ScanLimit {
    ScanLimit {
        rule_id: rule_id.to_string(),
        reason,
        detail: detail.map(str::to_string),
    }
}

/// Guarantee §7-①: a rule this scan never ran must still be accounted for.
fn fill_registry_coverage(checked: &[String], limits: &mut Vec<ScanLimit>) {
    let covered: BTreeSet<&str> = checked
        .iter()
        .map(String::as_str)
        .chain(limits.iter().map(|l| l.rule_id.as_str()))
        .collect();

    let missing: Vec<ScanLimit> = registry::registry()
        .iter()
        .filter(|entry| !covered.contains(entry.id))
        .map(|entry| match entry.status {
            RuleStatus::Planned => limit(entry.id, UncheckedReason::NotImplemented, None),
            RuleStatus::Implemented => limit(
                entry.id,
                UncheckedReason::NotApplicable,
                Some("session"),
            ),
        })
        .collect();
    limits.extend(missing);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::session::test_support::{fixture, TempDir};
    use crate::verify::session::{claude_code::ClaudeCodeAdapter, summary::summarize_with};
    use crate::verify::types::Severity;

    /// Every session rule on, so tests exercise the rule and not the config.
    fn all_on() -> RuleConfig {
        let mut config = RuleConfig::default();
        for kind in SESSION_KINDS {
            config.enabled.insert(kind.rule_id().to_string(), true);
        }
        config
    }

    fn summarize(body: &str) -> SessionSummary {
        let dir = TempDir::new();
        let path = dir.write("s.jsonl", body);
        summarize_with(&path, &ClaudeCodeAdapter)
            .expect("open")
            .expect("summary")
    }

    fn report(body: &str) -> VerificationReport {
        run_session_rules(&summarize(body), &all_on())
    }

    fn kinds(report: &VerificationReport, kind: FindingKind) -> Vec<&Finding> {
        report.findings.iter().filter(|f| f.kind == kind).collect()
    }

    // ── §2.3 invariant ────────────────────────────────────────────────────

    #[test]
    fn report_always_covers_the_whole_registry() {
        for body in [fixture::normal_session(), String::new() + &fixture::lines(&[
            fixture::assistant_edit("t1", "/repo/a.rs", "2026-03-09T05:00:00.000Z", false),
        ])] {
            let report = report(&body);
            let covered: BTreeSet<&str> = report
                .checked
                .iter()
                .chain(report.unchecked.iter())
                .map(String::as_str)
                .collect();
            for entry in registry::registry() {
                assert!(
                    covered.contains(entry.id),
                    "{} missing from checked ∪ unchecked",
                    entry.id
                );
            }
        }
    }

    #[test]
    fn unchecked_is_the_deduplicated_limit_set() {
        let report = report(&fixture::normal_session());
        let expected: BTreeSet<String> =
            report.limits.iter().map(|l| l.rule_id.clone()).collect();
        assert_eq!(report.unchecked, expected.into_iter().collect::<Vec<_>>());
    }

    #[test]
    fn a_clean_session_still_reports_unchecked_rules() {
        let report = report(&fixture::normal_session());
        assert!(report.findings.is_empty(), "nothing to flag here");
        assert!(
            !report.unchecked.is_empty(),
            "an empty findings list must never read as 'safe'"
        );
    }

    #[test]
    fn disabled_rules_are_reported_as_disabled_not_omitted() {
        let mut config = all_on();
        config
            .enabled
            .insert(FindingKind::ReadLessEdit.rule_id().to_string(), false);
        let report = run_session_rules(&summarize(&fixture::normal_session()), &config);
        assert!(report.limits.iter().any(|l| l.rule_id
            == FindingKind::ReadLessEdit.rule_id()
            && l.reason == UncheckedReason::Disabled));
    }

    // ── V19 ───────────────────────────────────────────────────────────────

    #[test]
    fn v19_flags_edits_without_a_prior_read() {
        let body = fixture::lines(&[
            fixture::assistant_read("t1", "/repo/read.rs", "2026-03-09T05:00:00.000Z"),
            fixture::assistant_edit("t2", "/repo/read.rs", "2026-03-09T05:01:00.000Z", false),
            fixture::assistant_edit("t3", "/repo/blind.rs", "2026-03-09T05:02:00.000Z", false),
        ]);
        let report = report(&body);
        let found = kinds(&report, FindingKind::ReadLessEdit);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "/repo/blind.rs");
    }

    #[test]
    fn v19_never_exceeds_info_severity() {
        let body = fixture::lines(&[fixture::assistant_edit(
            "t1",
            "/repo/blind.rs",
            "2026-03-09T05:00:00.000Z",
            false,
        )]);
        let report = report(&body);
        for finding in kinds(&report, FindingKind::ReadLessEdit) {
            assert_eq!(
                finding.severity,
                Severity::Info,
                "spec §7-⑨: a review-priority weight, not a warning"
            );
        }
    }

    #[test]
    fn v19_is_not_applicable_to_codex_sessions() {
        let dir = TempDir::new();
        let path = dir.write("rollout-a.jsonl", &fixture::codex_session("/repo"));
        let summary = crate::verify::session::summarize_session_at(&path)
            .expect("open")
            .expect("summary");
        let report = run_session_rules(&summary, &all_on());
        assert!(report.limits.iter().any(|l| l.rule_id
            == FindingKind::ReadLessEdit.rule_id()
            && l.reason == UncheckedReason::NotApplicable));
        assert!(kinds(&report, FindingKind::ReadLessEdit).is_empty());
    }

    // ── V20 ───────────────────────────────────────────────────────────────

    #[test]
    fn v20_flags_failing_tests_followed_by_a_test_edit() {
        let body = fixture::lines(&[
            fixture::assistant_bash("t1", "cargo test", "2026-03-09T05:00:00.000Z"),
            fixture::tool_result("t1", true, "2026-03-09T05:00:10.000Z"),
            fixture::assistant_bash("t2", "cargo test", "2026-03-09T05:01:00.000Z"),
            fixture::tool_result("t2", true, "2026-03-09T05:01:10.000Z"),
            fixture::assistant_edit(
                "t3",
                "/repo/src/parser_test.rs",
                "2026-03-09T05:02:00.000Z",
                false,
            ),
        ]);
        let report = report(&body);
        let found = kinds(&report, FindingKind::TestFailureThenTestEdited);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "/repo/src/parser_test.rs");
        assert_eq!(found[0].severity, Severity::Danger);
        assert!(found[0].message.contains('2'));
    }

    #[test]
    fn v20_does_not_fire_when_the_test_edit_came_first() {
        let body = fixture::lines(&[
            fixture::assistant_edit(
                "t0",
                "/repo/src/parser_test.rs",
                "2026-03-09T05:00:00.000Z",
                false,
            ),
            fixture::assistant_bash("t1", "cargo test", "2026-03-09T05:01:00.000Z"),
            fixture::tool_result("t1", true, "2026-03-09T05:01:10.000Z"),
            fixture::assistant_bash("t2", "cargo test", "2026-03-09T05:02:00.000Z"),
            fixture::tool_result("t2", true, "2026-03-09T05:02:10.000Z"),
        ]);
        assert!(kinds(&report(&body), FindingKind::TestFailureThenTestEdited).is_empty());
    }

    #[test]
    fn v20_does_not_fire_on_passing_runs_or_non_test_files() {
        let body = fixture::lines(&[
            fixture::assistant_bash("t1", "cargo test", "2026-03-09T05:00:00.000Z"),
            fixture::tool_result("t1", false, "2026-03-09T05:00:10.000Z"),
            fixture::assistant_bash("t2", "cargo test", "2026-03-09T05:01:00.000Z"),
            fixture::tool_result("t2", false, "2026-03-09T05:01:10.000Z"),
            fixture::assistant_edit(
                "t3",
                "/repo/src/parser_test.rs",
                "2026-03-09T05:02:00.000Z",
                false,
            ),
        ]);
        assert!(kinds(&report(&body), FindingKind::TestFailureThenTestEdited).is_empty());

        let body = fixture::lines(&[
            fixture::assistant_bash("t1", "cargo test", "2026-03-09T05:00:00.000Z"),
            fixture::tool_result("t1", true, "2026-03-09T05:00:10.000Z"),
            fixture::assistant_bash("t2", "cargo test", "2026-03-09T05:01:00.000Z"),
            fixture::tool_result("t2", true, "2026-03-09T05:01:10.000Z"),
            fixture::assistant_edit("t3", "/repo/src/parser.rs", "2026-03-09T05:02:00.000Z", false),
        ]);
        assert!(kinds(&report(&body), FindingKind::TestFailureThenTestEdited).is_empty());
    }

    #[test]
    fn v20_flags_a_session_that_never_ran_tests() {
        let body = fixture::lines(&[fixture::assistant_edit(
            "t1",
            "/repo/a.rs",
            "2026-03-09T05:00:00.000Z",
            false,
        )]);
        let found = report(&body);
        assert_eq!(kinds(&found, FindingKind::TestsNeverRunInSession).len(), 1);
        // Commit-level finding: no single file owns it.
        assert!(!kinds(&found, FindingKind::TestsNeverRunInSession)[0].is_file_scoped());

        assert!(kinds(
            &report(&fixture::normal_session()),
            FindingKind::TestsNeverRunInSession
        )
        .is_empty());
    }

    // ── V21 / V22 / V23 / V24 / V25 ───────────────────────────────────────

    #[test]
    fn v21_flags_bypasses_and_quotes_the_command() {
        let body = fixture::lines(&[fixture::assistant_bash(
            "t1",
            "git commit --no-verify -m wip",
            "2026-03-09T05:00:00.000Z",
        )]);
        let report = report(&body);
        let found = kinds(&report, FindingKind::HookBypassCommand);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].severity, Severity::Danger);
        assert_eq!(found[0].detail.as_deref(), Some("git commit --no-verify -m wip"));
    }

    #[test]
    fn v22_flags_shell_mutations_as_outside_rewind() {
        let body = fixture::lines(&[fixture::assistant_bash(
            "t1",
            "echo x > /repo/gen.ts",
            "2026-03-09T05:00:00.000Z",
        )]);
        let report = report(&body);
        let found = kinds(&report, FindingKind::UnrewindableChange);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "/repo/gen.ts");
    }

    #[test]
    fn v22_still_reports_mutations_whose_target_is_unknown() {
        let body = fixture::lines(&[fixture::assistant_bash(
            "t1",
            "make clean && cp $SRC $DST",
            "2026-03-09T05:00:00.000Z",
        )]);
        let report = report(&body);
        let found = kinds(&report, FindingKind::UnrewindableChange);
        assert_eq!(found.len(), 1);
        assert!(!found[0].is_file_scoped());
    }

    #[test]
    fn v23_isolates_subagent_edits() {
        let body = fixture::lines(&[
            fixture::assistant_edit("t1", "/repo/main.rs", "2026-03-09T05:00:00.000Z", false),
            fixture::assistant_edit("t2", "/repo/sub.rs", "2026-03-09T05:01:00.000Z", true),
        ]);
        let report = report(&body);
        let found = kinds(&report, FindingKind::SubagentEdit);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "/repo/sub.rs");
    }

    #[test]
    fn v24_flags_only_edits_after_the_boundary() {
        let body = fixture::lines(&[
            fixture::assistant_edit("t1", "/repo/before.rs", "2026-03-09T05:00:00.000Z", false),
            fixture::compact_boundary("2026-03-09T05:30:00.000Z"),
            fixture::assistant_edit("t2", "/repo/after.rs", "2026-03-09T06:00:00.000Z", false),
        ]);
        let report = report(&body);
        let found = kinds(&report, FindingKind::PostCompactionEdit);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "/repo/after.rs");
    }

    #[test]
    fn v25_flags_churn_at_the_threshold() {
        let mut records = Vec::new();
        for i in 0..CHURN_THRESHOLD {
            records.push(fixture::assistant_edit(
                &format!("t{}", i),
                "/repo/churn.rs",
                &format!("2026-03-09T05:0{}:00.000Z", i),
                false,
            ));
        }
        records.push(fixture::assistant_edit(
            "s1",
            "/repo/calm.rs",
            "2026-03-09T05:09:00.000Z",
            false,
        ));
        let report = report(&fixture::lines(&records));
        let found = kinds(&report, FindingKind::RepeatedEdit);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "/repo/churn.rs");
    }

    // ── Partial observation ───────────────────────────────────────────────

    #[test]
    fn skipped_records_mark_every_session_rule_as_partial() {
        let mut body = fixture::normal_session();
        body.push_str("not json\n");
        let report = report(&body);
        for kind in SESSION_KINDS {
            assert!(
                report.limits.iter().any(|l| l.rule_id == kind.rule_id()
                    && l.reason == UncheckedReason::ParseFailed),
                "{} should be marked partially observed",
                kind.rule_id()
            );
            assert!(
                report.checked.iter().any(|id| id == kind.rule_id()),
                "{} still ran on what was readable",
                kind.rule_id()
            );
        }
    }

    /// A kind this module reports as `NotImplemented` must not be an
    /// `Implemented` registry row. Those two claims contradict each other, and
    /// the registry is the one the settings screen believes.
    #[test]
    fn kinds_this_module_never_evaluates_are_planned_in_the_registry() {
        for kind in UNIMPLEMENTED_KINDS {
            let entry = registry::find(kind.rule_id())
                .unwrap_or_else(|| panic!("{} is missing from the registry", kind.rule_id()));
            assert_eq!(
                entry.status,
                RuleStatus::Planned,
                "{} is unimplemented here but claims Implemented in the registry",
                entry.id
            );
            assert!(
                !SESSION_KINDS.contains(kind),
                "{} cannot be both evaluated and unimplemented",
                entry.id
            );
        }
    }

    #[test]
    fn unimplemented_session_rules_say_so_rather_than_claiming_irrelevance() {
        let report = report(&fixture::normal_session());
        for kind in UNIMPLEMENTED_KINDS {
            let entry = report
                .limits
                .iter()
                .find(|l| l.rule_id == kind.rule_id())
                .unwrap_or_else(|| panic!("{} unaccounted for", kind.rule_id()));
            assert_eq!(
                entry.reason,
                UncheckedReason::NotImplemented,
                "{} is a session rule that was not built, not an inapplicable one",
                kind.rule_id()
            );
        }
    }

    #[test]
    fn a_truncated_log_marks_every_session_rule_as_budget_limited() {
        let mut summary = summarize(&fixture::normal_session());
        summary.truncated = true;
        let report = run_session_rules(&summary, &all_on());
        for kind in SESSION_KINDS {
            assert!(
                report.limits.iter().any(|l| l.rule_id == kind.rule_id()
                    && l.reason == UncheckedReason::BudgetExceeded),
                "{} must disclose that the log tail was never read",
                kind.rule_id()
            );
        }
    }

    #[test]
    fn detects_test_paths_across_conventions() {
        assert!(is_test_path("src/a.test.ts"));
        assert!(is_test_path("src/a.spec.tsx"));
        assert!(is_test_path("src/__tests__/a.ts"));
        assert!(is_test_path("crates/x/tests/integration.rs"));
        assert!(is_test_path("src/parser_test.rs"));
        assert!(!is_test_path("src/parser.rs"));
        assert!(!is_test_path("src/latest.ts"));
    }
}
