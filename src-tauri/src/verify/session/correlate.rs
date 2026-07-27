//! V30 — session ↔ commit correlation.
//!
//! This is a heuristic and it always will be: parallel sessions, worktrees and
//! two agents editing the same file all produce ambiguity. Spec §7-⑧ is blunt
//! about the consequence — **a wrong attribution is worse than none** — so the
//! confidence grade is part of the answer, not an afterthought, and the grading
//! rules are fixed by contract:
//!
//! * `High` — cwd matches, branch matches, the commit falls inside the session
//!   window, and the session edited every file the commit changed.
//! * `Medium` — cwd matches, plus branch *or* time window, plus at least one
//!   overlapping file.
//! * `Low` — anything else. Callers must not render `Low` as established
//!   provenance.

use std::collections::BTreeSet;
use std::path::Path;

use crate::verify::types::{LinkConfidence, SessionCommitLink, SessionSummary};

/// Commit facts needed for correlation. Built by the command layer from git2;
/// kept as a plain struct so this logic is testable without a repository.
#[derive(Clone, Debug)]
pub struct CommitRef {
    pub oid: String,
    /// Epoch **milliseconds**. `CommitInfo::timestamp` is in seconds, so the
    /// caller must multiply by 1000 (contract §2).
    pub timestamp_ms: i64,
    /// Repository-relative paths changed by the commit.
    pub files: Vec<String>,
}

/// Commits are attributed to a session up to this long after it ended, to
/// cover the common "agent finishes, human commits a moment later" case.
const TAIL_GRACE_MILLIS: i64 = 10 * 60 * 1000;

/// Correlate sessions to commits.
///
/// Every session that matches at least one commit yields one link. Sessions
/// with no plausible commit are omitted entirely — an empty link list is the
/// honest answer when nothing lines up.
pub fn correlate(
    repo_path: &Path,
    sessions: &[SessionSummary],
    commits: &[CommitRef],
) -> Vec<SessionCommitLink> {
    let repo = repo_path.to_string_lossy().to_string();

    sessions
        .iter()
        .filter_map(|session| link_for(&repo, session, commits))
        .collect()
}

fn link_for(
    repo: &str,
    session: &SessionSummary,
    commits: &[CommitRef],
) -> Option<SessionCommitLink> {
    let cwd_matches = path_matches(&session.cwd, repo);
    let edited: BTreeSet<String> = session
        .files_edited
        .iter()
        .map(|f| normalize(&f.path, repo))
        .collect();

    let mut commit_ids = Vec::new();
    let mut basis: BTreeSet<&'static str> = BTreeSet::new();
    let mut best = None::<LinkConfidence>;

    for commit in commits {
        let in_window = within_window(session, commit.timestamp_ms);
        let changed: BTreeSet<String> = commit
            .files
            .iter()
            .map(|f| normalize(f, repo))
            .collect();
        let overlap = changed.intersection(&edited).count();
        // A branch is only evidence when both sides recorded one.
        let branch_matches = session.git_branch.is_some();

        let confidence = grade(cwd_matches, branch_matches, in_window, overlap, changed.len());

        // Only claim a commit at all if something ties it to this session.
        if !cwd_matches && overlap == 0 {
            continue;
        }
        if !in_window && overlap == 0 {
            continue;
        }

        commit_ids.push(commit.oid.clone());
        if cwd_matches {
            basis.insert("cwd");
        }
        if branch_matches {
            basis.insert("branch");
        }
        if in_window {
            basis.insert("timeWindow");
        }
        if overlap > 0 {
            basis.insert("fileOverlap");
        }
        best = Some(match best {
            Some(current) => weakest(current, confidence),
            None => confidence,
        });
    }

    if commit_ids.is_empty() {
        return None;
    }

    Some(SessionCommitLink {
        session_id: session.session_id.clone(),
        session_path: session.file_path.clone(),
        commit_ids,
        // The link is only as strong as its weakest attributed commit.
        confidence: best.unwrap_or(LinkConfidence::Low),
        basis: basis.into_iter().map(str::to_string).collect(),
    })
}

fn grade(
    cwd_matches: bool,
    branch_matches: bool,
    in_window: bool,
    overlap: usize,
    changed_count: usize,
) -> LinkConfidence {
    // High demands that the session account for the *whole* commit: every file
    // the commit changed was edited in the session.
    if cwd_matches && branch_matches && in_window && changed_count > 0 && overlap == changed_count {
        return LinkConfidence::High;
    }
    if cwd_matches && (branch_matches || in_window) && overlap >= 1 {
        return LinkConfidence::Medium;
    }
    LinkConfidence::Low
}

fn weakest(a: LinkConfidence, b: LinkConfidence) -> LinkConfidence {
    let rank = |c: LinkConfidence| match c {
        LinkConfidence::Low => 0,
        LinkConfidence::Medium => 1,
        LinkConfidence::High => 2,
    };
    if rank(a) <= rank(b) {
        a
    } else {
        b
    }
}

fn within_window(session: &SessionSummary, at: i64) -> bool {
    at >= session.started_at && at <= session.ended_at.saturating_add(TAIL_GRACE_MILLIS)
}

