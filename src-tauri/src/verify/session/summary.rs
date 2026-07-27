//! Adapter-neutral fold: raw JSONL records → [`SessionSummary`].
//!
//! Nothing in this file knows which agent produced the log. It consumes the
//! neutral events from `event.rs` and accumulates the per-file and per-command
//! facts that V19–V25 are derived from.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::error::AppError;
use crate::verify::types::{
    BashCommandRecord, FileEditSummary, PromptRecord, SessionSource, SessionSummary,
    MAX_SESSION_PROMPTS,
};

use super::bash;
use super::event::{SessionAdapter, SessionEvent, ToolAction};
use super::jsonl::{self, Flow, MAX_COMMAND_CHARS, MAX_PROMPT_CHARS};

/// Accumulated state for one session. Kept separate from `SessionSummary` so
/// the fold can hold bookkeeping (pending tool ids) that never reaches the UI.
#[derive(Debug, Default)]
struct Fold {
    session_id: Option<String>,
    cwd: Option<String>,
    git_branch: Option<String>,
    first_at: Option<i64>,
    last_at: Option<i64>,
    /// Every human instruction, in order. `compacted_away` is resolved in
    /// `finish`, once all compaction boundaries are known.
    prompts: Vec<PromptRecord>,
    injected_rules_digest: Option<String>,

    files_read: Vec<String>,
    read_at: BTreeMap<String, i64>,
    edits: BTreeMap<String, EditAccumulator>,
    commands: Vec<BashCommandRecord>,
    compaction_boundaries: Vec<i64>,

    /// tool_use_id → index into `commands`, so a later result can flip
    /// `is_error` on the command that produced it.
    pending_commands: BTreeMap<String, usize>,
    /// tool_use_id → edited path, so a later result can mark it as a creation.
    pending_edits: BTreeMap<String, String>,
    /// Files this session authored from nothing.
    created_files: BTreeSet<String>,
}

#[derive(Debug)]
struct EditAccumulator {
    count: u32,
    first_at: i64,
    last_at: i64,
    by_subagent: bool,
    via_bash: bool,
}

impl Fold {
    fn observe_time(&mut self, at: i64) {
        self.first_at = Some(self.first_at.map_or(at, |cur| cur.min(at)));
        self.last_at = Some(self.last_at.map_or(at, |cur| cur.max(at)));
    }

    fn record_read(&mut self, path: String, at: i64) {
        self.read_at.entry(path.clone()).or_insert(at);
        if !self.files_read.contains(&path) {
            self.files_read.push(path);
        }
    }

    fn record_edit(&mut self, path: String, at: i64, by_subagent: bool, via_bash: bool) {
        self.edits
            .entry(path)
            .and_modify(|acc| {
                acc.count += 1;
                acc.first_at = acc.first_at.min(at);
                acc.last_at = acc.last_at.max(at);
                acc.by_subagent |= by_subagent;
                acc.via_bash |= via_bash;
            })
            .or_insert(EditAccumulator {
                count: 1,
                first_at: at,
                last_at: at,
                by_subagent,
                via_bash,
            });
    }

    fn apply(&mut self, event: SessionEvent) {
        match event {
            SessionEvent::Meta(meta) => {
                if let Some(at) = meta.at {
                    self.observe_time(at);
                }
                if self.session_id.is_none() {
                    self.session_id = meta.session_id;
                }
                if self.cwd.is_none() {
                    self.cwd = meta.cwd;
                }
                if self.git_branch.is_none() {
                    self.git_branch = meta.git_branch;
                }
            }
            SessionEvent::Prompt { at, text } => {
                self.observe_time(at);
                if self.prompts.len() < MAX_SESSION_PROMPTS {
                    let ordinal = self.prompts.len() as u32;
                    self.prompts.push(PromptRecord {
                        at,
                        truncated: text.chars().count() > MAX_PROMPT_CHARS,
                        text: jsonl::truncate_chars(&text, MAX_PROMPT_CHARS),
                        ordinal,
                        compacted_away: false,
                    });
                }
            }
            SessionEvent::CompactBoundary { at } => {
                self.observe_time(at);
                self.compaction_boundaries.push(at);
            }
            SessionEvent::RulesInjected { digest } => {
                if self.injected_rules_digest.is_none() {
                    self.injected_rules_digest = Some(digest);
                }
            }
            SessionEvent::ToolOutcome {
                tool_use_id,
                is_error,
                created,
            } => {
                if let Some(idx) = self.pending_commands.get(&tool_use_id) {
                    if let Some(cmd) = self.commands.get_mut(*idx) {
                        cmd.is_error = is_error;
                    }
                }
                if created {
                    if let Some(path) = self.pending_edits.get(&tool_use_id) {
                        self.created_files.insert(path.clone());
                    }
                }
            }
            SessionEvent::ToolCall(call) => {
                let (at, sidechain, tool_use_id) = (call.at, call.is_sidechain, call.tool_use_id);
                self.observe_time(at);
                match call.action {
                    ToolAction::Read { path } => self.record_read(path, at),
                    ToolAction::Edit { path } => {
                        if let Some(id) = tool_use_id {
                            self.pending_edits.insert(id, path.clone());
                        }
                        self.record_edit(path, at, sidechain, false)
                    }
                    ToolAction::Bash { command } => {
                        self.apply_bash(&command, at, sidechain, tool_use_id)
                    }
                    ToolAction::Other => {}
                }
            }
        }
    }

