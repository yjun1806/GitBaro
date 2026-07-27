//! Agent session log parsing (V19–V27, V30).
//!
//! Both supported formats are unofficial and reverse-engineered, and Codex
//! session files are known to reach 700 MB–2 GB. Everything here is therefore
//! built to two rules: stream, never load; and degrade to "no data" rather
//! than error (spec §7-⑥, §7-⑦).

pub mod attribution;
pub mod bash;
pub mod claude_code;
pub mod codex;
pub mod correlate;
pub mod event;
pub mod jsonl;
pub mod rules;
pub mod summary;

#[cfg(test)]
pub mod test_support;

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::verify::types::{SessionSource, SessionSummary};

use claude_code::ClaudeCodeAdapter;
use codex::CodexAdapter;

/// A session file located on disk, before it has been parsed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionRef {
    pub path: PathBuf,
    pub source: SessionSource,
    /// File mtime in epoch milliseconds; used for ordering and cache keys.
    pub modified_at: i64,
    pub size: u64,
}

/// Where to look for session logs. Overridable so tests never touch `$HOME`.
#[derive(Clone, Debug, Default)]
pub struct SessionRoots {
    /// `~/.claude/projects`
    pub claude_projects: Option<PathBuf>,
    /// `~/.codex/sessions`
    pub codex_sessions: Option<PathBuf>,
}

impl SessionRoots {
    /// Real locations under the user's home directory.
    pub fn from_home() -> Self {
        let home = dirs::home_dir();
        Self {
            claude_projects: home.as_ref().map(|h| h.join(".claude").join("projects")),
            codex_sessions: home.as_ref().map(|h| h.join(".codex").join("sessions")),
        }
    }

    /// Explicit roots, for tests and for a future settings override.
    pub fn with_roots(claude_projects: PathBuf, codex_sessions: PathBuf) -> Self {
        Self {
            claude_projects: Some(claude_projects),
            codex_sessions: Some(codex_sessions),
        }
    }
}

/// Encode a working directory into the Claude Code project directory name.
///
/// Claude Code flattens the absolute path by replacing every character that is
/// not ASCII-alphanumeric with `-`, so `/Users/yj/.claude` becomes
/// `-Users-yj--claude`. The mapping is lossy and one-way: we encode and look
/// up, never decode.
pub fn encode_project_dir(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Find session files plausibly belonging to `repo_path`, newest first.
///
/// A missing or unreadable session root is not an error — it means the agent
/// is not installed, and the feature simply has nothing to show.
pub fn discover_sessions(
    repo_path: &Path,
    roots: &SessionRoots,
    limit: Option<usize>,
) -> Vec<SessionRef> {
    let mut found = Vec::new();

    if let Some(root) = &roots.claude_projects {
        for dir in claude_project_dirs(root, repo_path) {
            collect_jsonl(&dir, SessionSource::ClaudeCode, &mut found);
        }
    }
    if let Some(root) = &roots.codex_sessions {
        // Codex partitions by YYYY/MM/DD and does not encode the cwd, so every
        // rollout is a candidate; `cwd` is confirmed after parsing.
        collect_codex(root, &mut found);
    }

    found.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    if let Some(limit) = limit {
        found.truncate(limit);
    }
    found
}

/// Every checkout that shares `repo_path`'s object database: the path itself,
/// this repository's working directory, the main working directory when
/// `repo_path` is a linked worktree, and every linked worktree.
///
/// One piece of work spreads across all of them — an agent may run in a
/// worktree while the commits land through the shared `.git`.
fn related_checkouts(repo_path: &Path) -> Vec<PathBuf> {
    let mut out = vec![repo_path.to_path_buf()];
    let mut push = |path: &Path| {
        let owned = path.to_path_buf();
        if !out.contains(&owned) {
            out.push(owned);
        }
    };

    let Ok(repo) = git2::Repository::open(repo_path) else {
        return out;
    };
    if let Some(workdir) = repo.workdir() {
        push(workdir);
    }
    // `repo.path()` is `<main>/.git` for a normal checkout and
    // `<main>/.git/worktrees/<name>` for a linked one; the main working
    // directory is the parent of the `.git` component either way.
    let git_dir_name = std::ffi::OsStr::new(".git");
    let git_path = repo.path().to_path_buf();
    if let Some(main) = git_path
        .ancestors()
        .find(|path| path.file_name() == Some(git_dir_name))
        .and_then(Path::parent)
    {
        push(main);
    }
    if let Ok(names) = repo.worktrees() {
        for name in names.iter().flatten() {
            if let Ok(worktree) = repo.find_worktree(name) {
                push(worktree.path());
            }
        }
    }
    out
}

/// Claude Code project directories that could hold sessions for `repo_path`.
///
/// The directory name encodes the agent's **cwd**, which is frequently not the
/// repository root: an agent launched inside `src-tauri/` gets a directory of
/// its own, and each linked worktree gets another. Looking only at the repo's
/// own encoding silently drops those sessions — which is exactly what happened
/// on this repository, where the work lived under three sibling directories.
fn claude_project_dirs(root: &Path, repo_path: &Path) -> Vec<PathBuf> {
    let prefixes: Vec<String> = related_checkouts(repo_path)
        .iter()
        .map(|path| encode_project_dir(path))
        .collect();

    let Ok(entries) = fs::read_dir(root) else {
        return prefixes.iter().map(|p| root.join(p)).collect();
    };

    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // An exact match is the checkout itself; a `<prefix>-` match is a cwd
        // below it. Requiring the separator keeps `-GitBaro` from swallowing
        // `-GitBaroOther`.
        let matches = prefixes
            .iter()
            .any(|prefix| name == prefix || name.starts_with(&format!("{prefix}-")));
        if matches && entry.path().is_dir() {
            dirs.push(entry.path());
        }
    }
    dirs
}

