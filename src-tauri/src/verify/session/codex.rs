//! Codex adapter — `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO8601>-<uuid>.jsonl`.
//!
//! Shape observed in live rollouts: every line is
//! `{ timestamp, type, payload }` where `type` is one of `session_meta`,
//! `turn_context`, `response_item`, `event_msg`, and the discriminator for the
//! interesting cases lives on `payload.type`.
//!
//! Codex has no distinct read tool — it reads files by shelling out — and no
//! sidechain or compaction records. The rules layer therefore reports V19 and
//! V23/V24 as *not applicable* for Codex sessions rather than inventing
//! answers from shell-command guesswork.

use serde_json::Value;

use super::event::{parse_timestamp, string_field, MetaEvent, SessionAdapter, SessionEvent, ToolAction, ToolCallEvent};
use crate::verify::types::SessionSource;

/// Function-call names that carry a shell command.
const SHELL_CALLS: &[&str] = &["shell", "exec_command", "local_shell", "container.exec"];
/// Function-call name that carries a patch to apply.
const PATCH_CALL: &str = "apply_patch";

pub struct CodexAdapter;

impl SessionAdapter for CodexAdapter {
    fn source(&self) -> SessionSource {
        SessionSource::Codex
    }

    fn translate(&self, record: &Value, out: &mut Vec<SessionEvent>) {
        let at = parse_timestamp(record.get("timestamp"));
        let Some(payload) = record.get("payload") else {
            return;
        };

        match record.get("type").and_then(Value::as_str) {
            Some("session_meta") => push_session_meta(payload, at, out),
            Some("turn_context") => {
                if let Some(cwd) = string_field(payload, "cwd") {
                    out.push(SessionEvent::Meta(MetaEvent {
                        cwd: Some(cwd),
                        at,
                        ..MetaEvent::default()
                    }));
                }
            }
            Some("response_item") => translate_response_item(payload, at, out),
            Some("event_msg") => translate_event_msg(payload, at, out),
            _ => {}
        }

        if let Some(at) = at {
            out.push(SessionEvent::Meta(MetaEvent {
                at: Some(at),
                ..MetaEvent::default()
            }));
        }
    }
}

fn push_session_meta(payload: &Value, at: Option<i64>, out: &mut Vec<SessionEvent>) {
    out.push(SessionEvent::Meta(MetaEvent {
        session_id: string_field(payload, "id"),
        cwd: string_field(payload, "cwd"),
        git_branch: payload
            .get("git")
            .and_then(|git| git.get("branch"))
            .and_then(Value::as_str)
            .filter(|b| !b.is_empty())
            .map(str::to_string),
        at: at.or_else(|| parse_timestamp(payload.get("timestamp"))),
    }));
}

fn translate_response_item(payload: &Value, at: Option<i64>, out: &mut Vec<SessionEvent>) {
    let Some(at) = at else { return };
    match payload.get("type").and_then(Value::as_str) {
        Some("function_call") | Some("local_shell_call") | Some("custom_tool_call") => {
            let name = payload
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("shell");
            let args = call_arguments(payload);
            push_call(name, &args, at, payload, out);
        }
        Some("function_call_output") | Some("local_shell_call_output") => {
            if let Some(tool_use_id) = call_id(payload) {
                out.push(SessionEvent::ToolOutcome {
                    tool_use_id,
                    is_error: output_is_error(payload.get("output")),
                    created: false,
                });
            }
        }
        _ => {}
    }
}

/// `arguments` is a JSON *string* in every rollout observed, but tolerate an
/// already-decoded object too.
fn call_arguments(payload: &Value) -> Value {
    match payload.get("arguments") {
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw).unwrap_or(Value::Null),
        Some(other) => other.clone(),
        None => payload.get("input").cloned().unwrap_or(Value::Null),
    }
}

fn call_id(payload: &Value) -> Option<String> {
    string_field(payload, "call_id").or_else(|| string_field(payload, "id"))
}

