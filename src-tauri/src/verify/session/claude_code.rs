//! Claude Code adapter — `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`.
//!
//! The format is unofficial and reverse-engineered from live session files, so
//! every field access here is optional and every unknown shape is ignored.
//! Observed record types: `system` (incl. `subtype: "compact_boundary"`),
//! `file-history-snapshot`, `user`, `assistant`, `summary`, `result`, plus a
//! long tail of housekeeping types we do not read.

use serde_json::Value;

use super::event::{
    content_digest, looks_like_file_path, parse_timestamp, string_field, MetaEvent, SessionAdapter,
    SessionEvent, ToolAction, ToolCallEvent,
};
use crate::verify::types::SessionSource;

/// Tools whose `file_path` argument means "the agent looked at this file".
const READ_TOOLS: &[&str] = &["Read", "NotebookRead"];
/// Tools whose `file_path` argument means "the agent changed this file"
/// through the checkpointed edit path.
const EDIT_TOOLS: &[&str] = &["Edit", "Write", "MultiEdit", "NotebookEdit", "Update"];
/// Search tools: only count as a read when pointed at a concrete file.
const SEARCH_TOOLS: &[&str] = &["Grep", "Glob"];

pub struct ClaudeCodeAdapter;

impl SessionAdapter for ClaudeCodeAdapter {
    fn source(&self) -> SessionSource {
        SessionSource::ClaudeCode
    }

    fn translate(&self, record: &Value, out: &mut Vec<SessionEvent>) {
        let at = parse_timestamp(record.get("timestamp"));
        push_meta(record, at, out);

        let Some(kind) = record.get("type").and_then(Value::as_str) else {
            return;
        };

        match kind {
            "system" => translate_system(record, at, out),
            "user" => translate_user(record, at, out),
            "assistant" => translate_assistant(record, at, out),
            // `summary`, `result`, `file-history-snapshot`, `attachment`,
            // `mode`, … carry nothing we derive signals from. Ignored on
            // purpose so new record types never break the parse.
            _ => {}
        }
    }
}

fn push_meta(record: &Value, at: Option<i64>, out: &mut Vec<SessionEvent>) {
    let meta = MetaEvent {
        session_id: string_field(record, "sessionId"),
        cwd: string_field(record, "cwd"),
        git_branch: string_field(record, "gitBranch"),
        at,
    };
    if meta.session_id.is_some()
        || meta.cwd.is_some()
        || meta.git_branch.is_some()
        || meta.at.is_some()
    {
        out.push(SessionEvent::Meta(meta));
    }
}

fn translate_system(record: &Value, at: Option<i64>, out: &mut Vec<SessionEvent>) {
    match record.get("subtype").and_then(Value::as_str) {
        Some("compact_boundary") => {
            if let Some(at) = at {
                out.push(SessionEvent::CompactBoundary { at });
            }
        }
        _ => {
            // The session-opening `system` record embeds the injected
            // CLAUDE.md. We keep only a digest — never the body (§2.12).
            if let Some(digest) = rules_digest(record) {
                out.push(SessionEvent::RulesInjected { digest });
            }
        }
    }
}

/// Digest the injected rules text, if this record looks like it carries one.
fn rules_digest(record: &Value) -> Option<String> {
    let content = record.get("content").and_then(Value::as_str)?;
    // Only the system prompt record is large enough and mentions the rules
    // files by name; anything else is chatter we skip.
    if !content.contains("CLAUDE.md") && !content.contains("AGENTS.md") {
        return None;
    }
    content_digest(content.as_bytes())
}