    fn apply_bash(
        &mut self,
        command: &str,
        at: i64,
        is_sidechain: bool,
        tool_use_id: Option<String>,
    ) {
        let classification = bash::classify(command);
        // Files touched through the shell are outside checkpoint restore (V22).
        for path in &classification.mutated_paths {
            self.record_edit(path.clone(), at, is_sidechain, true);
        }
        self.commands.push(BashCommandRecord {
            command: jsonl::truncate_chars(command, MAX_COMMAND_CHARS),
            at,
            is_error: false,
            kind: classification.kind,
            bypass_markers: classification.bypass_markers,
        });
        if let Some(id) = tool_use_id {
            self.pending_commands.insert(id, self.commands.len() - 1);
        }
    }

    fn finish(
        self,
        source: SessionSource,
        file_path: &Path,
        truncated: bool,
        skipped_records: usize,
    ) -> SessionSummary {
        let started_at = self.first_at.unwrap_or(0);
        let ended_at = self.last_at.unwrap_or(started_at);
        let first_boundary = self.compaction_boundaries.iter().min().copied();
        let last_boundary = self.compaction_boundaries.iter().max().copied();

        // "This instruction may have dropped out of the agent's context" is the
        // one judgement the prompt list makes, and it needs every boundary — so
        // it can only be decided here, not while folding.
        let prompts: Vec<PromptRecord> = self
            .prompts
            .into_iter()
            .map(|prompt| PromptRecord {
                compacted_away: last_boundary.is_some_and(|b| b > prompt.at),
                ..prompt
            })
            .collect();
        let first_user_prompt = prompts.first().map(|p| p.text.clone());

        let files_edited = self
            .edits
            .into_iter()
            .map(|(path, acc)| FileEditSummary {
                // "The agent had this file's content in context before
                // changing it." Two ways to satisfy that: it read the file
                // before the first edit (reading it *afterwards* is not
                // context), or it authored the file in this session — a file
                // created from nothing was never readable, so V19 has nothing
                // to say about it. Without this second case V19 fires on every
                // newly written file and becomes noise.
                was_read_first: self.created_files.contains(&path)
                    || self
                        .read_at
                        .get(&path)
                        .is_some_and(|read_at| *read_at <= acc.first_at),
                after_compaction: first_boundary.is_some_and(|b| acc.last_at > b),
                path,
                edit_count: acc.count,
                first_edit_at: acc.first_at,
                last_edit_at: acc.last_at,
                by_subagent: acc.by_subagent,
                via_bash: acc.via_bash,
            })
            .collect();

        SessionSummary {
            session_id: self
                .session_id
                .unwrap_or_else(|| fallback_session_id(file_path)),
            source,
            file_path: file_path.display().to_string(),
            cwd: self.cwd.unwrap_or_default(),
            git_branch: self.git_branch,
            started_at,
            ended_at,
            // Stamped by `session::summarize_session`, which is the only layer
            // that has the file handle.
            modified_at: 0,
            first_user_prompt,
            prompts,
            files_read: self.files_read,
            files_edited,
            bash_commands: self.commands,
            compaction_boundaries: self.compaction_boundaries,
            injected_rules_digest: self.injected_rules_digest,
            truncated,
            skipped_records,
        }
    }
}