fn collect_jsonl(dir: &Path, source: SessionSource, out: &mut Vec<SessionRef>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        out.push(SessionRef {
            modified_at: modified_millis(&meta),
            size: meta.len(),
            path,
            source,
        });
    }
}

/// Walk the fixed `YYYY/MM/DD` layout without pulling in a directory-walking
/// crate — the depth is known and constant.
fn collect_codex(root: &Path, out: &mut Vec<SessionRef>) {
    let Ok(years) = fs::read_dir(root) else {
        return;
    };
    for year in years.flatten().map(|e| e.path()) {
        let Ok(months) = fs::read_dir(&year) else {
            continue;
        };
        for month in months.flatten().map(|e| e.path()) {
            let Ok(days) = fs::read_dir(&month) else {
                continue;
            };
            for day in days.flatten().map(|e| e.path()) {
                collect_jsonl(&day, SessionSource::Codex, out);
            }
        }
    }
}

fn modified_millis(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Parse one session file, choosing the adapter from its location.
///
/// `Ok(None)` means "nothing recognisable in this file". Only being unable to
/// open the file produces `Err`.
pub fn summarize_session(path: &Path, source: SessionSource) -> Result<Option<SessionSummary>, AppError> {
    let mut summary = match source {
        SessionSource::ClaudeCode => summary::summarize_with(path, &ClaudeCodeAdapter)?,
        SessionSource::Codex => summary::summarize_with(path, &CodexAdapter)?,
    };
    // The fold never sees the file, so the mtime is stamped here — correlation
    // treats it as a hard gate and must not receive a silent zero.
    if let Some(summary) = summary.as_mut() {
        summary.modified_at = fs::metadata(path)
            .map(|meta| modified_millis(&meta))
            .unwrap_or(0);
    }
    Ok(summary)
}

/// Parse a session file whose origin is unknown, inferring it from the path.
pub fn summarize_session_at(path: &Path) -> Result<Option<SessionSummary>, AppError> {
    summarize_session(path, infer_source(path))
}

/// Codex names every rollout `rollout-<ISO8601>-<uuid>.jsonl`; Claude Code
/// names the file after the session uuid.
pub fn infer_source(path: &Path) -> SessionSource {
    let is_codex = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("rollout-"))
        || path.components().any(|c| c.as_os_str() == ".codex");
    if is_codex {
        SessionSource::Codex
    } else {
        SessionSource::ClaudeCode
    }
}