fn translate_user(record: &Value, at: Option<i64>, out: &mut Vec<SessionEvent>) {
    // Meta/injected records are not human prompts.
    let is_meta = record
        .get("isMeta")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let Some(content) = record.pointer("/message/content") else {
        return;
    };

    // A plain string body is always a human prompt.
    if let Some(text) = content.as_str() {
        if !is_meta && !text.is_empty() {
            if let Some(at) = at {
                out.push(SessionEvent::Prompt {
                    at,
                    text: text.to_string(),
                });
            }
        }
        return;
    }

    let Some(blocks) = content.as_array() else {
        return;
    };

    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("tool_result") => {
                // `tool_result` blocks are where `is_error` actually lives; the
                // sibling top-level `toolUseResult` is tool-specific and does
                // not reliably carry the id. Fall back to it regardless.
                let tool_use_id = string_field(block, "tool_use_id")
                    .or_else(|| block_result_id(record.get("toolUseResult")));
                if let Some(tool_use_id) = tool_use_id {
                    out.push(SessionEvent::ToolOutcome {
                        tool_use_id,
                        is_error: is_error_flag(block, record.get("toolUseResult")),
                        created: is_file_creation(record.get("toolUseResult")),
                    });
                }
            }
            Some("text") => {
                if is_meta {
                    continue;
                }
                if let (Some(at), Some(text)) = (at, block.get("text").and_then(Value::as_str)) {
                    if !text.is_empty() {
                        out.push(SessionEvent::Prompt {
                            at,
                            text: text.to_string(),
                        });
                    }
                }
            }
            _ => {}
        }
    }
}

fn block_result_id(tool_use_result: Option<&Value>) -> Option<String> {
    string_field(tool_use_result?, "tool_use_id")
}