/// Both agents name the file after the session, so the stem is a safe fallback
/// when the log never states its own id.
fn fallback_session_id(file_path: &Path) -> String {
    file_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Stream `path` through `adapter` and fold it into a [`SessionSummary`].
///
/// Returns `Ok(None)` when the file parsed but yielded nothing recognisable —
/// a format change degrades to "no data", not to an error (spec §7-⑥). Only
/// failing to *open* the file produces `Err`.
pub fn summarize_with<A: SessionAdapter>(
    path: &Path,
    adapter: &A,
) -> Result<Option<SessionSummary>, AppError> {
    let mut fold = Fold::default();
    let mut events: Vec<SessionEvent> = Vec::with_capacity(8);

    let outcome = jsonl::stream_records(path, |record| {
        events.clear();
        adapter.translate(record, &mut events);
        for event in events.drain(..) {
            fold.apply(event);
        }
        Flow::Continue
    })?;

    if outcome.stats.is_empty() {
        return Ok(None);
    }

    let summary = fold.finish(
        adapter.source(),
        path,
        outcome.truncated(),
        outcome.stats.skipped_records,
    );

    // A file full of records we understand nothing about is "no data" too.
    if summary.files_read.is_empty()
        && summary.files_edited.is_empty()
        && summary.bash_commands.is_empty()
        && summary.prompts.is_empty()
    {
        return Ok(None);
    }

    Ok(Some(summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::session::claude_code::ClaudeCodeAdapter;
    use crate::verify::session::test_support::{fixture, TempDir};
    use crate::verify::types::BashCommandKind;

    fn summarize(body: &str) -> Option<SessionSummary> {
        let dir = TempDir::new();
        let path = dir.write("s.jsonl", body);
        summarize_with(&path, &ClaudeCodeAdapter).expect("open")
    }

    #[test]
    fn folds_a_normal_session() {
        let s = summarize(&fixture::normal_session()).expect("summary");
        assert_eq!(s.session_id, "sess-1");
        assert_eq!(s.cwd, "/repo");
        assert_eq!(s.git_branch.as_deref(), Some("main"));
        assert_eq!(s.first_user_prompt.as_deref(), Some("fix the parser"));
        assert_eq!(s.files_read, vec!["/repo/src/a.rs".to_string()]);
        assert_eq!(s.files_edited.len(), 1);
        assert_eq!(s.files_edited[0].path, "/repo/src/a.rs");
        assert!(s.files_edited[0].was_read_first);
        assert_eq!(s.bash_commands.len(), 1);
        assert_eq!(s.bash_commands[0].kind, BashCommandKind::TestRun);
        assert!(!s.bash_commands[0].is_error);
        assert!(!s.truncated);
        assert_eq!(s.skipped_records, 0);
        assert!(s.started_at < s.ended_at);
    }

    #[test]
    fn counts_corrupt_lines_without_losing_the_session() {
        let mut body = fixture::normal_session();
        body.push_str("this line is not json\n");
        body.push_str("{\"type\":\"assistant\",\"message\":\n");
        let s = summarize(&body).expect("summary");
        assert_eq!(s.skipped_records, 2);
        assert_eq!(s.files_edited.len(), 1, "valid records still folded");
    }

    #[test]
    fn ignores_unknown_record_types() {
        let mut body = fixture::normal_session();
        body.push_str("{\"type\":\"brand-new-thing\",\"timestamp\":\"2026-03-09T05:10:00.000Z\",\"payload\":{\"x\":1}}\n");
        let s = summarize(&body).expect("summary");
        assert_eq!(s.skipped_records, 0, "understood as JSON, just not acted on");
        assert_eq!(s.files_edited.len(), 1);
    }

    #[test]
    fn a_file_created_in_this_session_counts_as_in_context() {
        // 37 of 39 Writes in a real session are creations; without this the
        // read-less signal is dominated by files that never existed to read.
        let mut records = fixture::write_created("t1", "/repo/new.rs", "2026-03-09T05:00:00.000Z");
        records.push(fixture::assistant_edit(
            "t2",
            "/repo/existing.rs",
            "2026-03-09T05:01:00.000Z",
            false,
        ));
        let s = summarize(&fixture::lines(&records)).expect("summary");
        let new_file = s.files_edited.iter().find(|f| f.path.ends_with("new.rs")).unwrap();
        let existing = s.files_edited.iter().find(|f| f.path.ends_with("existing.rs")).unwrap();
        assert!(new_file.was_read_first, "authored from nothing");
        assert!(!existing.was_read_first, "modified without reading");
    }

    #[test]
    fn an_update_write_is_still_read_less() {
        let body = fixture::lines(&[
            fixture::assistant_tool(
                "t1",
                "Write",
                serde_json::json!({ "file_path": "/repo/a.rs", "content": "x" }),
                "2026-03-09T05:00:00.000Z",
                false,
            ),
            fixture::tool_result("t1", false, "2026-03-09T05:00:10.000Z"),
        ]);
        let s = summarize(&body).expect("summary");
        assert!(!s.files_edited[0].was_read_first);
    }

    #[test]
    fn read_after_edit_does_not_count_as_read_first() {
        let body = fixture::lines(&[
            fixture::assistant_edit("t1", "/repo/x.rs", "2026-03-09T05:00:00.000Z", false),
            fixture::assistant_read("t2", "/repo/x.rs", "2026-03-09T05:01:00.000Z"),
        ]);
        let s = summarize(&body).expect("summary");
        assert!(!s.files_edited[0].was_read_first);
    }

    #[test]
    fn counts_repeated_edits_per_file() {
        let body = fixture::lines(&[
            fixture::assistant_edit("t1", "/repo/x.rs", "2026-03-09T05:00:00.000Z", false),
            fixture::assistant_edit("t2", "/repo/x.rs", "2026-03-09T05:01:00.000Z", false),
            fixture::assistant_edit("t3", "/repo/x.rs", "2026-03-09T05:02:00.000Z", false),
        ]);
        let s = summarize(&body).expect("summary");
        assert_eq!(s.files_edited[0].edit_count, 3);
        assert!(s.files_edited[0].first_edit_at < s.files_edited[0].last_edit_at);
    }

    #[test]
    fn attributes_sidechain_edits_to_a_subagent() {
        let body = fixture::lines(&[fixture::assistant_edit(
            "t1",
            "/repo/sub.rs",
            "2026-03-09T05:00:00.000Z",
            true,
        )]);
        let s = summarize(&body).expect("summary");
        assert!(s.files_edited[0].by_subagent);
    }

    #[test]
    fn marks_edits_after_a_compact_boundary() {
        let body = fixture::lines(&[
            fixture::assistant_edit("t1", "/repo/before.rs", "2026-03-09T05:00:00.000Z", false),
            fixture::compact_boundary("2026-03-09T05:30:00.000Z"),
            fixture::assistant_edit("t2", "/repo/after.rs", "2026-03-09T06:00:00.000Z", false),
        ]);
        let s = summarize(&body).expect("summary");
        assert_eq!(s.compaction_boundaries.len(), 1);
        let before = s.files_edited.iter().find(|f| f.path.ends_with("before.rs")).unwrap();
        let after = s.files_edited.iter().find(|f| f.path.ends_with("after.rs")).unwrap();
        assert!(!before.after_compaction);
        assert!(after.after_compaction);
    }

    #[test]
    fn bash_mutations_are_attributed_to_files_and_flagged_via_bash() {
        let body = fixture::lines(&[fixture::assistant_bash(
            "t1",
            "echo x > /repo/gen.ts",
            "2026-03-09T05:00:00.000Z",
        )]);
        let s = summarize(&body).expect("summary");
        assert_eq!(s.files_edited.len(), 1);
        assert!(s.files_edited[0].via_bash);
        assert_eq!(s.bash_commands[0].kind, BashCommandKind::FileMutation);
    }

    #[test]
    fn tool_result_error_flag_lands_on_the_right_command() {
        let body = fixture::lines(&[
            fixture::assistant_bash("t1", "cargo test", "2026-03-09T05:00:00.000Z"),
            fixture::assistant_bash("t2", "cargo build", "2026-03-09T05:01:00.000Z"),
            fixture::tool_result("t1", true, "2026-03-09T05:00:30.000Z"),
        ]);
        let s = summarize(&body).expect("summary");
        assert!(s.bash_commands[0].is_error, "cargo test failed");
        assert!(!s.bash_commands[1].is_error, "cargo build did not");
    }

    #[test]
    fn exceeding_the_record_budget_marks_the_summary_truncated() {
        let mut body = fixture::normal_session();
        // Pad past the record budget so the scan stops before EOF.
        for i in 0..jsonl::MAX_RECORDS {
            body.push_str(&format!("{{\"type\":\"noop\",\"i\":{}}}\n", i));
        }
        let s = summarize(&body).expect("summary");
        assert!(
            s.truncated,
            "a partially read log must say so; every derived signal is partial"
        );
    }

    #[test]
    fn unrecognisable_file_yields_no_data_rather_than_an_error() {
        let body = "{\"hello\":\"world\"}\n{\"another\":1}\n";
        assert!(summarize(body).is_none());
    }

    #[test]
    fn empty_file_yields_no_data() {
        assert!(summarize("").is_none());
    }

    #[test]
    fn long_prompts_and_commands_are_truncated() {
        let long_prompt = "p".repeat(MAX_PROMPT_CHARS + 500);
        let long_cmd = format!("echo {}", "c".repeat(MAX_COMMAND_CHARS + 500));
        let body = fixture::lines(&[
            fixture::user_prompt(&long_prompt, "2026-03-09T05:00:00.000Z"),
            fixture::assistant_bash("t1", &long_cmd, "2026-03-09T05:01:00.000Z"),
        ]);
        let s = summarize(&body).expect("summary");
        assert_eq!(
            s.first_user_prompt.as_ref().unwrap().chars().count(),
            MAX_PROMPT_CHARS + 1
        );
        assert_eq!(
            s.bash_commands[0].command.chars().count(),
            MAX_COMMAND_CHARS + 1
        );
    }
}