fn push_call(name: &str, args: &Value, at: i64, payload: &Value, out: &mut Vec<SessionEvent>) {
    let tool_use_id = call_id(payload);

    if name == PATCH_CALL {
        let patch = args
            .get("input")
            .or_else(|| args.get("patch"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        push_patch_edits(&patch_targets(patch), at, tool_use_id.as_deref(), out);
        return;
    }

    if !SHELL_CALLS.contains(&name) {
        return;
    }
    let Some(command) = shell_command(args) else {
        return;
    };
    // `apply_patch` is frequently delivered as a heredoc through the shell.
    let targets = patch_targets(&command);
    if targets.is_empty() {
        out.push(SessionEvent::ToolCall(ToolCallEvent {
            tool_use_id,
            at,
            action: ToolAction::Bash { command },
            is_sidechain: false,
        }));
    } else {
        push_patch_edits(&targets, at, tool_use_id.as_deref(), out);
    }
}

/// Emit one edit per patched file. A patch can touch several files under a
/// single call id, so each gets a synthetic id — that is what lets the fold
/// attribute "created" to the right path.
fn push_patch_edits(
    targets: &[PatchTarget],
    at: i64,
    call_id: Option<&str>,
    out: &mut Vec<SessionEvent>,
) {
    let base = call_id.unwrap_or("patch");
    for (idx, target) in targets.iter().enumerate() {
        let id = format!("{}#{}", base, idx);
        out.push(SessionEvent::ToolCall(ToolCallEvent {
            tool_use_id: Some(id.clone()),
            at,
            action: ToolAction::Edit {
                path: target.path.clone(),
            },
            is_sidechain: false,
        }));
        if target.created {
            out.push(SessionEvent::ToolOutcome {
                tool_use_id: id,
                is_error: false,
                created: true,
            });
        }
    }
}

/// `command` is either `"ls -la"` or `["bash", "-lc", "ls -la"]`.
fn shell_command(args: &Value) -> Option<String> {
    let raw = args.get("command").or_else(|| args.get("cmd"))?;
    if let Some(text) = raw.as_str() {
        return (!text.is_empty()).then(|| text.to_string());
    }
    let parts = raw.as_array()?;
    // `bash -lc "<script>"` — the script is the last element and is the part
    // worth classifying; the wrapper adds noise.
    let joined = match parts.last().and_then(Value::as_str) {
        Some(last) if parts.len() > 1 => last.to_string(),
        _ => parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" "),
    };
    (!joined.is_empty()).then_some(joined)
}

/// A file named in an `apply_patch` envelope.
struct PatchTarget {
    path: String,
    /// `*** Add File:` — authored from nothing, so V19 has nothing to say.
    created: bool,
}

/// Extract the files an `apply_patch` envelope touches.
fn patch_targets(text: &str) -> Vec<PatchTarget> {
    const MARKERS: &[(&str, bool)] = &[
        ("*** Add File: ", true),
        ("*** Update File: ", false),
        ("*** Delete File: ", false),
    ];
    let mut targets: Vec<PatchTarget> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        for (marker, created) in MARKERS {
            if let Some(rest) = line.strip_prefix(marker) {
                let path = rest.trim();
                if !path.is_empty() && !targets.iter().any(|t| t.path == path) {
                    targets.push(PatchTarget {
                        path: path.to_string(),
                        created: *created,
                    });
                }
            }
        }
    }
    targets
}

/// Codex reports command failure inside the output text, not as a flag.
fn output_is_error(output: Option<&Value>) -> bool {
    let text = match output {
        Some(Value::String(s)) => s.as_str(),
        Some(other) => match other.get("output").and_then(Value::as_str) {
            Some(s) => s,
            None => return false,
        },
        None => return false,
    };
    // Only inspect the header region; command output itself may quote these.
    let head: String = text.chars().take(400).collect();
    for line in head.lines() {
        if let Some(rest) = line.trim().strip_prefix("Process exited with code ") {
            return rest.trim() != "0";
        }
    }
    head.contains("exit code: ") && !head.contains("exit code: 0")
}