/// A tool failed if the result block says so, or if the structured result
/// reports a non-zero exit / an interrupt.
fn is_error_flag(block: &Value, tool_use_result: Option<&Value>) -> bool {
    if block
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    let Some(result) = tool_use_result else {
        return false;
    };
    if result
        .get("interrupted")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    result
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// `Write` reports `type: "create"` when the file did not exist and
/// `"update"` when it did. Absent field ⇒ assume an update (the conservative
/// answer, since a missed creation only costs one low-severity finding).
fn is_file_creation(tool_use_result: Option<&Value>) -> bool {
    tool_use_result
        .and_then(|r| r.get("type"))
        .and_then(Value::as_str)
        == Some("create")
}

fn translate_assistant(record: &Value, at: Option<i64>, out: &mut Vec<SessionEvent>) {
    let Some(at) = at else { return };
    let is_sidechain = record
        .get("isSidechain")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        // An `agentId` on the record is a second, independent marker that this
        // turn belongs to a subagent.
        || record.get("agentId").and_then(Value::as_str).is_some();

    let Some(blocks) = record.pointer("/message/content").and_then(Value::as_array) else {
        return;
    };

    for block in blocks {
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        let Some(name) = block.get("name").and_then(Value::as_str) else {
            continue;
        };
        let input = block.get("input").unwrap_or(&Value::Null);
        let Some(action) = tool_action(name, input) else {
            continue;
        };
        out.push(SessionEvent::ToolCall(ToolCallEvent {
            tool_use_id: string_field(block, "id"),
            at,
            action,
            is_sidechain,
        }));
    }
}

/// Map a tool name + input onto a neutral action. Unknown tools yield `None`
/// so the fold never has to know about them.
fn tool_action(name: &str, input: &Value) -> Option<ToolAction> {
    if name == "Bash" || name == "BashOutput" {
        let command = input.get("command").and_then(Value::as_str)?;
        return Some(ToolAction::Bash {
            command: command.to_string(),
        });
    }
    if READ_TOOLS.contains(&name) {
        return file_path(input).map(|path| ToolAction::Read { path });
    }
    if EDIT_TOOLS.contains(&name) {
        return file_path(input).map(|path| ToolAction::Edit { path });
    }
    if SEARCH_TOOLS.contains(&name) {
        let path = input.get("path").and_then(Value::as_str)?;
        return looks_like_file_path(path).then(|| ToolAction::Read {
            path: path.to_string(),
        });
    }
    None
}

fn file_path(input: &Value) -> Option<String> {
    for key in ["file_path", "notebook_path", "path"] {
        if let Some(path) = input.get(key).and_then(Value::as_str) {
            if !path.is_empty() {
                return Some(path.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn translate(record: Value) -> Vec<SessionEvent> {
        let mut out = Vec::new();
        ClaudeCodeAdapter.translate(&record, &mut out);
        out
    }

    fn actions(events: &[SessionEvent]) -> Vec<ToolAction> {
        events
            .iter()
            .filter_map(|e| match e {
                SessionEvent::ToolCall(c) => Some(c.action.clone()),
                _ => None,
            })
            .collect()
    }

    fn assistant_with(blocks: Value) -> Value {
        json!({
            "type": "assistant",
            "timestamp": "2026-03-09T05:26:00.000Z",
            "sessionId": "s1",
            "cwd": "/repo",
            "gitBranch": "main",
            "message": { "content": blocks }
        })
    }

    #[test]
    fn extracts_meta_from_any_record() {
        let events = translate(json!({
            "type": "user",
            "timestamp": "2026-03-09T05:26:00.000Z",
            "sessionId": "s1",
            "cwd": "/repo",
            "gitBranch": "feat/x"
        }));
        let SessionEvent::Meta(meta) = &events[0] else {
            panic!("expected meta");
        };
        assert_eq!(meta.session_id.as_deref(), Some("s1"));
        assert_eq!(meta.cwd.as_deref(), Some("/repo"));
        assert_eq!(meta.git_branch.as_deref(), Some("feat/x"));
        assert!(meta.at.is_some());
    }

    #[test]
    fn maps_read_edit_and_bash_tools() {
        let events = translate(assistant_with(json!([
            { "type": "tool_use", "id": "t1", "name": "Read",
              "input": { "file_path": "/repo/a.rs" } },
            { "type": "tool_use", "id": "t2", "name": "Edit",
              "input": { "file_path": "/repo/b.rs", "old_string": "x", "new_string": "y" } },
            { "type": "tool_use", "id": "t3", "name": "Bash",
              "input": { "command": "cargo test" } },
        ])));
        assert_eq!(
            actions(&events),
            vec![
                ToolAction::Read { path: "/repo/a.rs".into() },
                ToolAction::Edit { path: "/repo/b.rs".into() },
                ToolAction::Bash { command: "cargo test".into() },
            ]
        );
    }

    #[test]
    fn grep_counts_as_read_only_for_a_concrete_file() {
        let events = translate(assistant_with(json!([
            { "type": "tool_use", "id": "t1", "name": "Grep",
              "input": { "pattern": "foo", "path": "/repo/src" } },
            { "type": "tool_use", "id": "t2", "name": "Grep",
              "input": { "pattern": "foo", "path": "/repo/src/lib.rs" } },
        ])));
        assert_eq!(
            actions(&events),
            vec![ToolAction::Read { path: "/repo/src/lib.rs".into() }],
            "a directory-wide search is not evidence that a file was read"
        );
    }

    #[test]
    fn unknown_tools_and_record_types_are_ignored() {
        let events = translate(assistant_with(json!([
            { "type": "tool_use", "id": "t1", "name": "SomeFutureTool",
              "input": { "whatever": 1 } },
            { "type": "thinking", "thinking": "..." },
        ])));
        assert!(actions(&events).is_empty());

        let events = translate(json!({
            "type": "totally-new-record-type",
            "timestamp": "2026-03-09T05:26:00.000Z",
            "payload": { "nested": [1, 2, 3] }
        }));
        assert!(actions(&events).is_empty(), "unknown types yield no actions");
    }

    #[test]
    fn missing_and_wrongly_typed_fields_do_not_panic() {
        assert!(translate(json!({ "type": "assistant" })).is_empty());
        assert!(translate(json!({ "type": "assistant", "message": 5 })).is_empty());
        assert!(translate(json!({ "type": "user", "message": { "content": 7 } })).is_empty());
        // A tool_use with no input at all.
        let events = translate(assistant_with(json!([
            { "type": "tool_use", "id": "t1", "name": "Read" }
        ])));
        assert!(actions(&events).is_empty());
    }

    #[test]
    fn marks_sidechain_calls() {
        let mut record = assistant_with(json!([
            { "type": "tool_use", "id": "t1", "name": "Edit",
              "input": { "file_path": "/repo/a.rs" } }
        ]));
        record["isSidechain"] = json!(true);
        let events = translate(record);
        let SessionEvent::ToolCall(call) = events.iter().find(|e| matches!(e, SessionEvent::ToolCall(_))).unwrap() else {
            panic!()
        };
        assert!(call.is_sidechain);
    }

    #[test]
    fn reads_tool_outcome_error_flag_from_the_result_block() {
        let events = translate(json!({
            "type": "user",
            "timestamp": "2026-03-09T05:26:01.000Z",
            "message": { "content": [
                { "type": "tool_result", "tool_use_id": "t3", "is_error": true, "content": "boom" }
            ]},
            "toolUseResult": { "stdout": "", "stderr": "boom", "interrupted": false }
        }));
        let outcome = events.iter().find_map(|e| match e {
            SessionEvent::ToolOutcome {
                tool_use_id,
                is_error,
                ..
            } => Some((tool_use_id.clone(), *is_error)),
            _ => None,
        });
        assert_eq!(outcome, Some(("t3".to_string(), true)));
    }

    #[test]
    fn interrupted_structured_result_also_counts_as_error() {
        let events = translate(json!({
            "type": "user",
            "timestamp": "2026-03-09T05:26:01.000Z",
            "message": { "content": [
                { "type": "tool_result", "tool_use_id": "t9", "content": "" }
            ]},
            "toolUseResult": { "interrupted": true }
        }));
        assert!(events.iter().any(|e| matches!(
            e,
            SessionEvent::ToolOutcome { is_error: true, .. }
        )));
    }

    #[test]
    fn detects_compact_boundary() {
        let events = translate(json!({
            "type": "system",
            "subtype": "compact_boundary",
            "timestamp": "2026-03-09T06:00:00.000Z",
            "compactMetadata": { "trigger": "auto", "preTokens": 150000 }
        }));
        assert!(events
            .iter()
            .any(|e| matches!(e, SessionEvent::CompactBoundary { .. })));
    }

    #[test]
    fn captures_first_prompt_text_but_not_meta_records() {
        let events = translate(json!({
            "type": "user",
            "timestamp": "2026-03-09T05:00:00.000Z",
            "message": { "content": "implement the parser" }
        }));
        assert!(events
            .iter()
            .any(|e| matches!(e, SessionEvent::Prompt { text, .. } if text == "implement the parser")));

        let events = translate(json!({
            "type": "user",
            "isMeta": true,
            "timestamp": "2026-03-09T05:00:00.000Z",
            "message": { "content": "<system-reminder>noise</system-reminder>" }
        }));
        assert!(!events.iter().any(|e| matches!(e, SessionEvent::Prompt { .. })));
    }

    #[test]
    fn digests_injected_rules_without_retaining_them() {
        let events = translate(json!({
            "type": "system",
            "timestamp": "2026-03-09T05:00:00.000Z",
            "content": "Contents of CLAUDE.md: always run tests"
        }));
        let digest = events.iter().find_map(|e| match e {
            SessionEvent::RulesInjected { digest } => Some(digest.clone()),
            _ => None,
        });
        assert_eq!(digest.map(|d| d.len()), Some(40));

        let events = translate(json!({
            "type": "system",
            "timestamp": "2026-03-09T05:00:00.000Z",
            "content": "unrelated system chatter"
        }));
        assert!(!events
            .iter()
            .any(|e| matches!(e, SessionEvent::RulesInjected { .. })));
    }
}
