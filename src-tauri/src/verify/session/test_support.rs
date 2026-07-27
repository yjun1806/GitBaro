//! Test-only helpers: a self-cleaning temp directory and synthetic JSONL
//! fixtures. Kept in one place so every test in this module exercises the same
//! record shapes.
//!
//! No `tempfile` crate is used — the verify contract adds no dependencies, and
//! `std::env::temp_dir()` plus a uuid is enough for hermetic tests.

use std::path::{Path, PathBuf};

/// A directory under the system temp dir, removed on drop.
pub struct TempDir {
    path: PathBuf,
}

impl Default for TempDir {
    fn default() -> Self {
        Self::new()
    }
}

impl TempDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("gitbaro-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Write `body` to `name` inside the temp dir and return its full path.
    pub fn write(&self, name: &str, body: &str) -> PathBuf {
        let path = self.path.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(&path, body).expect("write fixture");
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Pre-built [`SessionSummary`] / [`CommitFacts`] values for the attribution
/// and correlation tests, so both exercise identical baselines.
pub mod summary_fixture {
    use crate::verify::session::attribution::CommitFacts;
    use crate::verify::types::{FileEditSummary, SessionSource, SessionSummary};

    pub const REPO: &str = "/repo";
    pub const T0: i64 = 1_772_000_000_000;

    pub fn edit(path: &str) -> FileEditSummary {
        FileEditSummary {
            path: format!("{}/{}", REPO, path),
            edit_count: 1,
            first_edit_at: T0,
            last_edit_at: T0 + 1000,
            was_read_first: true,
            after_compaction: false,
            by_subagent: false,
            via_bash: false,
        }
    }

    /// A one-minute session on `branch`, rooted at `cwd`, editing `files`.
    pub fn session(branch: Option<&str>, cwd: &str, files: &[&str]) -> SessionSummary {
        named_session("sess-1", branch, cwd, files)
    }

    pub fn named_session(
        id: &str,
        branch: Option<&str>,
        cwd: &str,
        files: &[&str],
    ) -> SessionSummary {
        SessionSummary {
            session_id: id.into(),
            source: SessionSource::ClaudeCode,
            file_path: format!("/logs/{}.jsonl", id),
            cwd: cwd.into(),
            git_branch: branch.map(str::to_string),
            started_at: T0,
            ended_at: T0 + 60_000,
            modified_at: T0 + 60_000,
            first_user_prompt: None,
            prompts: Vec::new(),
            files_read: Vec::new(),
            files_edited: files.iter().map(|f| edit(f)).collect(),
            bash_commands: Vec::new(),
            compaction_boundaries: Vec::new(),
            injected_rules_digest: None,
            truncated: false,
            skipped_records: 0,
        }
    }

    /// A single-parent commit on `main`, authored by the configured user, with
    /// no reflog evidence either way.
    pub fn commit(at: i64, files: &[&str]) -> CommitFacts {
        named_commit("abc123", at, files)
    }

    pub fn named_commit(oid: &str, at: i64, files: &[&str]) -> CommitFacts {
        CommitFacts {
            oid: oid.into(),
            timestamp_ms: at,
            files: files.iter().map(|f| f.to_string()).collect(),
            parent_count: 1,
            author_email: Some("dev@example.com".into()),
            branches: ["main".to_string()].into_iter().collect(),
            reflog_first_seen_at: None,
        }
    }
}

/// Synthetic session records matching the shapes observed in live logs.
pub mod fixture {
    use serde_json::{json, Value};

    /// Join records into a JSONL body.
    pub fn lines(records: &[Value]) -> String {
        let mut body = String::new();
        for record in records {
            body.push_str(&serde_json::to_string(record).expect("encode"));
            body.push('\n');
        }
        body
    }

    fn common(ts: &str) -> Value {
        json!({
            "timestamp": ts,
            "sessionId": "sess-1",
            "cwd": "/repo",
            "gitBranch": "main",
            "uuid": ts,
        })
    }

    fn with(base: Value, extra: Value) -> Value {
        let mut merged = base;
        if let (Some(map), Some(add)) = (merged.as_object_mut(), extra.as_object()) {
            for (k, v) in add {
                map.insert(k.clone(), v.clone());
            }
        }
        merged
    }

    pub fn user_prompt(text: &str, ts: &str) -> Value {
        with(
            common(ts),
            json!({ "type": "user", "message": { "content": text } }),
        )
    }

    pub fn assistant_tool(id: &str, name: &str, input: Value, ts: &str, sidechain: bool) -> Value {
        with(
            common(ts),
            json!({
                "type": "assistant",
                "isSidechain": sidechain,
                "message": { "content": [
                    { "type": "tool_use", "id": id, "name": name, "input": input }
                ]}
            }),
        )
    }

    pub fn assistant_read(id: &str, path: &str, ts: &str) -> Value {
        assistant_tool(id, "Read", json!({ "file_path": path }), ts, false)
    }

    pub fn assistant_edit(id: &str, path: &str, ts: &str, sidechain: bool) -> Value {
        assistant_tool(
            id,
            "Edit",
            json!({ "file_path": path, "old_string": "a", "new_string": "b" }),
            ts,
            sidechain,
        )
    }

    pub fn assistant_bash(id: &str, command: &str, ts: &str) -> Value {
        assistant_tool(id, "Bash", json!({ "command": command }), ts, false)
    }

    pub fn tool_result(tool_use_id: &str, is_error: bool, ts: &str) -> Value {
        with(
            common(ts),
            json!({
                "type": "user",
                "message": { "content": [
                    { "type": "tool_result", "tool_use_id": tool_use_id,
                      "is_error": is_error, "content": "output" }
                ]},
                "toolUseResult": { "stdout": "", "stderr": "", "interrupted": false }
            }),
        )
    }

    /// A `Write` that created the file: `toolUseResult.type == "create"`.
    pub fn write_created(id: &str, path: &str, ts: &str) -> Vec<Value> {
        vec![
            assistant_tool(id, "Write", json!({ "file_path": path, "content": "x" }), ts, false),
            with(
                common(ts),
                json!({
                    "type": "user",
                    "message": { "content": [
                        { "type": "tool_result", "tool_use_id": id, "content": "ok" }
                    ]},
                    "toolUseResult": { "type": "create", "filePath": path }
                }),
            ),
        ]
    }

    pub fn compact_boundary(ts: &str) -> Value {
        with(
            common(ts),
            json!({
                "type": "system",
                "subtype": "compact_boundary",
                "compactMetadata": { "trigger": "auto", "preTokens": 150000 }
            }),
        )
    }

    pub fn system_rules(ts: &str, body: &str) -> Value {
        with(
            common(ts),
            json!({ "type": "system", "content": format!("Contents of CLAUDE.md:\n{}", body) }),
        )
    }

    /// Read → edit → passing test run. The baseline "nothing to flag" session.
    pub fn normal_session() -> String {
        lines(&[
            user_prompt("fix the parser", "2026-03-09T05:00:00.000Z"),
            assistant_read("t1", "/repo/src/a.rs", "2026-03-09T05:01:00.000Z"),
            assistant_edit("t2", "/repo/src/a.rs", "2026-03-09T05:02:00.000Z", false),
            assistant_bash("t3", "cargo test", "2026-03-09T05:03:00.000Z"),
            tool_result("t3", false, "2026-03-09T05:04:00.000Z"),
        ])
    }

    /// A Codex rollout rooted at `cwd`.
    pub fn codex_session(cwd: &str) -> String {
        lines(&[
            json!({
                "timestamp": "2026-03-09T05:00:00.000Z",
                "type": "session_meta",
                "payload": {
                    "id": "codex-1",
                    "cwd": cwd,
                    "git": { "branch": "main", "commit_hash": "abc123" }
                }
            }),
            json!({
                "timestamp": "2026-03-09T05:00:10.000Z",
                "type": "event_msg",
                "payload": { "type": "user_message", "message": "refactor the parser" }
            }),
            json!({
                "timestamp": "2026-03-09T05:01:00.000Z",
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "name": "shell",
                    "call_id": "c1",
                    "arguments": "{\"command\":[\"bash\",\"-lc\",\"cargo test\"],\"workdir\":\"/repo\"}"
                }
            }),
            json!({
                "timestamp": "2026-03-09T05:02:00.000Z",
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "c1",
                    "output": "Process exited with code 0\nOutput:\nok"
                }
            }),
        ])
    }
}
