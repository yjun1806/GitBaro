//! Session-log commands (contract §3.3).
//!
//! Progressive enhancement is the rule here (§7-⑥): if no agent CLI has ever
//! run in this repository, or a log format changed under us, these commands
//! return empty results — never an error toast. The one exception is a command
//! handed a *specific* session file it cannot open, which is a real failure the
//! caller asked for by name.

use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::AppError;
use crate::git::commit::validate_commit_oid;
use crate::git::engine::DiffOutput;
use crate::verify::config::load_rule_config;
use crate::verify::paths::shared_state_dir;
use crate::verify::session::attribution::{commit_facts, AttributionContext};
use crate::verify::session::{self, SessionRoots};
use crate::verify::types::{SessionCommitLink, SessionSummary, VerificationReport};

use super::verify::commit_diff;

/// How far back correlation looks for candidate commits.
const CORRELATION_WALK: usize = 200;

const SESSION_CACHE_DIR: &str = "session-cache";

#[tauri::command]
pub async fn list_sessions_for_repo(
    repo_path: String,
    limit: Option<usize>,
) -> Result<Vec<SessionSummary>, AppError> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let cache = cache_dir(&path);
        session::summarize_sessions_for_repo(
            &path,
            &SessionRoots::from_home(),
            cache.as_deref(),
            limit,
        )
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))
}

