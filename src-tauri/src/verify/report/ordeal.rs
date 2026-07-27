//! § What it went through — the sequence, not the summary.
//!
//! The diff shows the destination. This section shows the road: which commands
//! failed, in what order, and what the agent changed next. The one line that
//! most changes a reader's next action — "the suite failed N times, then the
//! test file was edited" — is lifted out of the event stream into its own field
//! so it cannot be lost among a hundred shell calls.
//!
//! `BashCommandKind::Other` never enters the stream. A hundred `ls` calls are
//! not a story, and a page that lists them is the "vague pile of information"
//! this rewrite exists to stop.

use crate::verify::session::bash;
use crate::verify::session::jsonl::truncate_chars;
use crate::verify::session::rules::{is_test_path, TEST_FAILURE_THRESHOLD};
use crate::verify::types::{BashCommandKind, BashCommandRecord, SessionSummary, Severity};

use super::model::{
    OrdealEvent, OrdealKind, Provenance, TestEditAfterFailure, Unavailable, UnavailableReason,
    WentThroughSection,
};
use super::{MAX_EVIDENCE_CHARS, MAX_FAILING_COMMANDS, MAX_REPORT_EVENTS};

pub fn build(summary: &SessionSummary) -> WentThroughSection {
    let bash_total = summary.bash_commands.len();
    let test_runs = summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::TestRun)
        .count();
    let failed_test_runs = summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::TestRun && c.is_error)
        .count();

    let mut events: Vec<OrdealEvent> = Vec::new();

    for command in &summary.bash_commands {
        let kind = match command.kind {
            BashCommandKind::TestRun if command.is_error => OrdealKind::TestFailed,
            BashCommandKind::TestRun => OrdealKind::TestPassed,
            BashCommandKind::HookBypass => OrdealKind::HookBypass,
            BashCommandKind::FileMutation => OrdealKind::ShellMutation,
            // Silence is the point.
            BashCommandKind::Other => continue,
        };
        events.push(OrdealEvent {
            at: command.at,
            kind,
            evidence: truncate_chars(&command.command, MAX_EVIDENCE_CHARS),
            detail: evidence_detail(kind, command),
            severity: severity_of(kind),
            provenance: Provenance::SessionLog,
        });
    }

    for at in &summary.compaction_boundaries {
        events.push(OrdealEvent {
            at: *at,
            kind: OrdealKind::Compaction,
            evidence: "context compacted".to_string(),
            detail: None,
            severity: severity_of(OrdealKind::Compaction),
            provenance: Provenance::SessionLog,
        });
    }

    for file in summary.files_edited.iter().filter(|f| f.by_subagent) {
        events.push(OrdealEvent {
            at: file.first_edit_at,
            kind: OrdealKind::SubagentEdit,
            evidence: truncate_chars(&file.path, MAX_EVIDENCE_CHARS),
            detail: Some(format!(
                "{} edit(s) inside a subagent sidechain; only a summary reached the main context",
                file.edit_count
            )),
            severity: severity_of(OrdealKind::SubagentEdit),
            provenance: Provenance::SessionLog,
        });
    }

    events.sort_by_key(|event| event.at);
    events.truncate(MAX_REPORT_EVENTS);

    let test_edits_after_failure = test_edits_after_failure(summary);
    let never_ran_tests = !summary.files_edited.is_empty() && test_runs == 0;

    let nothing_to_say =
        events.is_empty() && test_edits_after_failure.is_empty() && !never_ran_tests;

    WentThroughSection {
        unavailable: nothing_to_say.then(|| {
            Unavailable::with_detail(
                UnavailableReason::NotApplicable,
                "the session ran no command worth reporting",
            )
        }),
        bash_total,
        test_runs,
        failed_test_runs,
        events: if nothing_to_say { Vec::new() } else { events },
        test_edits_after_failure,
        never_ran_tests,
    }
}