/// Summarise every session belonging to `repo_path`.
///
/// Codex rollouts are filtered by their recorded `cwd` after parsing, since
/// their path carries no project identity. Files that fail to parse are
/// skipped silently — this is progressive enhancement, not an error path.
pub fn summarize_sessions_for_repo(
    repo_path: &Path,
    roots: &SessionRoots,
    cache_dir: Option<&Path>,
    limit: Option<usize>,
) -> Vec<SessionSummary> {
    let refs = discover_sessions(repo_path, roots, None);
    let repo = repo_path.to_string_lossy().to_string();
    let mut summaries = Vec::new();

    for session in refs {
        let Some(summary) = cached_summary(&session, cache_dir) else {
            continue;
        };
        if summary.source == SessionSource::Codex && !path_matches(&summary.cwd, &repo) {
            continue;
        }
        summaries.push(summary);
        if limit.is_some_and(|l| summaries.len() >= l) {
            break;
        }
    }

    tracing::debug!(
        "[verify] {} session summaries for {}",
        summaries.len(),
        repo_path.display()
    );
    summaries
}

/// A session belongs to the repo if its cwd is the repo or a directory inside
/// it (agents often run from a subdirectory).
fn path_matches(cwd: &str, repo: &str) -> bool {
    cwd == repo || cwd.starts_with(&format!("{}/", repo))
}

// ── Summary cache (contract §2.11) ────────────────────────────────────────
//
// Keyed by `(size, mtime)` so an append-only log that grew is re-parsed while
// an untouched one is not. `cache_dir` is passed in rather than derived,
// because `verify::paths` needs a `git2::Repository` and this module must stay
// usable without one.

/// Bumped whenever [`SessionSummary`] gains a field the fold must populate.
/// Without it the `#[serde(default)]` on those fields would quietly resurrect
/// stale entries with empty prompts and a zero mtime — a report that is silently
/// missing its first section is worse than a re-parse.
const CACHE_VERSION: u32 = 2;

#[derive(serde::Serialize, serde::Deserialize)]
struct CacheEntry {
    #[serde(default)]
    version: u32,
    size: u64,
    mtime: i64,
    summary: SessionSummary,
}

fn cached_summary(session: &SessionRef, cache_dir: Option<&Path>) -> Option<SessionSummary> {
    let cache_path = cache_dir.and_then(|dir| cache_file(dir, &session.path));

    if let Some(path) = &cache_path {
        if let Some(entry) = read_cache(path) {
            if entry.version == CACHE_VERSION
                && entry.size == session.size
                && entry.mtime == session.modified_at
            {
                return Some(entry.summary);
            }
        }
    }

    let summary = summarize_session(&session.path, session.source).ok().flatten()?;

    if let Some(path) = &cache_path {
        write_cache(path, &session_entry(session, &summary));
    }
    Some(summary)
}

fn session_entry(session: &SessionRef, summary: &SessionSummary) -> CacheEntry {
    CacheEntry {
        version: CACHE_VERSION,
        size: session.size,
        mtime: session.modified_at,
        summary: summary.clone(),
    }
}

/// SHA-1 of the absolute path, matching the digest convention used elsewhere
/// in the verify subsystem (contract §2.10).
fn cache_file(dir: &Path, session_path: &Path) -> Option<PathBuf> {
    let key = event::content_digest(session_path.to_string_lossy().as_bytes())?;
    Some(dir.join(format!("{}.json", key)))
}

