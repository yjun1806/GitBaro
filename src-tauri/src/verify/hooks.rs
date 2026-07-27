//! V28 — hook-based session collection (spec §Layer 5, `v28.hookCollector`).
//!
//! The `session/` module reverse-engineers Claude Code's JSONL transcript. That
//! format is unofficial and can change in a patch release. Claude Code *does*
//! have a documented extension point — hooks in `~/.claude/settings.json` — so
//! this module offers the robust alternative: ask Claude Code to hand us the
//! tool calls, instead of guessing them from a private file.
//!
//! **This module edits a file the user owns.** Every design choice below follows
//! from that:
//!
//! - Nothing is installed unless [`install`] is called. There is no implicit
//!   install, no "install on first run", no repair-on-status.
//! - [`preview`] returns the exact JSON that would be merged plus the exact
//!   script body, so the UI can show it before the user consents.
//! - A missing or malformed `settings.json` is an error, never an overwrite.
//! - The original file is copied to a timestamped backup before any write, and
//!   the write itself is temp-file + `rename`.
//! - [`uninstall`] removes exactly the entries carrying our marker.
//!
//! **Known limitation** — `serde_json::Map` is a `BTreeMap`, so re-serializing
//! sorts the object keys. Uninstall therefore restores the file's *content*,
//! not its original byte order; the pre-write backup is the byte-exact copy. A
//! no-op install/uninstall writes nothing at all, so an untouched file is never
//! reordered.
//!
//! The registry row `v28.hookCollector` stays `Planned`: this module is a
//! *collection path*, not a rule. It emits no `Finding` — the findings come
//! from V19–V27 consuming the [`SessionSummary`] produced here.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::error::AppError;
use crate::verify::session::bash;
use crate::verify::session::event::{looks_like_file_path, parse_timestamp};
use crate::verify::session::jsonl::{self, Flow};
use crate::verify::types::{
    BashCommandRecord, FileEditSummary, SessionSource, SessionSummary,
};

/// Bumped whenever the installed script or the settings fragment changes, so
/// [`status`] can tell an old install from a current one.
pub const HOOK_VERSION: u32 = 1;

/// Substring that identifies a hook entry as ours. Carried inside the `command`
/// string rather than as an extra JSON field, because we must not assume the
/// consumer tolerates unknown keys in its own schema.
const MARKER: &str = "gitbaro-hook-v";

/// Hook events we register. `PostToolUse` carries the evidence; `Stop` and
/// `SessionEnd` bound the session in time.
const EVENTS: &[&str] = &["PostToolUse", "Stop", "SessionEnd"];

/// Regex Claude Code matches against the tool name. Deliberately explicit: an
/// empty matcher would record every tool, including ones we derive nothing from.
const TOOL_MATCHER: &str = "Bash|Edit|Write|MultiEdit|NotebookEdit|Read|NotebookRead|Glob|Grep";

/// Seconds Claude Code waits for the hook. The script is a single append.
const HOOK_TIMEOUT_SECS: u64 = 5;

const SCRIPT_NAME: &str = "gitbaro-claude-hook.sh";
const LOG_PREFIX: &str = "events-";
const LOG_SUFFIX: &str = ".jsonl";

/// Files older than this are ignored by the reader and removed by
/// [`prune_event_log`]. Session evidence is only useful next to a recent commit.
pub const LOG_RETENTION_DAYS: u32 = 14;

// ── Locations ────────────────────────────────────────────────────────────────

/// Every path this module touches, in one place so tests never see `$HOME`.
#[derive(Clone, Debug)]
pub struct HookPaths {
    /// `~/.claude/settings.json` — **the user's file**.
    pub settings_file: PathBuf,
    /// GitBaro's own directory: the script and the event log live here.
    pub data_dir: PathBuf,
}

impl HookPaths {
    /// Real locations: the user's Claude config, GitBaro's application support
    /// directory.
    pub fn from_home() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        Self {
            settings_file: home.join(".claude").join("settings.json"),
            data_dir: crate::state::app_state::get_state_dir().join("verify-hooks"),
        }
    }

    pub fn with(settings_file: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            settings_file,
            data_dir,
        }
    }

    pub fn script_file(&self) -> PathBuf {
        self.data_dir.join(SCRIPT_NAME)
    }

    /// Append-only JSONL lives here — inside GitBaro's data dir, never inside
    /// the user's repository.
    pub fn log_dir(&self) -> PathBuf {
        self.data_dir.join("events")
    }
}

// ── Wire types ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SettingsState {
    /// Present and a JSON object — the only state install/uninstall accept.
    Ok,
    /// No file. We never create one: that is Claude Code's file to own.
    Missing,
    /// Present but unreadable or not a JSON object.
    Malformed,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub settings_path: String,
    pub settings_state: SettingsState,
    /// True when at least one of our entries is present.
    pub installed: bool,
    /// Lowest version found among our entries — an old entry means "upgrade".
    pub installed_version: Option<u32>,
    pub current_version: u32,
    pub needs_upgrade: bool,
    /// Hook events that currently carry one of our entries.
    pub installed_events: Vec<String>,
    pub script_path: String,
    pub script_present: bool,
    pub log_dir: String,
    pub log_files: usize,
    pub log_bytes: u64,
}

/// Everything the consent dialog needs to show. Nothing here is written.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HookPreview {
    pub settings_path: String,
    pub settings_state: SettingsState,
    /// The exact JSON merged under the top-level `hooks` key, pretty-printed.
    pub settings_fragment: String,
    pub script_path: String,
    /// The exact bytes written to `script_path`.
    pub script_body: String,
    pub log_dir: String,
    /// Plain-language list of what the log will contain (full disclosure).
    pub recorded_fields: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HookChange {
    pub settings_path: String,
    /// `None` when nothing had to be written, so no backup was taken.
    pub backup_path: Option<String>,
    /// False when the file already had exactly the desired content.
    pub changed: bool,
    pub events: Vec<String>,
}