fn translate_event_msg(payload: &Value, at: Option<i64>, out: &mut Vec<SessionEvent>) {
    let Some(at) = at else { return };
    if payload.get("type").and_then(Value::as_str) != Some("user_message") {
        return;
    }
    if let Some(text) = payload.get("message").and_then(Value::as_str) {
        if !text.is_empty() {
            out.push(SessionEvent::Prompt {
                at,
                text: text.to_string(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn translate(record: Value) -> Vec<SessionEvent> {
        let mut out = Vec::new();
        CodexAdapter.translate(&record, &mut out);
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

    #[test]
    fn reads_session_meta_identity() {
        let events = translate(json!({
            "timestamp": "2026-03-09T05:00:00.000Z",
            "type": "session_meta",
            "payload": {
                "id": "019cd10e",
                "cwd": "/Users/yj/repo",
                "git": { "branch": "main", "commit_hash": "abc" }
            }
        }));
        let SessionEvent::Meta(meta) = &events[0] else {
            panic!("expected meta")
        };
        assert_eq!(meta.session_id.as_deref(), Some("019cd10e"));
        assert_eq!(meta.cwd.as_deref(), Some("/Users/yj/repo"));
        assert_eq!(meta.git_branch.as_deref(), Some("main"));
    }

    #[test]
    fn unwraps_bash_lc_array_commands() {
        let events = translate(json!({
            "timestamp": "2026-03-09T05:01:00.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "shell",
                "call_id": "c1",
                "arguments": "{\"command\":[\"bash\",\"-lc\",\"cargo test\"],\"workdir\":\"/r\"}"
            }
        }));
        assert_eq!(
            actions(&events),
            vec![ToolAction::Bash { command: "cargo test".into() }]
        );
    }

    #[test]
    fn handles_exec_command_cmd_key() {
        let events = translate(json!({
            "timestamp": "2026-03-09T05:01:00.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "call_id": "c2",
                "arguments": "{\"cmd\":\"rg -n foo\",\"workdir\":\"/r\"}"
            }
        }));
        assert_eq!(
            actions(&events),
            vec![ToolAction::Bash { command: "rg -n foo".into() }]
        );
    }

    #[test]
    fn apply_patch_becomes_edits() {
        let patch = "*** Begin Patch\n*** Update File: src/a.rs\n@@\n-x\n+y\n*** Add File: src/b.rs\n*** End Patch";
        let events = translate(json!({
            "timestamp": "2026-03-09T05:02:00.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "apply_patch",
                "call_id": "c3",
                "arguments": format!("{{\"input\":{}}}", serde_json::to_string(patch).unwrap())
            }
        }));
        assert_eq!(
            actions(&events),
            vec![
                ToolAction::Edit { path: "src/a.rs".into() },
                ToolAction::Edit { path: "src/b.rs".into() },
            ]
        );
    }

    #[test]
    fn apply_patch_through_a_shell_heredoc_also_becomes_edits() {
        let events = translate(json!({
            "timestamp": "2026-03-09T05:02:00.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "shell",
                "call_id": "c4",
                "arguments": "{\"command\":[\"bash\",\"-lc\",\"apply_patch <<'EOF'\\n*** Begin Patch\\n*** Update File: src/c.rs\\n*** End Patch\\nEOF\"]}"
            }
        }));
        assert_eq!(
            actions(&events),
            vec![ToolAction::Edit { path: "src/c.rs".into() }]
        );
    }

    #[test]
    fn detects_failure_from_the_output_header() {
        let failed = translate(json!({
            "timestamp": "2026-03-09T05:03:00.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "c1",
                "output": "Chunk ID: 1\nWall time: 0.1 seconds\nProcess exited with code 1\nOutput:\nboom"
            }
        }));
        assert!(failed.iter().any(|e| matches!(
            e,
            SessionEvent::ToolOutcome { is_error: true, .. }
        )));

        let ok = translate(json!({
            "timestamp": "2026-03-09T05:03:00.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "c1",
                "output": "Process exited with code 0\nOutput:\nfine"
            }
        }));
        assert!(ok.iter().any(|e| matches!(
            e,
            SessionEvent::ToolOutcome { is_error: false, .. }
        )));
    }

    #[test]
    fn captures_user_message_prompts() {
        let events = translate(json!({
            "timestamp": "2026-03-09T05:00:10.000Z",
            "type": "event_msg",
            "payload": { "type": "user_message", "message": "refactor the parser" }
        }));
        assert!(events
            .iter()
            .any(|e| matches!(e, SessionEvent::Prompt { text, .. } if text == "refactor the parser")));
    }

    #[test]
    fn unknown_payloads_and_missing_fields_are_ignored() {
        assert!(actions(&translate(json!({ "type": "response_item" }))).is_empty());
        assert!(actions(&translate(json!({
            "timestamp": "2026-03-09T05:00:00.000Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "info": { "total": 1 } }
        })))
        .is_empty());
        assert!(actions(&translate(json!({
            "timestamp": "2026-03-09T05:00:00.000Z",
            "type": "response_item",
            "payload": { "type": "function_call", "name": "shell", "arguments": "not-json" }
        })))
        .is_empty());
    }
}