/// `Ok(None)` when the file holds nothing recognisable. `Err` only when the
/// named file cannot be opened at all.
#[tauri::command]
pub async fn get_session_summary(session_path: String) -> Result<Option<SessionSummary>, AppError> {
    tokio::task::spawn_blocking(move || session::summarize_session_at(Path::new(&session_path)))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V19~V27 findings for one session.
#[tauri::command]
pub async fn verify_session(
    repo_path: String,
    session_path: String,
) -> Result<VerificationReport, AppError> {
    tokio::task::spawn_blocking(move || {
        tracing::debug!("[verify] session scan for {}", repo_path);
        let config = load_rule_config();
        match session::summarize_session_at(Path::new(&session_path))? {
            Some(summary) => Ok(session::rules::run_session_rules(&summary, &config)),
            // An unreadable session is not a clean session — an empty report
            // still carries the full `unchecked` accounting.
            None => Ok(VerificationReport::empty()),
        }
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V30 — which sessions plausibly produced these commits.
///
/// `Low` confidence links are returned, but the contract forbids the frontend
/// from rendering them as settled provenance.
#[tauri::command]
pub async fn correlate_sessions_to_commits(
    repo_path: String,
    oids: Vec<String>,
) -> Result<Vec<SessionCommitLink>, AppError> {
    for oid in &oids {
        validate_commit_oid(oid)?;
    }

    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let repo = Repository::open(&path)?;
        let commits = commit_facts(&repo, &oids)?;
        let cache = cache_dir(&path);
        let sessions = session::summarize_sessions_for_repo(
            &path,
            &SessionRoots::from_home(),
            cache.as_deref(),
            None,
        );
        Ok(session::correlate::correlate(
            &AttributionContext::from_repo(&repo, &path),
            &sessions,
            &commits,
        ))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V30 — everything a session changed, as one diff.
///
/// The baseline is the first parent of the earliest commit correlated with the
/// session. Claude Code's `file-history-snapshot` baseline is not implemented,
/// so a session with no correlated commit yields an empty diff rather than a
/// guess: an inaccurate attribution is worse than none (§7-⑧).
#[tauri::command]
pub async fn get_session_cumulative_diff(
    repo_path: String,
    session_path: String,
) -> Result<DiffOutput, AppError> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        let repo = Repository::open(&path)?;

        let Some(summary) = session::summarize_session_at(Path::new(&session_path))? else {
            return Ok(DiffOutput { files: Vec::new() });
        };

        let oids = recent_commit_ids(&repo, CORRELATION_WALK)?;
        let commits = commit_facts(&repo, &oids)?;
        let links = session::correlate::correlate(
            &AttributionContext::from_repo(&repo, &path),
            std::slice::from_ref(&summary),
            &commits,
        );

        // `commit_ids` comes back newest-first, so the oldest is the baseline.
        let Some(oldest) = links.first().and_then(|link| link.commit_ids.last()) else {
            return Ok(DiffOutput { files: Vec::new() });
        };

        let commit = repo.revparse_single(oldest)?.peel_to_commit()?;
        cumulative_diff(&repo, &commit)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Session summaries are cached in the worktree-shared state directory, so a
/// second worktree does not re-parse megabytes of log.
fn cache_dir(repo_path: &Path) -> Option<PathBuf> {
    let repo = Repository::open(repo_path).ok()?;
    match shared_state_dir(&repo) {
        Ok(dir) => Some(dir.join(SESSION_CACHE_DIR)),
        Err(e) => {
            tracing::warn!("[verify] no session cache directory: {}", e);
            None
        }
    }
}

fn recent_commit_ids(repo: &Repository, limit: usize) -> Result<Vec<String>, AppError> {
    if repo.head().is_err() {
        return Ok(Vec::new());
    }

    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    Ok(walk
        .take(limit)
        .filter_map(|id| id.ok())
        .map(|id| id.to_string())
        .collect())
}

/// From `baseline`'s first parent up to the working tree.
fn cumulative_diff(repo: &Repository, baseline: &git2::Commit<'_>) -> Result<DiffOutput, AppError> {
    if baseline.parent_count() == 0 {
        // A root commit has no "before"; the whole session is the commit itself.
        return commit_diff(repo, baseline);
    }

    let parent_tree = baseline.parent(0)?.tree()?;
    let diff = repo.diff_tree_to_workdir_with_index(Some(&parent_tree), None)?;
    crate::git::diff::convert_diff(&diff)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::hygiene::test_support::TempRepo;
    use crate::verify::session::attribution::{head_branch_name, reflog_first_seen};
    use crate::verify::session::correlate::correlate;
    use crate::verify::session::test_support::summary_fixture::named_session;
    use crate::verify::types::{now_millis, FileEditSummary, LinkConfidence};

    /// The branch `git init` actually created here — `main` or `master`
    /// depending on the machine's git config.
    fn head_branch(repo: &TempRepo) -> String {
        head_branch_name(&repo.repo).expect("head is on a branch")
    }

    /// A session that ran in `repo`, editing `files`, ending now. Real commits
    /// are stamped with the current clock, so the window has to be too.
    fn session_in(repo: &TempRepo, branch: Option<&str>, files: &[&str]) -> SessionSummary {
        let now = now_millis();
        let root = repo.dir.to_string_lossy().to_string();
        let mut summary = named_session("sess", branch, &root, &[]);
        summary.started_at = now - 60_000;
        summary.ended_at = now;
        summary.modified_at = now;
        summary.files_edited = files
            .iter()
            .map(|path| FileEditSummary {
                path: format!("{}/{}", root, path),
                edit_count: 1,
                first_edit_at: now - 30_000,
                last_edit_at: now - 10_000,
                was_read_first: true,
                after_compaction: false,
                by_subagent: false,
                via_bash: false,
            })
            .collect();
        summary
    }

    fn link(repo: &TempRepo, summary: SessionSummary) -> Option<SessionCommitLink> {
        let oids = recent_commit_ids(&repo.repo, CORRELATION_WALK).expect("walk");
        let commits = commit_facts(&repo.repo, &oids).expect("commit facts");
        correlate(
            &AttributionContext::from_repo(&repo.repo, &repo.dir),
            &[summary],
            &commits,
        )
        .into_iter()
        .next()
    }

    #[test]
    fn a_session_that_authored_the_whole_commit_is_stated_as_fact() {
        let repo = TempRepo::new();
        repo.commit("base", &[("src/a.rs", "one")]);
        repo.commit("work", &[("src/a.rs", "two")]);

        let branch = head_branch(&repo);
        let link = link(&repo, session_in(&repo, Some(&branch), &["src/a.rs"])).expect("link");
        assert_eq!(link.confidence, LinkConfidence::High);
        assert!(link.basis.contains(&"branch".to_string()));
        assert!(link.basis.contains(&"author".to_string()));
        assert!(link.basis.contains(&"reflog".to_string()));
    }

    #[test]
    fn a_session_on_another_branch_gets_no_link_at_all() {
        // The regression test for the worst defect: the old code never compared
        // the branch, it only checked that the session had recorded one.
        let repo = TempRepo::new();
        repo.commit("base", &[("src/a.rs", "one")]);
        repo.commit("work", &[("src/a.rs", "two")]);

        assert!(
            link(&repo, session_in(&repo, Some("feat/elsewhere"), &["src/a.rs"])).is_none(),
            "unknown is a correct answer; a guess is not"
        );
    }

    #[test]
    fn a_merge_commit_is_never_attributed_even_with_perfect_overlap() {
        let repo = TempRepo::new();
        let base = repo.commit("base", &[("src/a.rs", "one")]);
        let side = repo.commit_on(base, "side", &[("src/b.rs", "two")]);
        let main = repo.commit("main", &[("src/a.rs", "three")]);
        repo.merge_commit(main, side, "merge");

        let branch = head_branch(&repo);
        let link = link(
            &repo,
            session_in(&repo, Some(&branch), &["src/a.rs", "src/b.rs"]),
        )
        .expect("link");
        let merge_oid = repo
            .repo
            .head()
            .expect("head")
            .target()
            .expect("head oid")
            .to_string();
        assert!(!link.commit_ids.contains(&merge_oid));
    }

    #[test]
    fn a_commit_on_no_local_branch_carries_no_branch_claim() {
        let repo = TempRepo::new();
        let base = repo.commit("base", &[("src/a.rs", "one")]);
        let side = repo.commit_on(base, "side", &[("src/side.rs", "two")]);

        let facts = commit_facts(&repo.repo, &[side.to_string()]).expect("facts");
        assert!(
            facts[0].branches.is_empty(),
            "unreachable ⇒ unknown, not mismatch"
        );

        let head = repo.repo.head().expect("head").target().expect("oid");
        let facts = commit_facts(&repo.repo, &[head.to_string()]).expect("facts");
        assert!(facts[0].branches.contains(&head_branch(&repo)));
    }

    /// The regression this whole field exists for: a commit authored on `main`
    /// stays attributable after the reader checks out a different branch. The
    /// old label was HEAD's shorthand, so every past session mismatched the
    /// moment the branch changed and the report lost all of its commits.
    #[test]
    fn switching_branches_does_not_erase_a_commits_branch() {
        let repo = TempRepo::new();
        let oid = repo.commit("work", &[("src/a.rs", "one")]);
        let main = head_branch(&repo);

        let commit = repo.repo.find_commit(oid).expect("commit");
        repo.repo.branch("feat/later", &commit, false).expect("branch");
        repo.repo
            .set_head("refs/heads/feat/later")
            .expect("checkout");

        let facts = commit_facts(&repo.repo, &[oid.to_string()]).expect("facts");
        assert!(
            facts[0].branches.contains(&main),
            "a commit on {main} is still on {main} after switching away: {:?}",
            facts[0].branches
        );
        assert!(facts[0].branches.contains("feat/later"));
    }

    #[test]
    fn the_reflog_dates_when_a_commit_actually_entered_head() {
        let repo = TempRepo::new();
        repo.commit("base", &[("src/a.rs", "one")]);
        let head = repo.repo.head().expect("head").target().expect("oid");

        let seen = reflog_first_seen(&repo.repo);
        assert!(
            seen.contains_key(&head.to_string()),
            "a commit written through HEAD must be dated by the reflog"
        );
    }

    /// Rewrite HEAD to also contain `path`, the way `git commit --amend` does.
    fn amend_head_with(repo: &TempRepo, path: &str, content: &str) -> git2::Oid {
        let head = repo.repo.head().expect("head").peel_to_commit().expect("commit");
        let tree = head.tree().expect("tree");
        let mut builder = repo.repo.treebuilder(Some(&tree)).expect("treebuilder");
        let blob = repo.repo.blob(content.as_bytes()).expect("blob");
        builder.insert(path, blob, 0o100644).expect("insert");
        let amended = builder.write().expect("write tree");
        let amended = repo.repo.find_tree(amended).expect("find tree");
        head.amend(Some("HEAD"), None, None, None, None, Some(&amended))
            .expect("amend")
    }

    #[test]
    fn a_commit_amended_after_the_session_stops_being_a_statement_of_fact() {
        // The commit that exists now is not the one the session produced: it
        // carries a file the session never touched.
        let repo = TempRepo::new();
        repo.commit("base", &[("src/seed.rs", "seed")]);
        repo.commit("work", &[("src/a.rs", "one")]);
        let branch = head_branch(&repo);
        amend_head_with(&repo, "generated.rs", "added by hand");

        let link = link(&repo, session_in(&repo, Some(&branch), &["src/a.rs"])).expect("link");
        assert_eq!(
            link.confidence,
            LinkConfidence::Medium,
            "the commit that exists now is not the one the session produced"
        );
        assert_eq!(link.commits.len(), 1, "the base commit shares no files");
        assert_eq!(
            link.commits[0].unattributed_files,
            vec!["generated.rs".to_string()],
            "the reason for the downgrade must be visible"
        );
        assert!(link.commits[0].commit_coverage < 1.0);
    }

    #[test]
    fn a_repository_with_no_sessions_yields_no_links() {
        let repo = TempRepo::new();
        repo.commit("base", &[("src/a.rs", "one")]);
        let oids = recent_commit_ids(&repo.repo, CORRELATION_WALK).expect("walk");
        let commits = commit_facts(&repo.repo, &oids).expect("facts");
        assert!(
            correlate(
                &AttributionContext::from_repo(&repo.repo, &repo.dir),
                &[],
                &commits
            )
            .is_empty()
        );
    }

    #[test]
    fn a_session_whose_files_were_never_committed_yields_no_link() {
        let repo = TempRepo::new();
        repo.commit("base", &[("src/a.rs", "one")]);
        let branch = head_branch(&repo);
        assert!(link(&repo, session_in(&repo, Some(&branch), &["src/never.rs"])).is_none());
    }
}