fn read_cache(path: &Path) -> Option<CacheEntry> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Cache writes are best-effort; a failure only costs a re-parse.
fn write_cache(path: &Path, entry: &CacheEntry) {
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    match serde_json::to_string(entry) {
        Ok(json) => {
            if let Err(e) = fs::write(path, json) {
                tracing::debug!("[verify] session cache write skipped: {}", e);
            }
        }
        Err(e) => tracing::debug!("[verify] session cache encode skipped: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::{fixture, TempDir};

    #[test]
    fn encodes_cwd_to_the_claude_project_directory_name() {
        assert_eq!(
            encode_project_dir(Path::new("/Users/yj/Documents/private/GitBaro")),
            "-Users-yj-Documents-private-GitBaro"
        );
        // Dots collapse to '-' too, which is why `.claude` becomes `-claude`.
        assert_eq!(
            encode_project_dir(Path::new("/Users/yj/.claude")),
            "-Users-yj--claude"
        );
        assert_eq!(encode_project_dir(Path::new("/")), "-");
        assert_eq!(
            encode_project_dir(Path::new("/a/my_repo v2")),
            "-a-my-repo-v2"
        );
    }

    #[test]
    fn missing_roots_yield_no_sessions_instead_of_an_error() {
        let dir = TempDir::new();
        let roots = SessionRoots::with_roots(dir.path().join("nope"), dir.path().join("also-nope"));
        assert!(discover_sessions(Path::new("/repo"), &roots, None).is_empty());
    }

    #[test]
    fn discovers_claude_sessions_for_the_encoded_repo_path() {
        let dir = TempDir::new();
        let repo = Path::new("/repo/app");
        let project = dir.path().join("claude").join(encode_project_dir(repo));
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("a.jsonl"), fixture::normal_session()).unwrap();
        std::fs::write(project.join("notes.txt"), "ignored").unwrap();

        let roots = SessionRoots::with_roots(dir.path().join("claude"), dir.path().join("codex"));
        let found = discover_sessions(repo, &roots, None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].source, SessionSource::ClaudeCode);
        assert!(found[0].size > 0);
    }

    #[test]
    fn discovers_codex_rollouts_under_the_dated_layout() {
        let dir = TempDir::new();
        let day = dir.path().join("codex/2026/03/09");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(
            day.join("rollout-2026-03-09T14-25-24-abc.jsonl"),
            fixture::codex_session("/repo/app"),
        )
        .unwrap();

        let roots = SessionRoots::with_roots(dir.path().join("claude"), dir.path().join("codex"));
        let found = discover_sessions(Path::new("/repo/app"), &roots, None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].source, SessionSource::Codex);
    }

    #[test]
    fn codex_sessions_are_filtered_by_recorded_cwd() {
        let dir = TempDir::new();
        let day = dir.path().join("codex/2026/03/09");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(
            day.join("rollout-a.jsonl"),
            fixture::codex_session("/repo/app"),
        )
        .unwrap();
        std::fs::write(
            day.join("rollout-b.jsonl"),
            fixture::codex_session("/somewhere/else"),
        )
        .unwrap();

        let roots = SessionRoots::with_roots(dir.path().join("claude"), dir.path().join("codex"));
        let mine = summarize_sessions_for_repo(Path::new("/repo/app"), &roots, None, None);
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].cwd, "/repo/app");
    }

    #[test]
    fn infers_the_adapter_from_the_file_name() {
        assert_eq!(
            infer_source(Path::new("/x/rollout-2026-03-09T1-a.jsonl")),
            SessionSource::Codex
        );
        assert_eq!(
            infer_source(Path::new("/x/7fafc7a4-8da4.jsonl")),
            SessionSource::ClaudeCode
        );
    }

    #[test]
    fn cache_is_reused_until_the_file_changes() {
        let dir = TempDir::new();
        let cache = dir.path().join("cache");
        let session_path = dir.write("s.jsonl", &fixture::normal_session());
        let meta = std::fs::metadata(&session_path).unwrap();
        let session = SessionRef {
            path: session_path.clone(),
            source: SessionSource::ClaudeCode,
            modified_at: modified_millis(&meta),
            size: meta.len(),
        };

        let first = cached_summary(&session, Some(&cache)).expect("summary");
        assert!(cache_file(&cache, &session_path).unwrap().exists());

        // Same key → served from cache even though the file is now gone.
        std::fs::remove_file(&session_path).unwrap();
        let second = cached_summary(&session, Some(&cache)).expect("cached summary");
        assert_eq!(first.session_id, second.session_id);
        assert_eq!(first.files_edited.len(), second.files_edited.len());

        // A different size invalidates the entry; with the file gone, parsing
        // fails and we get nothing rather than a stale answer.
        let stale = SessionRef {
            size: session.size + 1,
            ..session
        };
        assert!(cached_summary(&stale, Some(&cache)).is_none());
    }

    #[test]
    fn works_without_a_cache_directory() {
        let dir = TempDir::new();
        let session_path = dir.write("s.jsonl", &fixture::normal_session());
        let meta = std::fs::metadata(&session_path).unwrap();
        let session = SessionRef {
            path: session_path,
            source: SessionSource::ClaudeCode,
            modified_at: modified_millis(&meta),
            size: meta.len(),
        };
        assert!(cached_summary(&session, None).is_some());
    }

    #[test]
    fn repo_membership_accepts_subdirectories_only() {
        assert!(path_matches("/repo/app", "/repo/app"));
        assert!(path_matches("/repo/app/src", "/repo/app"));
        assert!(!path_matches("/repo/app-other", "/repo/app"));
        assert!(!path_matches("/repo", "/repo/app"));
    }
}

