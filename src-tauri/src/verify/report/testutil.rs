//! Test-only builders shared by the report modules.
//!
//! Synthetic `SessionSummary` values wherever the log format is irrelevant to
//! what is being tested — a section builder should be provable without a parser
//! in the way. Where the fold itself matters, [`summarize`] runs the real
//! Claude Code adapter instead.

use std::path::Path;

use crate::verify::session::claude_code::ClaudeCodeAdapter;
use crate::verify::session::summary::summarize_with;
use crate::verify::session::test_support::TempDir;
use crate::verify::types::{
    BashCommandKind, BashCommandRecord, FileEditSummary, LinkConfidence, PromptRecord,
    SessionCommitLink, SessionSource, SessionSummary,
};

pub const T0: i64 = 1_772_000_000_000;

/// A minimal Claude Code session that edited `edited` and ran `commands`.
pub fn session_with(edited: &[&str], commands: &[(&str, BashCommandKind, bool)]) -> SessionSummary {
    SessionSummary {
        session_id: "sess-1".into(),
        source: SessionSource::ClaudeCode,
        file_path: "/logs/sess-1.jsonl".into(),
        cwd: "/repo".into(),
        git_branch: Some("main".into()),
        started_at: T0,
        ended_at: T0 + 60_000,
        modified_at: T0 + 60_000,
        first_user_prompt: None,
        prompts: Vec::new(),
        files_read: Vec::new(),
        files_edited: edited
            .iter()
            .map(|path| FileEditSummary {
                path: (*path).to_string(),
                edit_count: 1,
                first_edit_at: T0,
                last_edit_at: T0 + 1_000,
                was_read_first: true,
                after_compaction: false,
                by_subagent: false,
                via_bash: false,
            })
            .collect(),
        bash_commands: commands
            .iter()
            .enumerate()
            .map(|(i, (command, kind, is_error))| BashCommandRecord {
                command: (*command).to_string(),
                at: T0 + 1_000 * i as i64,
                is_error: *is_error,
                kind: *kind,
                bypass_markers: Vec::new(),
            })
            .collect(),
        compaction_boundaries: Vec::new(),
        injected_rules_digest: None,
        truncated: false,
        skipped_records: 0,
    }
}

pub fn prompt(ordinal: u32, text: &str) -> PromptRecord {
    PromptRecord {
        at: T0 + ordinal as i64 * 1_000,
        text: text.to_string(),
        truncated: false,
        ordinal,
        compacted_away: false,
    }
}

pub fn link_for(commit_ids: &[&str], confidence: LinkConfidence) -> SessionCommitLink {
    SessionCommitLink {
        session_id: "sess-1".into(),
        session_path: "/logs/sess-1.jsonl".into(),
        commit_ids: commit_ids.iter().map(|id| (*id).to_string()).collect(),
        confidence,
        basis: vec!["cwd".into(), "fileOverlap".into()],
        commits: Vec::new(),
        rejected: Vec::new(),
        ambiguous_with: 0,
    }
}

/// Fold a JSONL body into a summary through the real Claude Code adapter.
pub fn summarize(body: &str) -> SessionSummary {
    let dir = TempDir::new();
    summarize_at(&dir.write("s.jsonl", body))
}

pub fn summarize_at(path: &Path) -> SessionSummary {
    summarize_with(path, &ClaudeCodeAdapter)
        .expect("open session")
        .expect("recognisable session")
}