/// V20's sequence, kept as structured data instead of a sentence.
///
/// The predicate is V20's exactly — same threshold, same test-path test — so
/// the two can never disagree about whether the sequence happened. What differs
/// is the shape: the report needs the count and the commands as fields, and
/// re-parsing them out of a finding message would be worse than sharing the
/// predicate.
fn test_edits_after_failure(summary: &SessionSummary) -> Vec<TestEditAfterFailure> {
    let failures: Vec<i64> = summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::TestRun && c.is_error)
        .map(|c| c.at)
        .collect();
    if failures.len() < TEST_FAILURE_THRESHOLD {
        return Vec::new();
    }

    let failing_commands: Vec<String> = summary
        .bash_commands
        .iter()
        .filter(|c| c.kind == BashCommandKind::TestRun && c.is_error)
        .map(|c| c.command.clone())
        .take(MAX_FAILING_COMMANDS)
        .collect();

    summary
        .files_edited
        .iter()
        .filter(|file| is_test_path(&file.path))
        .filter_map(|file| {
            let before = failures.iter().filter(|at| **at < file.last_edit_at).count();
            (before >= TEST_FAILURE_THRESHOLD).then(|| TestEditAfterFailure {
                test_path: file.path.clone(),
                failures_before: before,
                failing_commands: failing_commands.clone(),
                edited_at: file.last_edit_at,
            })
        })
        .collect()
}

/// What the classifier actually recognised, quoted rather than paraphrased.
///
/// Bypass tokens are carried on the record itself. Mutated paths are not, so
/// they are recomputed — classification is a pure function of the command text,
/// and this only runs for the handful of commands that mutate.
fn evidence_detail(kind: OrdealKind, command: &BashCommandRecord) -> Option<String> {
    match kind {
        OrdealKind::HookBypass => {
            (!command.bypass_markers.is_empty()).then(|| command.bypass_markers.join(" · "))
        }
        OrdealKind::ShellMutation => {
            let paths = bash::classify(&command.command).mutated_paths;
            (!paths.is_empty()).then(|| paths.join(" · "))
        }
        _ => None,
    }
}