// ── Settings file I/O ────────────────────────────────────────────────────────

/// Read and parse the settings file. `Ok(None)` means "not present".
fn read_settings(path: &Path) -> Result<Option<Map<String, Value>>, AppError> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(AppError::Verify(format!(
                "Could not read {}: {}. GitBaro will not modify it.",
                path.display(),
                e
            )))
        }
    };
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(map)) => Ok(Some(map)),
        Ok(_) => Err(AppError::Verify(format!(
            "{} is not a JSON object. GitBaro will not modify it.",
            path.display()
        ))),
        Err(e) => Err(AppError::Verify(format!(
            "{} is not valid JSON ({}). Fix or remove the file, then try again — \
             GitBaro will not overwrite it.",
            path.display(),
            e
        ))),
    }
}

/// The settings file must exist before we merge into it. Creating it would mean
/// guessing at defaults for a file another program owns.
fn require_settings(path: &Path) -> Result<Map<String, Value>, AppError> {
    read_settings(path)?.ok_or_else(|| {
        AppError::Verify(format!(
            "{} does not exist. Run Claude Code once so it creates its settings \
             file, then install the hook again.",
            path.display()
        ))
    })
}

/// Copy the current bytes next to the original before any write.
fn backup(path: &Path) -> Result<PathBuf, AppError> {
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let name = format!(
        "{}.gitbaro-backup-{}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("settings.json"),
        stamp
    );
    let target = path.with_file_name(name);
    std::fs::copy(path, &target)?;
    Ok(target)
}

