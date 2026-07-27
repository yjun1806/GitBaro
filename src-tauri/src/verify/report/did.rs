//! § What was done — commits, files, and how hard each file fought back.
//!
//! Two halves with very different footing, deliberately kept apart:
//!
//! * **File edits are facts.** They are written in the session log. They are
//!   filled in whether or not any commit could be tied to the session, which is
//!   why this section is never wholly empty.
//! * **Commits are an inference.** They come from `session/attribution.rs`, so
//!   they carry a per-commit confidence, an evidence basis, and the candidates
//!   that were turned down. A `Low` grade is treated as no grade at all: a wrong
//!   attribution is worse than none (§7-⑧).
//!
//! Nothing here re-grades anything. Correlation decides *which* commits; this
//! module decides how to say it.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use git2::{Commit, DiffOptions, Repository};

use crate::error::AppError;
use crate::verify::context::model::is_test_path;
use crate::verify::session::attribution::{self, AttributionContext, SessionFacts};
use crate::verify::types::{LinkConfidence, SessionCommitLink, SessionSummary};

use super::model::{
    CommitAttribution, DidSection, Provenance, ReportCommit, TouchedFile, Unavailable,
    UnavailableReason,
};
use super::MAX_REPORT_FILES;

/// One file inside a commit, with the numbers the report actually prints.
#[derive(Clone, Debug)]
pub struct ChangedFile {
    /// The path after the change; for a deletion, the path that was removed.
    pub path: String,
    /// Set only for a rename, and only to the *previous* path.
    pub renamed_from: Option<String>,
    pub added: u32,
    pub removed: u32,
}

/// The presentation-side view of a commit: the summary line, the author and the
/// line counts. Correlation has its own `CommitFacts` carrying the *evidence*
/// signals (branch, reflog, author email); the two are kept apart so grading
/// never depends on anything that only exists for display.
#[derive(Clone, Debug)]
pub struct CommitSnapshot {
    pub oid: String,
    pub summary: String,
    pub author_name: String,
    pub committed_at: i64,
    pub parent_count: usize,
    pub insertions: usize,
    pub deletions: usize,
    pub files: Vec<ChangedFile>,
}

/// Walk `HEAD` and snapshot the most recent `limit` commits.
///
/// An unborn HEAD is an empty list, not an error — a fresh repository has
/// nothing to attribute and that is a normal state.
pub fn collect_commit_snapshots(
    repo: &Repository,
    limit: usize,
) -> Result<Vec<CommitSnapshot>, AppError> {
    if repo.head().is_err() {
        return Ok(Vec::new());
    }
    let mut walk = repo.revwalk()?;
    walk.push_head()?;

    let mut snapshots = Vec::new();
    for oid in walk.take(limit).filter_map(Result::ok) {
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        snapshots.push(snapshot_of(repo, &commit)?);
    }
    Ok(snapshots)
}

pub fn snapshot_of(repo: &Repository, commit: &Commit<'_>) -> Result<CommitSnapshot, AppError> {
    let mut snapshot = CommitSnapshot {
        oid: commit.id().to_string(),
        summary: commit.summary().unwrap_or_default().to_string(),
        author_name: commit.author().name().unwrap_or_default().to_string(),
        committed_at: commit.time().seconds() * 1000,
        parent_count: commit.parent_count(),
        insertions: 0,
        deletions: 0,
        files: Vec::new(),
    };

    // A merge's file list is integration, not authorship, so it stays empty —
    // matching `hygiene::commit_changed_paths`, which correlation reads.
    if commit.parent_count() > 1 {
        return Ok(snapshot);
    }

    let new_tree = commit.tree()?;
    let old_tree = match commit.parent(0) {
        Ok(parent) => Some(parent.tree()?),
        Err(_) => None,
    };
    let mut options = DiffOptions::new();
    let mut diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut options))?;
    // Renames matter downstream: an in-scope file that moved must not read as a
    // deletion in one place plus drift in another.
    let _ = diff.find_similar(None);

    let mut per_path: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    diff.foreach(
        &mut |_delta, _| true,
        None,
        None,
        Some(&mut |delta, _hunk, line| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .and_then(|p| p.to_str())
                .map(str::to_string);
            if let Some(path) = path {
                let counts = per_path.entry(path).or_insert((0, 0));
                match line.origin() {
                    '+' => counts.0 += 1,
                    '-' => counts.1 += 1,
                    _ => {}
                }
            }
            true
        }),
    )?;

    for delta in diff.deltas() {
        let new_path = delta.new_file().path().and_then(|p| p.to_str());
        let old_path = delta.old_file().path().and_then(|p| p.to_str());
        let Some(path) = new_path.or(old_path) else {
            continue;
        };
        let (added, removed) = per_path.get(path).copied().unwrap_or((0, 0));
        snapshot.insertions += added as usize;
        snapshot.deletions += removed as usize;
        snapshot.files.push(ChangedFile {
            path: path.to_string(),
            renamed_from: old_path
                .filter(|old| new_path.is_some() && Some(*old) != new_path)
                .map(str::to_string),
            added,
            removed,
        });
    }
    Ok(snapshot)
}