fn severity_of(kind: OrdealKind) -> Severity {
    match kind {
        OrdealKind::HookBypass => Severity::Danger,
        OrdealKind::TestFailed | OrdealKind::ShellMutation => Severity::Warn,
        OrdealKind::TestPassed | OrdealKind::Compaction | OrdealKind::SubagentEdit => Severity::Info,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::report::testutil::summarize;
    use crate::verify::session::test_support::fixture;

    #[test]
    fn routine_shell_calls_never_enter_the_stream() {
        let summary = summarize(&fixture::lines(&[
            fixture::assistant_bash("t1", "ls -la", "2026-03-09T05:00:00.000Z"),
            fixture::assistant_bash("t2", "git status", "2026-03-09T05:01:00.000Z"),
            fixture::assistant_bash("t3", "cargo test", "2026-03-09T05:02:00.000Z"),
        ]));
        let section = build(&summary);
        assert_eq!(section.bash_total, 3);
        assert_eq!(section.events.len(), 1, "only the test run is a story");
        assert_eq!(section.events[0].kind, OrdealKind::TestPassed);
    }

    #[test]
    fn a_bypass_carries_the_token_it_was_recognised_by() {
        let summary = summarize(&fixture::lines(&[fixture::assistant_bash(
            "t1",
            "git commit --no-verify -m wip",
            "2026-03-09T05:00:00.000Z",
        )]));
        let section = build(&summary);
        assert_eq!(section.events[0].kind, OrdealKind::HookBypass);
        assert_eq!(section.events[0].severity, Severity::Danger);
        assert_eq!(section.events[0].detail.as_deref(), Some("--no-verify"));
        assert_eq!(section.events[0].evidence, "git commit --no-verify -m wip");
    }

    #[test]
    fn the_failure_then_test_edit_sequence_is_promoted_out_of_the_stream() {
        let summary = summarize(&fixture::lines(&[
            fixture::assistant_bash("t1", "cargo test", "2026-03-09T05:00:00.000Z"),
            fixture::tool_result("t1", true, "2026-03-09T05:00:10.000Z"),
            fixture::assistant_bash("t2", "cargo test --lib", "2026-03-09T05:01:00.000Z"),
            fixture::tool_result("t2", true, "2026-03-09T05:01:10.000Z"),
            fixture::assistant_edit(
                "t3",
                "/repo/src/parser_test.rs",
                "2026-03-09T05:02:00.000Z",
                false,
            ),
        ]));
        let section = build(&summary);
        assert_eq!(section.failed_test_runs, 2);
        assert_eq!(section.test_edits_after_failure.len(), 1);
        let promoted = &section.test_edits_after_failure[0];
        assert_eq!(promoted.test_path, "/repo/src/parser_test.rs");
        assert_eq!(promoted.failures_before, 2);
        assert_eq!(
            promoted.failing_commands,
            vec!["cargo test".to_string(), "cargo test --lib".to_string()]
        );
    }

    #[test]
    fn the_promoted_sequence_agrees_with_v20() {
        use crate::verify::config::RuleConfig;
        use crate::verify::session::rules::run_session_rules;
        use crate::verify::types::FindingKind;

        let body = fixture::lines(&[
            fixture::assistant_bash("t1", "pnpm test", "2026-03-09T05:00:00.000Z"),
            fixture::tool_result("t1", true, "2026-03-09T05:00:10.000Z"),
            fixture::assistant_bash("t2", "pnpm test", "2026-03-09T05:01:00.000Z"),
            fixture::tool_result("t2", true, "2026-03-09T05:01:10.000Z"),
            fixture::assistant_edit("t3", "/repo/src/a.test.ts", "2026-03-09T05:02:00.000Z", false),
            fixture::assistant_edit("t4", "/repo/src/a.ts", "2026-03-09T05:03:00.000Z", false),
        ]);
        let summary = summarize(&body);

        let mut config = RuleConfig::default();
        config.set(FindingKind::TestFailureThenTestEdited.rule_id(), true);
        let v20: Vec<String> = run_session_rules(&summary, &config)
            .findings
            .into_iter()
            .filter(|f| f.kind == FindingKind::TestFailureThenTestEdited)
            .map(|f| f.file)
            .collect();

        let promoted: Vec<String> = build(&summary)
            .test_edits_after_failure
            .into_iter()
            .map(|entry| entry.test_path)
            .collect();
        assert_eq!(promoted, v20);
    }

    #[test]
    fn a_session_that_edited_code_without_running_tests_says_so() {
        let summary = summarize(&fixture::lines(&[fixture::assistant_edit(
            "t1",
            "/repo/src/a.rs",
            "2026-03-09T05:00:00.000Z",
            false,
        )]));
        let section = build(&summary);
        assert!(section.never_ran_tests);
        assert!(
            section.unavailable.is_none(),
            "'no tests were run' is itself worth reporting"
        );
    }

    #[test]
    fn a_session_with_nothing_to_recount_omits_the_section() {
        let summary = summarize(&fixture::lines(&[
            fixture::user_prompt("hello", "2026-03-09T05:00:00.000Z"),
            fixture::assistant_read("t1", "/repo/src/a.rs", "2026-03-09T05:01:00.000Z"),
        ]));
        let section = build(&summary);
        assert!(section.events.is_empty());
        assert!(!section.never_ran_tests, "nothing was edited");
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NotApplicable
        );
    }

    #[test]
    fn compaction_and_subagent_edits_join_the_timeline_in_order() {
        let summary = summarize(&fixture::lines(&[
            fixture::assistant_bash("t1", "cargo test", "2026-03-09T05:00:00.000Z"),
            fixture::compact_boundary("2026-03-09T05:30:00.000Z"),
            fixture::assistant_edit("t2", "/repo/src/sub.rs", "2026-03-09T06:00:00.000Z", true),
        ]));
        let kinds: Vec<OrdealKind> = build(&summary).events.iter().map(|e| e.kind).collect();
        assert_eq!(
            kinds,
            vec![
                OrdealKind::TestPassed,
                OrdealKind::Compaction,
                OrdealKind::SubagentEdit
            ]
        );
    }
}
