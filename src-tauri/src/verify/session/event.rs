//! Adapter-neutral session vocabulary.
//!
//! Every piece of format knowledge lives in an [`SessionAdapter`] impl; the
//! fold in `summary.rs` and the rules in `rules.rs` only ever see the types
//! declared here. When Claude Code or Codex changes its JSONL shape, only the
//! adapter changes — and an adapter that recognises nothing simply yields no
//! events, which degrades to "no data" rather than an error (spec §7-⑥).

use serde_json::Value;

use crate::verify::types::SessionSource;

/// What a tool call did, normalised across agents.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolAction {
    /// The agent looked at a concrete file (Read / NotebookRead / a Grep with a
    /// file argument). Directory-wide searches are deliberately *not* reads —
    /// counting them would make V19 fire for nothing.
    Read { path: String },
    /// A structured edit through the agent's own edit tool. These are the
    /// changes Claude Code checkpoints can restore.
    Edit { path: String },
    /// A shell command. File mutations hidden inside these are outside
    /// checkpoint restore (V22) and are classified in `bash.rs`.
    Bash { command: String },
    /// Recognised tool with no signal we derive from it.
    Other,
}

/// One normalised record. A single JSONL line may yield several of these
/// (an assistant turn can contain multiple `tool_use` blocks).
#[derive(Clone, Debug)]
pub enum SessionEvent {
    /// Identity fields. Emitted repeatedly; the fold keeps the first non-empty
    /// value for each field and always widens the time range.
    Meta(MetaEvent),
    /// A prompt written by the human. Only the first one is retained (V26).
    Prompt { at: i64, text: String },
    ToolCall(ToolCallEvent),
    /// Result of a previously seen tool call, matched by `tool_use_id`.
    ToolOutcome {
        tool_use_id: String,
        is_error: bool,
        /// The call created the file rather than modifying an existing one.
        /// Decisive for V19: a file the agent authored from nothing was never
        /// readable, so "edited without reading" says nothing about it.
        created: bool,
    },
    /// Context compaction point (V24).
    CompactBoundary { at: i64 },
    /// Digest of the rules text (CLAUDE.md / AGENTS.md) injected into the
    /// session (V27). The body itself is never retained.
    RulesInjected { digest: String },
}

#[derive(Clone, Debug, Default)]
pub struct MetaEvent {
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub at: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct ToolCallEvent {
    /// Correlation key for the matching [`SessionEvent::ToolOutcome`].
    pub tool_use_id: Option<String>,
    pub at: i64,
    pub action: ToolAction,
    /// The call happened inside a subagent sidechain (V23). Subagent work is
    /// summarised — not shown in full — to the main agent *and* the human.
    pub is_sidechain: bool,
}

/// Isolates all reverse-engineered format knowledge for one agent.
pub trait SessionAdapter {
    fn source(&self) -> SessionSource;

    /// Translate one raw record, appending zero or more neutral events.
    ///
    /// Implementations must never panic and must ignore unknown record types,
    /// unknown tool names and unknown field shapes.
    fn translate(&self, record: &Value, out: &mut Vec<SessionEvent>);
}

// ── Shared extraction helpers (tolerant by construction) ───────────────────

/// Parse an RFC 3339 timestamp to epoch milliseconds.
pub fn parse_timestamp(value: Option<&Value>) -> Option<i64> {
    let text = value?.as_str()?;
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Read a non-empty string field.
pub fn string_field(record: &Value, key: &str) -> Option<String> {
    let text = record.get(key)?.as_str()?;
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

/// A concrete file path is worth recording; a bare directory is not.
/// Used to decide whether a search tool's `path` argument counts as a read.
pub fn looks_like_file_path(path: &str) -> bool {
    match path.rsplit('/').next() {
        Some(name) => name.contains('.') && !name.starts_with('.') || name.matches('.').count() > 1,
        None => false,
    }
}

/// SHA-1 content digest, matching the rest of the verify subsystem
/// (contract §2.10 — git2 supplies this, so no hashing crate is needed).
pub fn content_digest(bytes: &[u8]) -> Option<String> {
    git2::Oid::hash_object(git2::ObjectType::Blob, bytes)
        .ok()
        .map(|oid| oid.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_rfc3339_timestamps_and_tolerates_junk() {
        // 2026-03-09T05:26:00.825Z
        let v = json!("2026-03-09T05:26:00.825Z");
        assert_eq!(parse_timestamp(Some(&v)), Some(1_773_033_960_825));
        // Offsets are honoured, not ignored.
        assert_eq!(
            parse_timestamp(Some(&json!("2026-03-09T14:26:00.825+09:00"))),
            Some(1_773_033_960_825)
        );
        assert_eq!(parse_timestamp(Some(&json!("not a date"))), None);
        assert_eq!(parse_timestamp(Some(&json!(42))), None);
        assert_eq!(parse_timestamp(None), None);
    }

    #[test]
    fn string_field_rejects_empty_and_wrong_types() {
        let rec = json!({ "a": "x", "b": "", "c": 1 });
        assert_eq!(string_field(&rec, "a"), Some("x".to_string()));
        assert_eq!(string_field(&rec, "b"), None);
        assert_eq!(string_field(&rec, "c"), None);
        assert_eq!(string_field(&rec, "missing"), None);
    }

    #[test]
    fn distinguishes_files_from_directories() {
        assert!(looks_like_file_path("src/lib.rs"));
        assert!(looks_like_file_path("/a/b/main.ts"));
        assert!(!looks_like_file_path("src/verify"));
        assert!(!looks_like_file_path("/a/b/"));
        // Dotfiles without an extension are directories-ish; a dotted dotfile
        // (.eslintrc.json) still reads as a file.
        assert!(!looks_like_file_path(".git"));
        assert!(looks_like_file_path(".eslintrc.json"));
    }

    #[test]
    fn digest_is_stable_and_content_addressed() {
        let a = content_digest(b"rules text").expect("digest");
        let b = content_digest(b"rules text").expect("digest");
        let c = content_digest(b"other text").expect("digest");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 40);
    }
}