/// The session's edited paths, repository-relative.
///
/// Delegated to `SessionFacts` so the report and correlation agree on what
/// counts as the same file — including the sibling-worktree case, where the log
/// records paths under *its* checkout rather than the one being viewed.
pub fn edited_paths(ctx: &AttributionContext, summary: &SessionSummary) -> BTreeSet<String> {
    SessionFacts::new(ctx, summary).edited
}

/// Repository-relative form of one logged path, using the same two roots
/// `SessionFacts` does.
pub fn relative_path(ctx: &AttributionContext, summary: &SessionSummary, path: &str) -> String {
    let repo_root = ctx.repo_path.to_string_lossy().to_string();
    let relative = attribution::normalize(path, &repo_root);
    if relative != path {
        return relative;
    }
    match session_root(Path::new(&summary.cwd)) {
        Some(root) => attribution::normalize(path, &root.to_string_lossy()),
        None => relative,
    }
}

/// Walk up from the session's cwd to the checkout that contains it.
fn session_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);
    while let Some(dir) = current {
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

/// Turn a correlation link into the report's attribution.
///
/// `Low` is dropped entirely: the contract forbids rendering it, and a grade the
/// UI may not state is indistinguishable from no grade.
pub fn attribution_from(link: Option<&SessionCommitLink>) -> Option<CommitAttribution> {
    let link = link?;
    if link.confidence == LinkConfidence::Low || link.commit_ids.is_empty() {
        return None;
    }
    Some(CommitAttribution {
        confidence: link.confidence,
        basis: link.basis.clone(),
        rejected: link.rejected.clone(),
        ambiguous_with: link.ambiguous_with,
    })
}

/// Build the section.
pub fn build(
    ctx: &AttributionContext,
    summary: &SessionSummary,
    snapshots: &[CommitSnapshot],
    link: Option<&SessionCommitLink>,
) -> DidSection {
    let edited = edited_paths(ctx, summary);
    let attribution = attribution_from(link);

    // Per-commit grades come from correlation's own verdicts, never from a
    // single link-wide grade smeared over every commit.
    let details = match (&attribution, link) {
        (Some(_), Some(link)) => link.commits.as_slice(),
        _ => &[],
    };

    let mut report_commits = Vec::new();
    let mut lines: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    let mut attributed_oids: BTreeSet<String> = BTreeSet::new();

    for detail in details {
        let Some(snapshot) = snapshots.iter().find(|s| s.oid == detail.commit_id) else {
            // Outside the walk window; correlation saw it, we cannot describe it.
            continue;
        };
        attributed_oids.insert(snapshot.oid.clone());
        for file in &snapshot.files {
            let entry = lines.entry(file.path.clone()).or_insert((0, 0));
            entry.0 += file.added;
            entry.1 += file.removed;
        }
        report_commits.push(ReportCommit {
            commit_id: snapshot.oid.clone(),
            summary: snapshot.summary.clone(),
            author_name: snapshot.author_name.clone(),
            committed_at: snapshot.committed_at,
            files_changed: snapshot.files.len(),
            insertions: snapshot.insertions,
            deletions: snapshot.deletions,
            unattributed_files: detail.unattributed_files.clone(),
            confidence: detail.confidence,
            provenance: Provenance::Git,
        });
    }
    report_commits.sort_by(|a, b| b.committed_at.cmp(&a.committed_at));

    let committed: BTreeSet<&String> = lines.keys().collect();

    let mut files: Vec<TouchedFile> = summary
        .files_edited
        .iter()
        .map(|file| {
            let path = relative_path(ctx, summary, &file.path);
            // Line counts only exist where a commit does, so they stay `None`
            // without attribution rather than being invented from the worktree.
            let counts = lines.get(&path).copied();
            TouchedFile {
                edit_count: file.edit_count,
                was_read_first: file.was_read_first,
                by_subagent: file.by_subagent,
                via_bash: file.via_bash,
                after_compaction: file.after_compaction,
                first_edit_at: file.first_edit_at,
                last_edit_at: file.last_edit_at,
                added_lines: counts.map(|c| c.0),
                removed_lines: counts.map(|c| c.1),
                in_commit: committed.contains(&path),
                is_test: is_test_path(&path),
                provenance: Provenance::SessionLog,
                path,
            }
        })
        .collect();
    files.sort_by(|a, b| {
        b.edit_count
            .cmp(&a.edit_count)
            .then_with(|| a.path.cmp(&b.path))
    });
    files.truncate(MAX_REPORT_FILES);

    let uncommitted_paths: Vec<String> = if attributed_oids.is_empty() {
        Vec::new()
    } else {
        edited
            .iter()
            .filter(|path| !committed.contains(path))
            .cloned()
            .collect()
    };

    DidSection {
        unavailable: attribution.is_none().then(|| {
            Unavailable::with_detail(
                UnavailableReason::NoCommitAttribution,
                "no commit could be tied to this session with enough evidence to name it",
            )
        }),
        commits: report_commits,
        attribution,
        files,
        files_edited_count: summary.files_edited.len(),
        files_read_count: summary.files_read.len(),
        uncommitted_paths,
    }
}

/// The commits this section actually named, in the caller's order.
pub fn attributed<'a>(
    snapshots: &'a [CommitSnapshot],
    section: &DidSection,
) -> Vec<&'a CommitSnapshot> {
    let named: BTreeSet<&str> = section
        .commits
        .iter()
        .map(|commit| commit.commit_id.as_str())
        .collect();
    snapshots
        .iter()
        .filter(|snapshot| named.contains(snapshot.oid.as_str()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::hygiene::test_support::TempRepo;
    use crate::verify::report::testutil::{link_for, session_with};
    use crate::verify::types::CommitLinkDetail;

    fn ctx(root: &str) -> AttributionContext {
        AttributionContext::for_repo(root)
    }

    fn detail(commit_id: &str, unattributed: &[&str]) -> CommitLinkDetail {
        CommitLinkDetail {
            commit_id: commit_id.to_string(),
            confidence: LinkConfidence::High,
            basis: vec!["cwd".into()],
            commit_coverage: 1.0,
            session_coverage: 1.0,
            unattributed_files: unattributed.iter().map(|p| p.to_string()).collect(),
        }
    }

    #[test]
    fn reads_line_counts_off_a_real_commit() {
        let temp = TempRepo::new();
        temp.commit("feat: seed", &[("src/a.ts", "export const a = 1;\n")]);
        let head = temp.commit(
            "feat: grow",
            &[("src/a.ts", "export const a = 1;\nexport const b = 2;\n")],
        );

        let commit = temp.repo.find_commit(head).expect("commit");
        let snapshot = snapshot_of(&temp.repo, &commit).expect("snapshot");
        assert_eq!(snapshot.summary, "feat: grow");
        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].path, "src/a.ts");
        assert_eq!(snapshot.files[0].added, 1);
        assert_eq!(snapshot.insertions, 1);
    }

    #[test]
    fn a_merge_commit_lists_no_files_so_nothing_can_be_attributed_to_it() {
        let temp = TempRepo::new();
        let base = temp.commit("feat: seed", &[("a.ts", "1\n")]);
        let side = temp.commit_on(base, "feat: side", &[("b.ts", "2\n")]);
        let merge = temp.merge_commit(base, side, "merge");

        let commit = temp.repo.find_commit(merge).expect("commit");
        let snapshot = snapshot_of(&temp.repo, &commit).expect("snapshot");
        assert_eq!(snapshot.parent_count, 2);
        assert!(snapshot.files.is_empty(), "a merge authored nothing");
    }

    #[test]
    fn an_unborn_head_yields_no_commits_rather_than_an_error() {
        let temp = TempRepo::new();
        assert!(collect_commit_snapshots(&temp.repo, 10)
            .expect("walk")
            .is_empty());
    }

    #[test]
    fn low_confidence_attribution_is_treated_as_no_attribution() {
        let link = link_for(&["abc"], LinkConfidence::Low);
        assert!(attribution_from(Some(&link)).is_none());
    }

    #[test]
    fn file_edits_survive_a_refused_attribution() {
        let summary = session_with(&["/repo/src/a.rs", "/repo/src/b.rs"], &[]);
        let section = build(&ctx("/repo"), &summary, &[], None);

        assert_eq!(section.files.len(), 2, "the log is a fact regardless");
        assert_eq!(section.files[0].path, "src/a.rs");
        assert!(section.commits.is_empty());
        assert!(section.attribution.is_none());
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NoCommitAttribution
        );
        assert!(
            section.uncommitted_paths.is_empty(),
            "without attribution we must not claim everything is uncommitted"
        );
    }

    #[test]
    fn files_are_ordered_by_churn_then_path() {
        let mut summary = session_with(&["/repo/calm.rs", "/repo/churn.rs", "/repo/also.rs"], &[]);
        summary.files_edited[1].edit_count = 7;
        let section = build(&ctx("/repo"), &summary, &[], None);
        let order: Vec<&str> = section.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(order, vec!["churn.rs", "also.rs", "calm.rs"]);
    }

    #[test]
    fn an_attributed_commit_names_the_files_the_session_never_touched() {
        let temp = TempRepo::new();
        temp.commit("feat: seed", &[("src/a.ts", "1\n")]);
        let head = temp.commit(
            "feat: two files",
            &[("src/a.ts", "2\n"), ("src/stranger.ts", "9\n")],
        );
        let snapshots = collect_commit_snapshots(&temp.repo, 10).expect("snapshots");
        let root = temp.dir.to_string_lossy().to_string();

        let summary = session_with(&[&format!("{}/src/a.ts", root)], &[]);
        let mut link = link_for(&[&head.to_string()], LinkConfidence::Medium);
        link.commits = vec![detail(&head.to_string(), &["src/stranger.ts"])];
        let section = build(&ctx(&root), &summary, &snapshots, Some(&link));

        assert_eq!(section.commits.len(), 1);
        assert_eq!(
            section.commits[0].unattributed_files,
            vec!["src/stranger.ts".to_string()]
        );
        assert!(section.files[0].in_commit);
        assert_eq!(section.files[0].added_lines, Some(1));
        assert!(section.uncommitted_paths.is_empty());
    }

    #[test]
    fn edits_missing_from_the_attributed_commits_are_reported_as_uncommitted() {
        let temp = TempRepo::new();
        let head = temp.commit("feat: seed", &[("src/a.ts", "1\n")]);
        let snapshots = collect_commit_snapshots(&temp.repo, 10).expect("snapshots");
        let root = temp.dir.to_string_lossy().to_string();

        let summary = session_with(
            &[
                &format!("{}/src/a.ts", root),
                &format!("{}/src/pending.ts", root),
            ],
            &[],
        );
        let mut link = link_for(&[&head.to_string()], LinkConfidence::High);
        link.commits = vec![detail(&head.to_string(), &[])];
        let section = build(&ctx(&root), &summary, &snapshots, Some(&link));

        assert_eq!(section.uncommitted_paths, vec!["src/pending.ts".to_string()]);
        let pending = section
            .files
            .iter()
            .find(|f| f.path == "src/pending.ts")
            .expect("pending file");
        assert!(!pending.in_commit);
        assert_eq!(pending.added_lines, None);
    }

    #[test]
    fn a_commit_outside_the_walk_window_is_dropped_rather_than_half_described() {
        let summary = session_with(&["/repo/a.rs"], &[]);
        let mut link = link_for(&["deadbeef"], LinkConfidence::High);
        link.commits = vec![detail("deadbeef", &[])];
        let section = build(&ctx("/repo"), &summary, &[], Some(&link));

        assert!(section.commits.is_empty());
        assert!(
            section.attribution.is_some(),
            "the link still stands; only its description is missing"
        );
    }
}