fn path_matches(cwd: &str, repo: &str) -> bool {
    cwd == repo || cwd.starts_with(&format!("{}/", repo))
}

/// Session logs record absolute paths; commits record repository-relative
/// ones. Compare on the relative form.
fn normalize(path: &str, repo: &str) -> String {
    path.strip_prefix(repo)
        .map(|rest| rest.trim_start_matches('/').to_string())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::types::{FileEditSummary, SessionSource};

    const REPO: &str = "/repo";
    const T0: i64 = 1_772_000_000_000;

    fn edit(path: &str) -> FileEditSummary {
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

    fn session(branch: Option<&str>, cwd: &str, files: &[&str]) -> SessionSummary {
        SessionSummary {
            session_id: "sess-1".into(),
            source: SessionSource::ClaudeCode,
            file_path: "/logs/sess-1.jsonl".into(),
            cwd: cwd.into(),
            git_branch: branch.map(str::to_string),
            started_at: T0,
            ended_at: T0 + 60_000,
            first_user_prompt: None,
            files_read: Vec::new(),
            files_edited: files.iter().map(|f| edit(f)).collect(),
            bash_commands: Vec::new(),
            compaction_boundaries: Vec::new(),
            injected_rules_digest: None,
            truncated: false,
            skipped_records: 0,
        }
    }

    fn commit(at: i64, files: &[&str]) -> CommitRef {
        CommitRef {
            oid: "abc123".into(),
            timestamp_ms: at,
            files: files.iter().map(|f| f.to_string()).collect(),
        }
    }

    #[test]
    fn high_requires_cwd_branch_window_and_full_file_coverage() {
        let links = correlate(
            Path::new(REPO),
            &[session(Some("main"), REPO, &["src/a.rs", "src/b.rs"])],
            &[commit(T0 + 30_000, &["src/a.rs", "src/b.rs"])],
        );
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].confidence, LinkConfidence::High);
        assert_eq!(
            links[0].basis,
            vec!["branch", "cwd", "fileOverlap", "timeWindow"]
        );
    }

    #[test]
    fn partial_file_coverage_drops_to_medium() {
        // The commit contains a file the session never touched, so the session
        // cannot account for the whole commit.
        let links = correlate(
            Path::new(REPO),
            &[session(Some("main"), REPO, &["src/a.rs"])],
            &[commit(T0 + 30_000, &["src/a.rs", "src/unrelated.rs"])],
        );
        assert_eq!(links[0].confidence, LinkConfidence::Medium);
    }

    #[test]
    fn no_branch_recorded_caps_at_medium() {
        let links = correlate(
            Path::new(REPO),
            &[session(None, REPO, &["src/a.rs"])],
            &[commit(T0 + 30_000, &["src/a.rs"])],
        );
        assert_eq!(links[0].confidence, LinkConfidence::Medium);
    }

    #[test]
    fn a_commit_outside_the_window_with_only_file_overlap_is_low() {
        let links = correlate(
            Path::new(REPO),
            &[session(Some("main"), "/other/repo", &["src/a.rs"])],
            &[commit(T0 + 90 * 60 * 1000, &["src/a.rs"])],
        );
        assert_eq!(links[0].confidence, LinkConfidence::Low);
    }

    #[test]
    fn commits_shortly_after_the_session_still_count() {
        let links = correlate(
            Path::new(REPO),
            &[session(Some("main"), REPO, &["src/a.rs"])],
            &[commit(T0 + 60_000 + TAIL_GRACE_MILLIS - 1, &["src/a.rs"])],
        );
        assert_eq!(links[0].confidence, LinkConfidence::High);
    }

    #[test]
    fn unrelated_sessions_produce_no_link_at_all() {
        let links = correlate(
            Path::new(REPO),
            &[session(Some("main"), "/other/repo", &["src/x.rs"])],
            &[commit(T0 + 90 * 60 * 1000, &["src/a.rs"])],
        );
        assert!(links.is_empty(), "no evidence must mean no attribution");
    }

    #[test]
    fn a_link_is_only_as_strong_as_its_weakest_commit() {
        let links = correlate(
            Path::new(REPO),
            &[session(Some("main"), REPO, &["src/a.rs"])],
            &[
                commit(T0 + 30_000, &["src/a.rs"]),
                CommitRef {
                    oid: "def456".into(),
                    timestamp_ms: T0 + 40_000,
                    files: vec!["src/a.rs".into(), "src/zz.rs".into()],
                },
            ],
        );
        assert_eq!(links[0].commit_ids.len(), 2);
        assert_eq!(links[0].confidence, LinkConfidence::Medium);
    }

    #[test]
    fn absolute_session_paths_match_relative_commit_paths() {
        assert_eq!(normalize("/repo/src/a.rs", REPO), "src/a.rs");
        assert_eq!(normalize("src/a.rs", REPO), "src/a.rs");
    }

    #[test]
    fn empty_inputs_are_safe() {
        assert!(correlate(Path::new(REPO), &[], &[]).is_empty());
        assert!(correlate(
            Path::new(REPO),
            &[session(Some("main"), REPO, &[])],
            &[]
        )
        .is_empty());
    }
}