/// Temp file in the same directory, then `rename` — so a crash mid-write can
/// never leave a truncated `settings.json`.
fn write_atomic(path: &Path, settings: &Map<String, Value>) -> Result<(), AppError> {
    let body = serde_json::to_string_pretty(&Value::Object(settings.clone()))? + "\n";
    let temp = path.with_extension(format!("gitbaro-tmp-{}", uuid::Uuid::new_v4()));

    let write = || -> Result<(), AppError> {
        std::fs::write(&temp, body.as_bytes())?;
        copy_permissions(path, &temp);
        std::fs::rename(&temp, path)?;
        Ok(())
    };

    let result = write();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Best-effort: keep the original file mode so we do not widen its permissions.
fn copy_permissions(from: &Path, to: &Path) {
    if let Ok(meta) = std::fs::metadata(from) {
        let _ = std::fs::set_permissions(to, meta.permissions());
    }
}

// ── Hook entries ─────────────────────────────────────────────────────────────

/// `'<script>' gitbaro-hook-v1` — the marker rides in an argument the script
/// ignores, so identification survives the user moving their home directory.
fn hook_command(script: &Path) -> String {
    format!("'{}' {}{}", script.display(), MARKER, HOOK_VERSION)
}

fn hook_group(script: &Path, matcher: Option<&str>) -> Value {
    let entry = json!({
        "type": "command",
        "command": hook_command(script),
        "timeout": HOOK_TIMEOUT_SECS,
    });
    match matcher {
        Some(matcher) => json!({ "matcher": matcher, "hooks": [entry] }),
        None => json!({ "hooks": [entry] }),
    }
}

/// The fragment merged under the top-level `hooks` key.
fn fragment(script: &Path) -> Map<String, Value> {
    let mut map = Map::new();
    for event in EVENTS {
        let matcher = (*event == "PostToolUse").then_some(TOOL_MATCHER);
        map.insert(event.to_string(), json!([hook_group(script, matcher)]));
    }
    map
}

/// The version stamped into a matcher-group, if it is one of ours.
fn group_version(group: &Value) -> Option<u32> {
    let hooks = group.get("hooks")?.as_array()?;
    hooks.iter().find_map(|hook| {
        let command = hook.get("command")?.as_str()?;
        let rest = command.split(MARKER).nth(1)?;
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        digits.parse().ok()
    })
}

fn is_ours(group: &Value) -> bool {
    group_version(group).is_some()
}

/// Remove our matcher-groups from one event array. Returns the removed count.
fn strip_event(list: &mut Vec<Value>) -> usize {
    let before = list.len();
    list.retain(|group| !is_ours(group));
    before - list.len()
}

/// Apply `mutate` to every event array under `hooks`, then drop containers that
/// became empty so an uninstall leaves no residue.
fn edit_hooks<F>(settings: &mut Map<String, Value>, mut mutate: F) -> Result<(), AppError>
where
    F: FnMut(&str, &mut Vec<Value>),
{
    let hooks = match settings.get_mut("hooks") {
        Some(Value::Object(map)) => map,
        Some(_) => {
            return Err(AppError::Verify(
                "The \"hooks\" key in settings.json is not an object. GitBaro will \
                 not modify it."
                    .to_string(),
            ))
        }
        None => {
            settings.insert("hooks".to_string(), Value::Object(Map::new()));
            settings
                .get_mut("hooks")
                .and_then(Value::as_object_mut)
                .expect("just inserted an object")
        }
    };

    for event in EVENTS {
        let mut list = match hooks.remove(*event) {
            Some(Value::Array(list)) => list,
            Some(other) => {
                hooks.insert(event.to_string(), other);
                return Err(AppError::Verify(format!(
                    "hooks.{} in settings.json is not an array. GitBaro will not \
                     modify it.",
                    event
                )));
            }
            None => Vec::new(),
        };
        mutate(event, &mut list);
        if !list.is_empty() {
            hooks.insert(event.to_string(), Value::Array(list));
        }
    }

    if hooks.is_empty() {
        settings.remove("hooks");
    }
    Ok(())
}

// ── Public operations ────────────────────────────────────────────────────────

/// Never fails: a status probe must not be able to raise an error toast.
pub fn status(paths: &HookPaths) -> HookStatus {
    let (state, settings) = match read_settings(&paths.settings_file) {
        Ok(Some(map)) => (SettingsState::Ok, Some(map)),
        Ok(None) => (SettingsState::Missing, None),
        Err(_) => (SettingsState::Malformed, None),
    };

    let mut events = Vec::new();
    let mut versions = Vec::new();
    if let Some(hooks) = settings
        .as_ref()
        .and_then(|s| s.get("hooks"))
        .and_then(Value::as_object)
    {
        for (event, value) in hooks {
            let found: Vec<u32> = value
                .as_array()
                .map(|list| list.iter().filter_map(group_version).collect())
                .unwrap_or_default();
            if !found.is_empty() {
                events.push(event.clone());
                versions.extend(found);
            }
        }
    }

    let (log_files, log_bytes) = log_usage(&paths.log_dir());
    let installed_version = versions.iter().copied().min();

    HookStatus {
        settings_path: paths.settings_file.display().to_string(),
        settings_state: state,
        installed: !events.is_empty(),
        needs_upgrade: installed_version.is_some_and(|v| v < HOOK_VERSION),
        installed_version,
        current_version: HOOK_VERSION,
        installed_events: events,
        script_path: paths.script_file().display().to_string(),
        script_present: paths.script_file().is_file(),
        log_dir: paths.log_dir().display().to_string(),
        log_files,
        log_bytes,
    }
}

/// Exactly what [`install`] would write. Writes nothing.
pub fn preview(paths: &HookPaths) -> HookPreview {
    let script = paths.script_file();
    let state = match read_settings(&paths.settings_file) {
        Ok(Some(_)) => SettingsState::Ok,
        Ok(None) => SettingsState::Missing,
        Err(_) => SettingsState::Malformed,
    };
    HookPreview {
        settings_path: paths.settings_file.display().to_string(),
        settings_state: state,
        settings_fragment: serde_json::to_string_pretty(&Value::Object(fragment(&script)))
            .unwrap_or_default(),
        script_path: script.display().to_string(),
        script_body: script_body(&paths.log_dir()),
        log_dir: paths.log_dir().display().to_string(),
        recorded_fields: recorded_fields(),
    }
}

/// What the event log will contain, in the words shown to the user.
fn recorded_fields() -> Vec<String> {
    [
        "session id, working directory and transcript path reported by Claude Code",
        "tool name and tool input for file reads, file edits and shell commands",
        "whether each tool call succeeded",
        "UTC timestamp of each recorded call",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Merge our entries into the user's settings file. Explicit opt-in only.
///
/// Idempotent: reinstalling replaces our own entries and leaves everything else
/// alone. When nothing changes, no backup is taken and no write happens.
pub fn install(paths: &HookPaths) -> Result<HookChange, AppError> {
    let original = require_settings(&paths.settings_file)?;
    let script = paths.script_file();

    let mut updated = original.clone();
    let fragment = fragment(&script);
    edit_hooks(&mut updated, |event, list| {
        strip_event(list);
        if let Some(Value::Array(ours)) = fragment.get(event) {
            list.extend(ours.iter().cloned());
        }
    })?;

    write_script(&script, &paths.log_dir())?;
    std::fs::create_dir_all(paths.log_dir())?;

    if updated == original {
        return Ok(HookChange {
            settings_path: paths.settings_file.display().to_string(),
            backup_path: None,
            changed: false,
            events: EVENTS.iter().map(|e| e.to_string()).collect(),
        });
    }

    let backup_path = backup(&paths.settings_file)?;
    write_atomic(&paths.settings_file, &updated)?;
    tracing::info!(
        "[verify] installed Claude Code hooks v{} (backup: {})",
        HOOK_VERSION,
        backup_path.display()
    );

    Ok(HookChange {
        settings_path: paths.settings_file.display().to_string(),
        backup_path: Some(backup_path.display().to_string()),
        changed: true,
        events: EVENTS.iter().map(|e| e.to_string()).collect(),
    })
}

/// Remove exactly the entries carrying our marker.
///
/// The event log is deliberately *not* deleted — it is evidence the user may
/// still want. [`clear_event_log`] does that, separately and explicitly.
pub fn uninstall(paths: &HookPaths) -> Result<HookChange, AppError> {
    let original = require_settings(&paths.settings_file)?;

    let mut updated = original.clone();
    let mut removed = 0usize;
    edit_hooks(&mut updated, |_, list| removed += strip_event(list))?;

    let _ = std::fs::remove_file(paths.script_file());

    if updated == original {
        return Ok(HookChange {
            settings_path: paths.settings_file.display().to_string(),
            backup_path: None,
            changed: false,
            events: Vec::new(),
        });
    }

    let backup_path = backup(&paths.settings_file)?;
    write_atomic(&paths.settings_file, &updated)?;
    tracing::info!("[verify] removed {} Claude Code hook entries", removed);

    Ok(HookChange {
        settings_path: paths.settings_file.display().to_string(),
        backup_path: Some(backup_path.display().to_string()),
        changed: true,
        events: EVENTS.iter().map(|e| e.to_string()).collect(),
    })
}

// ── The collector script ─────────────────────────────────────────────────────

/// POSIX `sh`, no interpreter beyond what macOS ships, and `exit 0` on every
/// path: a hook that fails must never interrupt the user's agent.
///
/// Newlines inside the payload are folded to spaces so one hook call is exactly
/// one JSONL line. JSON strings cannot contain a raw newline, so this only
/// removes pretty-printing whitespace.
pub fn script_body(log_dir: &Path) -> String {
    format!(
        r#"#!/bin/sh
# GitBaro session collector (verification rule V28).
#
# Installed by GitBaro on explicit request. It appends the Claude Code hook
# payload it receives on stdin to an append-only log under GitBaro's own data
# directory. It writes nowhere else and never touches your repository.
#
# Remove it from GitBaro: Settings -> Verification -> Session hooks -> Uninstall.
set -u
DIR='{dir}'
mkdir -p "$DIR" 2>/dev/null || exit 0
PAYLOAD=$(tr '\n\r' '  ')
[ -n "$PAYLOAD" ] || exit 0
AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DAY=$(date -u +%Y-%m-%d)
printf '{{"schema":{version},"at":"%s","payload":%s}}\n' "$AT" "$PAYLOAD" \
  >> "$DIR/{prefix}$DAY{suffix}" 2>/dev/null
exit 0
"#,
        dir = log_dir.display(),
        version = HOOK_VERSION,
        prefix = LOG_PREFIX,
        suffix = LOG_SUFFIX,
    )
}

fn write_script(script: &Path, log_dir: &Path) -> Result<(), AppError> {
    if let Some(parent) = script.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(script, script_body(log_dir))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(script, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

// ── Event log ────────────────────────────────────────────────────────────────

fn log_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(LOG_PREFIX) && n.ends_with(LOG_SUFFIX))
        })
        .collect();
    // The name embeds the UTC date, so lexical order is chronological order.
    files.sort();
    files
}

fn log_usage(dir: &Path) -> (usize, u64) {
    let files = log_files(dir);
    let bytes = files
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();
    (files.len(), bytes)
}

/// Delete log files whose date is older than `keep_days`. Best-effort.
pub fn prune_event_log(dir: &Path, keep_days: u32) -> usize {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(keep_days as i64))
        .format("%Y-%m-%d")
        .to_string();
    let mut removed = 0;
    for path in log_files(dir) {
        let day = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.trim_start_matches(LOG_PREFIX).trim_end_matches(LOG_SUFFIX))
            .unwrap_or_default()
            .to_string();
        if day < cutoff && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Remove the whole event log. Separate from [`uninstall`] so "stop recording"
/// and "delete what was recorded" stay distinct choices.
pub fn clear_event_log(dir: &Path) -> Result<(), AppError> {
    for path in log_files(dir) {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Per-session accumulator. Deliberately mirrors the fold in `session/summary.rs`
/// so both collection paths produce the same [`SessionSummary`] shape.
#[derive(Default)]
struct Fold {
    cwd: Option<String>,
    transcript: Option<String>,
    first_at: Option<i64>,
    last_at: Option<i64>,
    files_read: Vec<String>,
    read_at: BTreeMap<String, i64>,
    edits: BTreeMap<String, EditAcc>,
    created: BTreeSet<String>,
    commands: Vec<BashCommandRecord>,
}

struct EditAcc {
    count: u32,
    first_at: i64,
    last_at: i64,
    via_bash: bool,
}

impl Fold {
    fn observe(&mut self, at: i64) {
        self.first_at = Some(self.first_at.map_or(at, |cur| cur.min(at)));
        self.last_at = Some(self.last_at.map_or(at, |cur| cur.max(at)));
    }

    fn read(&mut self, path: String, at: i64) {
        self.read_at.entry(path.clone()).or_insert(at);
        if !self.files_read.contains(&path) {
            self.files_read.push(path);
        }
    }

    fn edit(&mut self, path: String, at: i64, via_bash: bool) {
        self.edits
            .entry(path)
            .and_modify(|acc| {
                acc.count += 1;
                acc.first_at = acc.first_at.min(at);
                acc.last_at = acc.last_at.max(at);
                acc.via_bash |= via_bash;
            })
            .or_insert(EditAcc {
                count: 1,
                first_at: at,
                last_at: at,
                via_bash,
            });
    }

    fn tool(&mut self, payload: &Value, at: i64) {
        let Some(name) = payload.get("tool_name").and_then(Value::as_str) else {
            return;
        };
        let input = payload.get("tool_input").unwrap_or(&Value::Null);
        let response = payload.get("tool_response").unwrap_or(&Value::Null);

        match name {
            "Read" | "NotebookRead" => {
                if let Some(path) = file_arg(input) {
                    self.read(path, at);
                }
            }
            "Glob" | "Grep" => {
                // A directory-wide search is not "the agent looked at this
                // file"; only a concrete path counts (same rule as V19).
                if let Some(path) = str_field(input, "path").filter(|p| looks_like_file_path(p)) {
                    self.read(path, at);
                }
            }
            "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
                if let Some(path) = file_arg(input) {
                    if response.get("type").and_then(Value::as_str) == Some("create") {
                        self.created.insert(path.clone());
                    }
                    self.edit(path, at, false);
                }
            }
            "Bash" => {
                if let Some(command) = str_field(input, "command") {
                    self.bash(&command, at, response);
                }
            }
            _ => {}
        }
    }

    fn bash(&mut self, command: &str, at: i64, response: &Value) {
        let classification = bash::classify(command);
        for path in &classification.mutated_paths {
            self.edit(path.clone(), at, true);
        }
        self.commands.push(BashCommandRecord {
            command: jsonl::truncate_chars(command, jsonl::MAX_COMMAND_CHARS),
            at,
            is_error: response
                .get("success")
                .and_then(Value::as_bool)
                .map(|ok| !ok)
                .unwrap_or(false),
            kind: classification.kind,
        });
    }

    fn finish(self, session_id: String, log_file: &Path, skipped: usize) -> SessionSummary {
        let started_at = self.first_at.unwrap_or(0);
        let files_edited = self
            .edits
            .into_iter()
            .map(|(path, acc)| FileEditSummary {
                was_read_first: self.created.contains(&path)
                    || self
                        .read_at
                        .get(&path)
                        .is_some_and(|read_at| *read_at <= acc.first_at),
                path,
                edit_count: acc.count,
                first_edit_at: acc.first_at,
                last_edit_at: acc.last_at,
                // Hook payloads carry no compaction marker and no sidechain
                // flag, so V23/V24 have no input on this path (see module docs).
                after_compaction: false,
                by_subagent: false,
                via_bash: acc.via_bash,
            })
            .collect();

        SessionSummary {
            session_id,
            source: SessionSource::ClaudeCode,
            file_path: self
                .transcript
                .unwrap_or_else(|| log_file.display().to_string()),
            cwd: self.cwd.unwrap_or_default(),
            git_branch: None,
            started_at,
            ended_at: self.last_at.unwrap_or(started_at),
            // `UserPromptSubmit` is not one of the installed events, so the
            // prompt text is never recorded and V26 cannot run from hook data.
            first_user_prompt: None,
            files_read: self.files_read,
            files_edited,
            bash_commands: self.commands,
            compaction_boundaries: Vec::new(),
            injected_rules_digest: None,
            truncated: false,
            skipped_records: skipped,
        }
    }
}

fn str_field(value: &Value, key: &str) -> Option<String> {
    let text = value.get(key)?.as_str()?;
    (!text.is_empty()).then(|| text.to_string())
}

/// Claude Code names the argument `file_path` for text tools and
/// `notebook_path` for notebooks.
fn file_arg(input: &Value) -> Option<String> {
    str_field(input, "file_path").or_else(|| str_field(input, "notebook_path"))
}

/// Read every event-log file and fold it into one [`SessionSummary`] per
/// session id, newest session first.
///
/// `repo_path`, when given, keeps only sessions whose `cwd` is the repository or
/// a directory inside it — the same membership rule the JSONL path uses.
///
/// A corrupt or interleaved line is skipped and counted, never fatal: two hooks
/// appending at the same moment can in principle tear a line, and losing one
/// record must not lose the session.
pub fn summarize_hook_sessions(log_dir: &Path, repo_path: Option<&Path>) -> Vec<SessionSummary> {
    let mut folds: BTreeMap<String, Fold> = BTreeMap::new();
    let mut origin: BTreeMap<String, PathBuf> = BTreeMap::new();
    let mut skipped = 0usize;

    for file in log_files(log_dir) {
        let outcome = jsonl::stream_records(&file, |record| {
            if let Some(session_id) = fold_record(record, &mut folds) {
                origin.entry(session_id).or_insert_with(|| file.clone());
            }
            Flow::Continue
        });
        match outcome {
            Ok(outcome) => skipped += outcome.stats.skipped_records,
            Err(e) => tracing::debug!("[verify] hook log unreadable ({}): {}", file.display(), e),
        }
    }

    // One log file interleaves every session, so a skipped line cannot be
    // attributed to one of them. Every summary carries the total: over-reporting
    // "this is partial" is the safe direction.
    let repo = repo_path.map(|p| p.to_string_lossy().to_string());
    let mut summaries: Vec<SessionSummary> = folds
        .into_iter()
        .map(|(session_id, fold)| {
            let file = origin.remove(&session_id).unwrap_or_default();
            fold.finish(session_id, &file, skipped)
        })
        .filter(|summary| match &repo {
            Some(repo) => is_inside(&summary.cwd, repo),
            None => true,
        })
        .collect();

    summaries.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
    summaries
}

/// Fold one envelope into its session, returning the session id it belonged to.
fn fold_record(record: &Value, folds: &mut BTreeMap<String, Fold>) -> Option<String> {
    let payload = record.get("payload")?;
    let session_id = str_field(payload, "session_id")?;
    let at = parse_timestamp(record.get("at"))?;

    let fold = folds.entry(session_id.clone()).or_default();
    fold.observe(at);
    if fold.cwd.is_none() {
        fold.cwd = str_field(payload, "cwd");
    }
    if fold.transcript.is_none() {
        fold.transcript = str_field(payload, "transcript_path");
    }
    if payload.get("hook_event_name").and_then(Value::as_str) == Some("PostToolUse") {
        fold.tool(payload, at);
    }
    Some(session_id)
}

fn is_inside(cwd: &str, repo: &str) -> bool {
    cwd == repo || cwd.starts_with(&format!("{}/", repo))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::types::BashCommandKind;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("gitbaro-hooks-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn write(&self, name: &str, body: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, body).expect("write");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn paths(dir: &TempDir, settings: &str) -> HookPaths {
        HookPaths::with(dir.write("settings.json", settings), dir.0.join("data"))
    }

    fn parse(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).expect("read")).expect("json")
    }

    // ── settings merge ────────────────────────────────────────────────────

    #[test]
    fn install_then_uninstall_restores_the_original_content() {
        let dir = TempDir::new();
        let original = r#"{"model":"opus","permissions":{"allow":["Bash(ls:*)"]}}"#;
        let p = paths(&dir, original);

        install(&p).expect("install");
        let after_install = parse(&p.settings_file);
        assert!(after_install.get("hooks").is_some());
        assert_eq!(after_install["model"], json!("opus"));

        uninstall(&p).expect("uninstall");
        assert_eq!(
            parse(&p.settings_file),
            serde_json::from_str::<Value>(original).expect("json"),
            "uninstall must leave nothing of ours behind"
        );
    }

    #[test]
    fn install_preserves_hooks_the_user_already_had() {
        let dir = TempDir::new();
        let mine = json!({
            "hooks": {
                "PostToolUse": [{ "matcher": "Edit", "hooks": [
                    { "type": "command", "command": "my-own-linter" }
                ]}],
                "PreToolUse": [{ "hooks": [
                    { "type": "command", "command": "guard" }
                ]}]
            }
        });
        let p = paths(&dir, &mine.to_string());

        install(&p).expect("install");
        let after = parse(&p.settings_file);
        let post = after["hooks"]["PostToolUse"].as_array().expect("array");
        assert_eq!(post.len(), 2, "user group kept, ours appended");
        assert!(post.iter().any(|g| !is_ours(g)));
        assert_eq!(after["hooks"]["PreToolUse"], mine["hooks"]["PreToolUse"]);

        uninstall(&p).expect("uninstall");
        assert_eq!(parse(&p.settings_file), mine);
    }

    #[test]
    fn reinstall_is_idempotent_and_writes_nothing_the_second_time() {
        let dir = TempDir::new();
        let p = paths(&dir, "{}");

        let first = install(&p).expect("install");
        assert!(first.changed);
        assert!(first.backup_path.is_some());

        let second = install(&p).expect("reinstall");
        assert!(!second.changed, "no content change means no write");
        assert!(second.backup_path.is_none(), "no write means no backup");

        let groups = parse(&p.settings_file)["hooks"]["PostToolUse"]
            .as_array()
            .expect("array")
            .len();
        assert_eq!(groups, 1, "entries must not accumulate");
    }

    #[test]
    fn uninstalling_when_nothing_is_installed_changes_nothing() {
        let dir = TempDir::new();
        let p = paths(&dir, r#"{"model":"opus"}"#);
        let outcome = uninstall(&p).expect("uninstall");
        assert!(!outcome.changed);
        assert!(outcome.backup_path.is_none());
        assert_eq!(
            std::fs::read_to_string(&p.settings_file).expect("read"),
            r#"{"model":"opus"}"#,
            "an untouched file keeps its exact bytes"
        );
    }

    #[test]
    fn install_takes_a_timestamped_backup_of_the_original_bytes() {
        let dir = TempDir::new();
        let original = r#"{ "model":   "opus" }"#;
        let p = paths(&dir, original);
        let outcome = install(&p).expect("install");
        let backup = outcome.backup_path.expect("backup");
        assert!(backup.contains("gitbaro-backup-"));
        assert_eq!(
            std::fs::read_to_string(backup).expect("read backup"),
            original,
            "the backup is byte-exact, formatting included"
        );
    }

    #[test]
    fn a_malformed_settings_file_is_never_overwritten() {
        let dir = TempDir::new();
        let broken = "{ this is not json";
        let p = paths(&dir, broken);

        let err = install(&p).expect_err("must refuse");
        assert!(matches!(err, AppError::Verify(_)));
        assert!(err.to_string().contains("not valid JSON"));
        assert_eq!(
            std::fs::read_to_string(&p.settings_file).expect("read"),
            broken
        );
        assert!(
            !p.script_file().exists(),
            "a refused install installs nothing at all"
        );
        assert_eq!(status(&p).settings_state, SettingsState::Malformed);
        assert!(uninstall(&p).is_err());
    }

    #[test]
    fn a_json_array_settings_file_is_rejected() {
        let dir = TempDir::new();
        let p = paths(&dir, "[1,2,3]");
        assert!(install(&p).expect_err("refuse").to_string().contains("object"));
    }

    #[test]
    fn a_missing_settings_file_is_never_created() {
        let dir = TempDir::new();
        let p = HookPaths::with(dir.0.join("absent.json"), dir.0.join("data"));
        let err = install(&p).expect_err("must refuse");
        assert!(err.to_string().contains("does not exist"));
        assert!(!p.settings_file.exists(), "we do not own this file");
        assert_eq!(status(&p).settings_state, SettingsState::Missing);
    }

    #[test]
    fn a_non_object_hooks_key_is_refused_without_writing() {
        let dir = TempDir::new();
        let p = paths(&dir, r#"{"hooks":"nope"}"#);
        assert!(install(&p).expect_err("refuse").to_string().contains("not an object"));
        assert_eq!(parse(&p.settings_file)["hooks"], json!("nope"));
    }

    #[test]
    fn a_non_array_event_key_is_refused_and_left_in_place() {
        let dir = TempDir::new();
        let p = paths(&dir, r#"{"hooks":{"Stop":42}}"#);
        assert!(install(&p).expect_err("refuse").to_string().contains("hooks.Stop"));
        assert_eq!(parse(&p.settings_file)["hooks"]["Stop"], json!(42));
    }

    // ── status / preview ──────────────────────────────────────────────────

    #[test]
    fn status_reports_installation_and_version() {
        let dir = TempDir::new();
        let p = paths(&dir, "{}");
        assert!(!status(&p).installed);

        install(&p).expect("install");
        let after = status(&p);
        assert!(after.installed);
        assert_eq!(after.installed_version, Some(HOOK_VERSION));
        assert!(!after.needs_upgrade);
        assert!(after.script_present);
        assert_eq!(after.installed_events.len(), EVENTS.len());
    }

    #[test]
    fn an_older_entry_is_reported_as_needing_an_upgrade() {
        let dir = TempDir::new();
        let stale = json!({ "hooks": { "Stop": [
            { "hooks": [ { "type": "command", "command": "'/x/h.sh' gitbaro-hook-v0" } ] }
        ]}});
        let p = paths(&dir, &stale.to_string());
        let status = status(&p);
        assert!(status.installed);
        assert_eq!(status.installed_version, Some(0));
        assert!(status.needs_upgrade);
    }

    #[test]
    fn preview_writes_nothing_and_shows_the_exact_fragment() {
        let dir = TempDir::new();
        let p = paths(&dir, "{}");
        let preview = preview(&p);

        assert!(!p.script_file().exists(), "preview must not install");
        assert_eq!(parse(&p.settings_file), json!({}));

        let fragment: Value = serde_json::from_str(&preview.settings_fragment).expect("json");
        for event in EVENTS {
            assert!(fragment.get(*event).is_some(), "{} missing", event);
        }
        assert!(preview.script_body.contains(&preview.log_dir));
        assert!(preview.script_body.starts_with("#!/bin/sh"));
        assert!(!preview.recorded_fields.is_empty());

        install(&p).expect("install");
        assert_eq!(parse(&p.settings_file)["hooks"], fragment, "preview == reality");
    }

    #[test]
    fn the_marker_survives_a_moved_home_directory() {
        let group = json!({ "hooks": [
            { "type": "command", "command": "'/somewhere/else/h.sh' gitbaro-hook-v3 --x" }
        ]});
        assert_eq!(group_version(&group), Some(3));
        assert!(!is_ours(&json!({ "hooks": [
            { "type": "command", "command": "unrelated" }
        ]})));
    }

    // ── event log ─────────────────────────────────────────────────────────

    fn envelope(at: &str, payload: Value) -> String {
        json!({ "schema": 1, "at": at, "payload": payload }).to_string()
    }

    fn post_tool(session: &str, cwd: &str, at: &str, tool: &str, input: Value) -> String {
        envelope(
            at,
            json!({
                "session_id": session,
                "cwd": cwd,
                "transcript_path": "/t/abc.jsonl",
                "hook_event_name": "PostToolUse",
                "tool_name": tool,
                "tool_input": input,
                "tool_response": { "success": true },
            }),
        )
    }

    fn log_with(dir: &TempDir, lines: &[String]) -> PathBuf {
        let log = dir.0.join("events");
        std::fs::create_dir_all(&log).expect("mkdir");
        std::fs::write(
            log.join(format!("{}2026-07-27{}", LOG_PREFIX, LOG_SUFFIX)),
            format!("{}\n", lines.join("\n")),
        )
        .expect("write log");
        log
    }

    #[test]
    fn event_log_folds_into_a_session_summary() {
        let dir = TempDir::new();
        let log = log_with(
            &dir,
            &[
                post_tool("s1", "/repo", "2026-07-27T05:00:00Z", "Read",
                    json!({ "file_path": "/repo/a.rs" })),
                post_tool("s1", "/repo", "2026-07-27T05:01:00Z", "Edit",
                    json!({ "file_path": "/repo/a.rs" })),
                post_tool("s1", "/repo", "2026-07-27T05:02:00Z", "Bash",
                    json!({ "command": "cargo test" })),
                envelope("2026-07-27T05:03:00Z", json!({
                    "session_id": "s1", "cwd": "/repo",
                    "hook_event_name": "SessionEnd", "reason": "clear"
                })),
            ],
        );

        let summaries = summarize_hook_sessions(&log, Some(Path::new("/repo")));
        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];
        assert_eq!(s.session_id, "s1");
        assert_eq!(s.source, SessionSource::ClaudeCode);
        assert_eq!(s.file_path, "/t/abc.jsonl", "transcript stays the lookup key");
        assert_eq!(s.cwd, "/repo");
        assert_eq!(s.files_read, vec!["/repo/a.rs".to_string()]);
        assert_eq!(s.files_edited.len(), 1);
        assert!(s.files_edited[0].was_read_first);
        assert_eq!(s.bash_commands.len(), 1);
        assert_eq!(s.bash_commands[0].kind, BashCommandKind::TestRun);
        assert!(s.started_at < s.ended_at);
        assert_eq!(s.skipped_records, 0);
    }

    #[test]
    fn an_edit_without_a_prior_read_is_visible_to_v19() {
        let dir = TempDir::new();
        let log = log_with(
            &dir,
            &[post_tool("s1", "/repo", "2026-07-27T05:00:00Z", "Edit",
                json!({ "file_path": "/repo/b.rs" }))],
        );
        let s = &summarize_hook_sessions(&log, None)[0];
        assert!(!s.files_edited[0].was_read_first);
    }

    #[test]
    fn a_write_that_created_the_file_counts_as_in_context() {
        let dir = TempDir::new();
        let log = log_with(
            &dir,
            &[envelope("2026-07-27T05:00:00Z", json!({
                "session_id": "s1", "cwd": "/repo",
                "hook_event_name": "PostToolUse",
                "tool_name": "Write",
                "tool_input": { "file_path": "/repo/new.rs", "content": "x" },
                "tool_response": { "type": "create", "filePath": "/repo/new.rs" }
            }))],
        );
        let s = &summarize_hook_sessions(&log, None)[0];
        assert!(s.files_edited[0].was_read_first, "authored from nothing");
    }

    #[test]
    fn bash_mutations_are_attributed_and_flagged_via_bash() {
        let dir = TempDir::new();
        let log = log_with(
            &dir,
            &[post_tool("s1", "/repo", "2026-07-27T05:00:00Z", "Bash",
                json!({ "command": "echo x > /repo/gen.ts" }))],
        );
        let s = &summarize_hook_sessions(&log, None)[0];
        assert_eq!(s.files_edited.len(), 1);
        assert!(s.files_edited[0].via_bash);
        assert_eq!(s.bash_commands[0].kind, BashCommandKind::FileMutation);
    }

    #[test]
    fn a_failed_tool_call_is_recorded_as_an_error() {
        let dir = TempDir::new();
        let log = log_with(
            &dir,
            &[envelope("2026-07-27T05:00:00Z", json!({
                "session_id": "s1", "cwd": "/repo",
                "hook_event_name": "PostToolUse",
                "tool_name": "Bash",
                "tool_input": { "command": "cargo test" },
                "tool_response": { "success": false }
            }))],
        );
        let s = &summarize_hook_sessions(&log, None)[0];
        assert!(s.bash_commands[0].is_error);
    }

    #[test]
    fn interleaved_sessions_are_separated_and_filtered_by_repo() {
        let dir = TempDir::new();
        let log = log_with(
            &dir,
            &[
                post_tool("s1", "/repo", "2026-07-27T05:00:00Z", "Edit",
                    json!({ "file_path": "/repo/a.rs" })),
                post_tool("s2", "/other", "2026-07-27T05:00:10Z", "Edit",
                    json!({ "file_path": "/other/b.rs" })),
                post_tool("s1", "/repo/src", "2026-07-27T05:00:20Z", "Edit",
                    json!({ "file_path": "/repo/c.rs" })),
            ],
        );

        assert_eq!(summarize_hook_sessions(&log, None).len(), 2);
        let mine = summarize_hook_sessions(&log, Some(Path::new("/repo")));
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].session_id, "s1");
        assert_eq!(mine[0].files_edited.len(), 2);
    }

    #[test]
    fn a_torn_line_is_skipped_and_counted_rather_than_losing_the_session() {
        let dir = TempDir::new();
        let log = log_with(
            &dir,
            &[
                "{\"schema\":1,\"at\":\"2026-07-27T05:00:00Z\",\"payl".to_string(),
                post_tool("s1", "/repo", "2026-07-27T05:01:00Z", "Edit",
                    json!({ "file_path": "/repo/a.rs" })),
            ],
        );
        let s = &summarize_hook_sessions(&log, None)[0];
        assert_eq!(s.files_edited.len(), 1);
        assert_eq!(s.skipped_records, 1);
    }

    /// The highest-risk seam in this feature: a shell script writes the log and
    /// Rust reads it. Running the real script closes it.
    #[test]
    fn the_installed_script_writes_a_line_the_reader_understands() {
        use std::io::Write;

        let dir = TempDir::new();
        let log = dir.0.join("events");
        let script = dir.write("hook.sh", &script_body(&log));

        // Pretty-printed on purpose: Claude Code may send multi-line JSON, and
        // one hook call must still become exactly one JSONL line.
        let payload = serde_json::to_string_pretty(&json!({
            "session_id": "s-live",
            "cwd": "/repo",
            "transcript_path": "/t/live.jsonl",
            "hook_event_name": "PostToolUse",
            "tool_name": "Edit",
            "tool_input": { "file_path": "/repo/live.rs" },
            "tool_response": { "success": true }
        }))
        .expect("payload");
        assert!(payload.contains('\n'), "the fixture must exercise folding");

        let mut child = std::process::Command::new("/bin/sh")
            .arg(&script)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .expect("spawn");
        child
            .stdin
            .take()
            .expect("stdin")
            .write_all(payload.as_bytes())
            .expect("write payload");
        assert!(child.wait().expect("wait").success(), "the hook must exit 0");

        let files = log_files(&log);
        assert_eq!(files.len(), 1, "one day file");
        let body = std::fs::read_to_string(&files[0]).expect("read");
        assert_eq!(body.lines().count(), 1, "one hook call is one line");

        let summaries = summarize_hook_sessions(&log, Some(Path::new("/repo")));
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].session_id, "s-live");
        assert_eq!(summaries[0].files_edited[0].path, "/repo/live.rs");
        assert!(summaries[0].started_at > 0, "the script stamps the time");
    }

    #[test]
    fn an_empty_or_absent_log_yields_no_sessions() {
        let dir = TempDir::new();
        assert!(summarize_hook_sessions(&dir.0.join("nothing"), None).is_empty());
        let log = log_with(&dir, &[]);
        assert!(summarize_hook_sessions(&log, None).is_empty());
    }

    #[test]
    fn pruning_removes_only_files_older_than_the_retention_window() {
        let dir = TempDir::new();
        let log = dir.0.join("events");
        std::fs::create_dir_all(&log).expect("mkdir");
        let old = log.join(format!("{}2020-01-01{}", LOG_PREFIX, LOG_SUFFIX));
        let today = log.join(format!(
            "{}{}{}",
            LOG_PREFIX,
            chrono::Utc::now().format("%Y-%m-%d"),
            LOG_SUFFIX
        ));
        std::fs::write(&old, "").expect("write");
        std::fs::write(&today, "").expect("write");

        assert_eq!(prune_event_log(&log, LOG_RETENTION_DAYS), 1);
        assert!(!old.exists());
        assert!(today.exists());
    }

    #[test]
    fn clearing_the_log_leaves_unrelated_files_alone() {
        let dir = TempDir::new();
        let log = log_with(&dir, &[post_tool("s1", "/r", "2026-07-27T05:00:00Z", "Read",
            json!({ "file_path": "/r/a.rs" }))]);
        std::fs::write(log.join("README.txt"), "keep me").expect("write");

        clear_event_log(&log).expect("clear");
        assert!(summarize_hook_sessions(&log, None).is_empty());
        assert!(log.join("README.txt").exists());
    }
}