#[cfg(test)]
mod checkout_discovery_tests {
    use super::*;

    fn touch_jsonl(dir: &Path, name: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(format!("{name}.jsonl")), "{}\n").unwrap();
    }

    /// A session's log directory is keyed on the agent's cwd, which is often a
    /// subdirectory of the repo rather than its root. Scanning only the repo's
    /// own encoding loses those — the bug that made the feature find nothing on
    /// a real repository.
    #[test]
    fn finds_sessions_logged_from_a_subdirectory_cwd() {
        let base = std::env::temp_dir().join(format!("gitbaro-disc-{}", uuid::Uuid::new_v4()));
        let repo = base.join("repo");
        fs::create_dir_all(&repo).unwrap();
        let root = base.join("projects");

        let repo_dir = root.join(encode_project_dir(&repo));
        let nested_dir = root.join(encode_project_dir(&repo.join("src-tauri")));
        touch_jsonl(&repo_dir, "a");
        touch_jsonl(&nested_dir, "b");

        let dirs = claude_project_dirs(&root, &repo);
        assert_eq!(dirs.len(), 2, "both the repo cwd and the nested cwd must match");

        fs::remove_dir_all(&base).ok();
    }

    /// `-GitBaro` must not swallow `-GitBaroOther`: only an exact match or a
    /// match followed by the separator counts.
    #[test]
    fn does_not_match_a_sibling_repository_with_a_longer_name() {
        let base = std::env::temp_dir().join(format!("gitbaro-disc-{}", uuid::Uuid::new_v4()));
        let repo = base.join("app");
        fs::create_dir_all(&repo).unwrap();
        let root = base.join("projects");

        touch_jsonl(&root.join(encode_project_dir(&repo)), "a");
        touch_jsonl(&root.join(format!("{}Other", encode_project_dir(&repo))), "b");

        let dirs = claude_project_dirs(&root, &repo);
        assert_eq!(dirs.len(), 1, "a longer sibling name is a different repository");

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn a_plain_directory_is_its_own_only_checkout() {
        let base = std::env::temp_dir().join(format!("gitbaro-disc-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        assert_eq!(related_checkouts(&base), vec![base.clone()]);
        fs::remove_dir_all(&base).ok();
    }
}
