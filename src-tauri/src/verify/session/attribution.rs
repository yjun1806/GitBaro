//! Session ↔ commit attribution — grading is decided **per (session, commit)
//! pair**, then contested commits are arbitrated across sessions.
//!
//! A wrong attribution produces a confidently wrong report, which is worse than
//! no report at all (contract §5). Two rules follow from that and are enforced
//! here rather than left to callers:
//!
//! * **Refusal is a valid answer.** A pair that fails any hard check yields no
//!   link — time proximity alone is never attribution.
//! * **`High` is a claim of fact.** It demands that the session account for the
//!   whole commit, on the same branch, in the same worktree, inside the session
//!   window, by the same author, with no competing claimant.
//!
//! Everything else is `Medium`, which the UI must mark as an estimate, or
//! `Low`, which never leaves this module.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use git2::Repository;

use crate::error::AppError;
use crate::verify::types::{
    CwdRelation, LinkConfidence, RejectionReason, SessionSummary, MAX_UNATTRIBUTED_FILES,
};

/// Commits are attributed up to this long after a session ends, covering the
/// ordinary "agent finishes, human commits a moment later" case.
pub const TAIL_GRACE_MILLIS: i64 = 10 * 60 * 1000;

/// `High` also demands that the commit account for a meaningful share of what
/// the session did. Without this a 200-file session claims a 1-file commit
/// outright, purely because that one file happens to be in both sets.
pub const MIN_SESSION_COVERAGE: f32 = 0.10;

/// Three-way ambiguity is noise, not information: every claimant is dropped.
const MAX_MEDIUM_CLAIMANTS: usize = 2;

/// HEAD reflog entries scanned when dating a commit's arrival. Deep enough to
/// cover a rebase, shallow enough to stay cheap.
const REFLOG_SCAN: usize = 2_000;

/// Branches consulted when deciding which ones contain a commit. A repository
/// with hundreds of stale branches must not slow the report page down.
const MAX_BRANCHES_SCANNED: usize = 64;

/// Commits walked per branch while resolving containment.
const MAX_CONTAINMENT_WALK: usize = 5_000;

// ── Inputs ───────────────────────────────────────────────────────────────────

/// Everything about a commit that correlation is allowed to look at. Built by
/// the command layer from `git2`; a plain struct so grading stays testable
/// without a repository.
#[derive(Clone, Debug)]
pub struct CommitFacts {
    pub oid: String,
    /// Epoch **milliseconds** (`commit.time().seconds() * 1000`).
    pub timestamp_ms: i64,
    /// Repository-relative paths the commit changed. Empty for merges.
    pub files: Vec<String>,
    pub parent_count: usize,
    /// `commit.author().email()`, when it is valid UTF-8.
    pub author_email: Option<String>,
    /// **Every** local branch that actually contains this commit.
    ///
    /// Not "the branch that happens to be checked out". A commit authored on
    /// `main` is still on `main` after the reader moves to a feature branch,
    /// and a merged feature branch's commits are on both. Labelling by HEAD
    /// alone made every past session mismatch the moment the reader switched
    /// branches, which refused attribution for real work.
    ///
    /// Empty means "unknown", which is neutral, never a mismatch.
    pub branches: BTreeSet<String>,
    /// When this oid first entered the HEAD reflog. `None` when the repository
    /// has no reflog: absence of evidence is not evidence.
    pub reflog_first_seen_at: Option<i64>,
}

/// Repository-side facts shared by every pair.
#[derive(Clone, Debug, Default)]
pub struct AttributionContext {
    /// The worktree being viewed. Session paths are normalised against it.
    pub repo_path: PathBuf,
    /// Resolved common git directory. Sibling worktrees share it.
    pub common_dir: Option<PathBuf>,
    /// Emails that count as "this user", lowercased. Empty means unknown,
    /// which is neutral.
    pub known_emails: BTreeSet<String>,
}

impl AttributionContext {
    /// Resolve what can be resolved from the path alone. Callers that have a
    /// `git2::Repository` should fill in `known_emails` as well.
    pub fn for_repo(repo_path: impl Into<PathBuf>) -> Self {
        let repo_path = repo_path.into();
        let common_dir = common_dir_of(&repo_path);
        Self {
            repo_path,
            common_dir,
            known_emails: BTreeSet::new(),
        }
    }

    /// The full context, including the identity git would commit as. Every
    /// caller must build it this way so the report and the correlation command
    /// never grade the same pair differently.
    pub fn from_repo(repo: &Repository, repo_path: &Path) -> Self {
        Self::for_repo(repo_path).with_emails(configured_emails(repo))
    }

    pub fn with_emails<I: IntoIterator<Item = String>>(mut self, emails: I) -> Self {
        self.known_emails
            .extend(emails.into_iter().map(|e| e.trim().to_lowercase()));
        self.known_emails.retain(|e| !e.is_empty());
        self
    }
}

/// `user.email` as git resolves it (local, then global, then system). A commit
/// authored by anyone else cannot be stated as this session's work.
fn configured_emails(repo: &Repository) -> Vec<String> {
    repo.config()
        .and_then(|mut config| config.snapshot())
        .ok()
        .and_then(|snapshot| snapshot.get_string("user.email").ok())
        .into_iter()
        .collect()
}

/// Gather every signal correlation is allowed to weigh, once per commit.
///
/// `CommitInfo::timestamp` is in seconds and every verify timestamp is in
/// milliseconds — this is the conversion point.
pub fn commit_facts(repo: &Repository, oids: &[String]) -> Result<Vec<CommitFacts>, AppError> {
    let reflog = reflog_first_seen(repo);
    let mut facts = Vec::with_capacity(oids.len());

    for oid in oids {
        let Ok(commit) = repo.revparse_single(oid).and_then(|o| o.peel_to_commit()) else {
            tracing::debug!("[verify] skipping unresolvable commit {}", oid);
            continue;
        };
        facts.push(CommitFacts {
            files: crate::verify::hygiene::commit_changed_paths(repo, &commit)?,
            timestamp_ms: commit.time().seconds() * 1000,
            parent_count: commit.parent_count(),
            author_email: commit.author().email().map(str::to_string),
            branches: BTreeSet::new(),
            reflog_first_seen_at: reflog.get(&commit.id().to_string()).copied(),
            oid: commit.id().to_string(),
        });
    }

    let wanted: BTreeSet<String> = facts.iter().map(|f| f.oid.clone()).collect();
    let containment = branch_containment(repo, &wanted);
    for fact in &mut facts {
        if let Some(branches) = containment.get(&fact.oid) {
            fact.branches.clone_from(branches);
        }
    }

    Ok(facts)
}

/// Which local branches contain each of `wanted`.
///
/// One revwalk per branch rather than a reachability query per (branch, commit)
/// pair, and every walk is bounded — a repository with a long history must not
/// make opening the report page expensive.
fn branch_containment(
    repo: &Repository,
    wanted: &BTreeSet<String>,
) -> BTreeMap<String, BTreeSet<String>> {
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    if wanted.is_empty() {
        return out;
    }
    let Ok(branches) = repo.branches(Some(git2::BranchType::Local)) else {
        return out;
    };

    for (branch, _) in branches.flatten().take(MAX_BRANCHES_SCANNED) {
        let Ok(Some(name)) = branch.name().map(|n| n.map(str::to_string)) else {
            continue;
        };
        let Some(tip) = branch.get().target() else {
            continue;
        };
        let Ok(mut walk) = repo.revwalk() else { continue };
        if walk.push(tip).is_err() {
            continue;
        }
        let mut found = 0usize;
        for oid in walk.flatten().take(MAX_CONTAINMENT_WALK) {
            let key = oid.to_string();
            if wanted.contains(&key) {
                out.entry(key).or_default().insert(name.clone());
                found += 1;
                if found == wanted.len() {
                    break;
                }
            }
        }
    }
    out
}

pub fn head_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    head.shorthand().map(str::to_string)
}

/// When each oid first entered the HEAD reflog. A commit that appeared long
/// after a session ended arrived by rebase or cherry-pick, so the tree we see
/// today is not the one that session produced.
///
/// git2 yields reflog entries newest-first, so the last write wins and holds
/// the earliest appearance.
pub fn reflog_first_seen(repo: &Repository) -> BTreeMap<String, i64> {
    let mut seen = BTreeMap::new();
    let Ok(reflog) = repo.reflog("HEAD") else {
        return seen;
    };
    for entry in reflog.iter().take(REFLOG_SCAN) {
        seen.insert(
            entry.id_new().to_string(),
            entry.committer().when().seconds() * 1000,
        );
    }
    seen
}

/// A session with the per-session work done once instead of per commit.
#[derive(Clone, Debug)]
pub struct SessionFacts<'a> {
    pub summary: &'a SessionSummary,
    pub relation: CwdRelation,
    /// Repository-relative paths the session edited.
    pub edited: BTreeSet<String>,
}

impl<'a> SessionFacts<'a> {
    pub fn new(ctx: &AttributionContext, summary: &'a SessionSummary) -> Self {
        // A session in a sibling worktree logs paths under *its* checkout, not
        // the one being viewed. Both roots are tried so the two sides of the
        // comparison end up in the same coordinate system.
        let mut roots = vec![ctx.repo_path.to_string_lossy().to_string()];
        if let Some(root) = worktree_root_of(Path::new(&summary.cwd)) {
            roots.push(root.to_string_lossy().to_string());
        }
        Self {
            relation: resolve_cwd_relation(ctx, Path::new(&summary.cwd)),
            edited: summary
                .files_edited
                .iter()
                .map(|f| normalize_any(&f.path, &roots))
                .collect(),
            summary,
        }
    }

    /// Two sessions are "parallel" only if their windows actually overlap.
    fn overlaps(&self, other: &SessionFacts<'_>) -> bool {
        self.summary.started_at <= other.summary.ended_at
            && other.summary.started_at <= self.summary.ended_at
    }
}

// ── Output ───────────────────────────────────────────────────────────────────

/// The verdict for one (session, commit) pair. Grades are decided only here.
#[derive(Clone, Debug)]
pub struct PairVerdict {
    pub commit_id: String,
    pub confidence: LinkConfidence,
    pub basis: Vec<&'static str>,
    /// `|session edits ∩ commit changes| / |commit changes|`.
    pub commit_coverage: f32,
    /// `|session edits ∩ commit changes| / |session edits|`.
    pub session_coverage: f32,
    /// Files in the commit this session never edited.
    pub unattributed_files: Vec<String>,
    /// Set whenever the pair is not attributed. `Low` always carries one.
    pub rejection: Option<RejectionReason>,
    /// Competing claimants when this commit was contested.
    pub ambiguous_with: usize,
}

impl PairVerdict {
    /// A refusal still reports its coverage: those numbers are what made the
    /// commit a candidate, and the UI needs them to explain the absence.
    fn refuse(&self, reason: RejectionReason) -> Self {
        Self {
            confidence: LinkConfidence::Low,
            basis: Vec::new(),
            rejection: Some(reason),
            ..self.clone()
        }
    }

    pub fn is_attributed(&self) -> bool {
        self.confidence != LinkConfidence::Low
    }
}

// ── Grading ──────────────────────────────────────────────────────────────────

/// Grade one pair. Hard refusals come first so a rejected pair never carries a
/// partially computed grade.
pub fn grade_pair(
    ctx: &AttributionContext,
    session: &SessionFacts<'_>,
    commit: &CommitFacts,
) -> PairVerdict {
    let summary = session.summary;
    let repo = ctx.repo_path.to_string_lossy().to_string();
    let changed: BTreeSet<String> = commit.files.iter().map(|f| normalize(f, &repo)).collect();
    let overlap = changed.intersection(&session.edited).count();
    let covers_commit = overlap == changed.len() && !changed.is_empty();
    let session_coverage = ratio(overlap, session.edited.len());

    // The shape every outcome starts from, so a refusal still carries the
    // numbers that made this commit a candidate.
    let base = PairVerdict {
        commit_id: commit.oid.clone(),
        confidence: LinkConfidence::Low,
        basis: Vec::new(),
        commit_coverage: ratio(overlap, changed.len()),
        session_coverage,
        unattributed_files: changed
            .difference(&session.edited)
            .take(MAX_UNATTRIBUTED_FILES)
            .cloned()
            .collect(),
        rejection: None,
        ambiguous_with: 0,
    };

    // ── Hard refusals (contract §5.4) ──────────────────────────────────────
    if session.relation == CwdRelation::Unrelated {
        return base.refuse(RejectionReason::DifferentWorktree);
    }
    // A merge's file list is not authored work.
    if commit.parent_count > 1 {
        return base.refuse(RejectionReason::MergeCommit);
    }
    // Time proximity is never attribution on its own.
    if overlap == 0 {
        return base.refuse(RejectionReason::NoFileOverlap);
    }
    if commit.timestamp_ms < summary.started_at {
        return base.refuse(RejectionReason::OutsideSessionWindow);
    }
    // The branch the session recorded must be one of the branches that actually
    // contain this commit. An unlabelled commit (on no local branch) stays
    // unknown, which is neutral; a labelled commit the session's branch does not
    // reach is a mismatch, and misattribution is worse than no attribution.
    if let Some(session_branch) = &summary.git_branch {
        if !commit.branches.is_empty() && !commit.branches.contains(session_branch) {
            return base.refuse(RejectionReason::BranchMismatch);
        }
    }
    // A partially read log cannot support a partial-coverage claim.
    if summary.truncated && !covers_commit {
        return base.refuse(RejectionReason::PartialLogInsufficient);
    }

    // ── Signals ────────────────────────────────────────────────────────────
    let branch_matches = summary
        .git_branch
        .as_ref()
        .is_some_and(|b| commit.branches.contains(b));
    let in_window = commit.timestamp_ms <= summary.ended_at.saturating_add(TAIL_GRACE_MILLIS);
    let mtime_known = summary.modified_at > 0;
    let mtime_ok = !mtime_known
        || commit.timestamp_ms <= summary.modified_at.saturating_add(TAIL_GRACE_MILLIS);
    let author_known = !ctx.known_emails.is_empty() && commit.author_email.is_some();
    let author_ok = !author_known
        || commit
            .author_email
            .as_ref()
            .is_some_and(|email| ctx.known_emails.contains(&email.trim().to_lowercase()));
    // A commit that entered HEAD outside the session window arrived by rebase
    // or cherry-pick: the tree we see is not the one the session produced.
    let reflog_ok = commit.reflog_first_seen_at.is_none_or(|at| {
        at >= summary.started_at && at <= summary.ended_at.saturating_add(TAIL_GRACE_MILLIS)
    });
    let high_end = if mtime_known {
        summary.ended_at.min(summary.modified_at)
    } else {
        summary.ended_at
    };
    let in_high_window = commit.timestamp_ms <= high_end.saturating_add(TAIL_GRACE_MILLIS);

    let mut basis = vec!["fileOverlap"];
    match session.relation {
        CwdRelation::ThisWorktree => basis.push("cwd"),
        CwdRelation::SiblingWorktree => basis.push("siblingWorktree"),
        CwdRelation::Unrelated => {}
    }
    if branch_matches {
        basis.push("branch");
    }
    if in_window {
        basis.push("timeWindow");
    }
    if mtime_known && mtime_ok {
        basis.push("mtime");
    }
    if author_known && author_ok {
        basis.push("author");
    }
    if commit.reflog_first_seen_at.is_some() && reflog_ok {
        basis.push("reflog");
    }

    let confidence = if session.relation == CwdRelation::ThisWorktree
        && branch_matches
        && in_high_window
        && mtime_ok
        && covers_commit
        && session_coverage >= MIN_SESSION_COVERAGE
        && author_ok
        && reflog_ok
    {
        LinkConfidence::High
    } else if branch_matches || in_window {
        // `relation` is ThisWorktree or SiblingWorktree here; Unrelated was
        // refused above.
        LinkConfidence::Medium
    } else {
        LinkConfidence::Low
    };

    let rejection = match confidence {
        // The only way to reach Low here is a commit outside the window whose
        // branch could not corroborate it.
        LinkConfidence::Low => Some(RejectionReason::OutsideSessionWindow),
        _ if !author_ok => Some(RejectionReason::DifferentAuthor),
        _ => None,
    };

    PairVerdict {
        confidence,
        basis,
        rejection,
        ..base
    }
}

// ── Parallel-session arbitration (contract §5.5) ─────────────────────────────

/// One session's claim on one commit. `session` indexes the slice passed to
/// [`arbitrate`].
#[derive(Clone, Debug)]
pub struct Claim {
    pub session: usize,
    pub verdict: PairVerdict,
}

/// Settle competing claims, commit by commit.
///
/// Only sessions whose windows actually overlap compete: two sessions that ran
/// at different times each own their own stretch of history and are not
/// "parallel" in any meaningful sense.
pub fn arbitrate(sessions: &[SessionFacts<'_>], by_commit: &mut BTreeMap<String, Vec<Claim>>) {
    for claims in by_commit.values_mut() {
        for group in conflict_groups(sessions, claims) {
            settle(sessions, claims, &group);
        }
    }
}

/// Connected components over "the two session windows overlap", restricted to
/// claimants that are still attributed.
fn conflict_groups(sessions: &[SessionFacts<'_>], claims: &[Claim]) -> Vec<Vec<usize>> {
    let live: Vec<usize> = (0..claims.len())
        .filter(|i| claims[*i].verdict.is_attributed())
        .collect();

    let mut unassigned: Vec<usize> = live;
    let mut groups = Vec::new();

    while let Some(seed) = unassigned.pop() {
        let mut group = vec![seed];
        let mut frontier = vec![seed];
        while let Some(current) = frontier.pop() {
            let mut i = 0;
            while i < unassigned.len() {
                let candidate = unassigned[i];
                let a = &sessions[claims[current].session];
                let b = &sessions[claims[candidate].session];
                if a.overlaps(b) {
                    unassigned.swap_remove(i);
                    group.push(candidate);
                    frontier.push(candidate);
                } else {
                    i += 1;
                }
            }
        }
        group.sort_unstable();
        groups.push(group);
    }

    groups.sort();
    groups
}

fn settle(sessions: &[SessionFacts<'_>], claims: &mut [Claim], group: &[usize]) {
    if group.len() <= 1 {
        return;
    }

    // Three claimants or more: nobody gets it.
    if group.len() > MAX_MEDIUM_CLAIMANTS {
        for &i in group {
            claims[i].verdict.confidence = LinkConfidence::Low;
            claims[i].verdict.rejection = Some(RejectionReason::AmbiguousWithAnotherSession);
            claims[i].verdict.ambiguous_with = group.len();
        }
        return;
    }

    let highs: Vec<usize> = group
        .iter()
        .copied()
        .filter(|i| claims[*i].verdict.confidence == LinkConfidence::High)
        .collect();
    if highs.len() < 2 {
        return;
    }

    // A session that did strictly everything the others did — and more —
    // explains the commit better than any of them.
    let winner = highs.iter().copied().find(|&i| {
        let mine = &sessions[claims[i].session].edited;
        highs
            .iter()
            .filter(|&&other| other != i)
            .all(|&other| is_strict_superset(mine, &sessions[claims[other].session].edited))
    });

    for &i in &highs {
        if Some(i) == winner {
            continue;
        }
        claims[i].verdict.confidence = LinkConfidence::Medium;
        claims[i].verdict.ambiguous_with = highs.len();
    }
}

fn is_strict_superset(mine: &BTreeSet<String>, other: &BTreeSet<String>) -> bool {
    mine.len() > other.len() && other.is_subset(mine)
}

// ── Worktree resolution ──────────────────────────────────────────────────────

/// Where `cwd` sits relative to the repository in `ctx`.
///
/// A linked worktree has its own path but shares the object database, so a
/// session that ran there is about the same commits — just not authoritative
/// about which checkout produced them.
pub fn resolve_cwd_relation(ctx: &AttributionContext, cwd: &Path) -> CwdRelation {
    if cwd.as_os_str().is_empty() {
        return CwdRelation::Unrelated;
    }
    if is_within(cwd, &ctx.repo_path) {
        return CwdRelation::ThisWorktree;
    }
    match (&ctx.common_dir, common_dir_of(cwd)) {
        (Some(ours), Some(theirs)) if *ours == theirs => CwdRelation::SiblingWorktree,
        _ => CwdRelation::Unrelated,
    }
}

/// Walk up from `start` to the first `.git`, then resolve the shared git
/// directory it points at. Mirrors `verify::paths::shared_state_dir` but works
/// from a bare path, because a session cwd may not be openable as a repository.
fn common_dir_of(start: &Path) -> Option<PathBuf> {
    let dot_git = find_dot_git(start)?;
    if dot_git.is_dir() {
        return Some(canonical(dot_git));
    }
    worktree_common_dir(&dot_git)
}

/// The checkout root a path belongs to — the directory holding its `.git`.
fn worktree_root_of(start: &Path) -> Option<PathBuf> {
    find_dot_git(start)?.parent().map(Path::to_path_buf)
}

fn find_dot_git(start: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        let dot_git = current.join(".git");
        if dot_git.exists() {
            return Some(dot_git);
        }
        current = current.parent()?;
    }
}

/// A linked worktree's `.git` is a file holding `gitdir: <path>`; that
/// directory in turn holds a `commondir` pointer to the shared git dir.
fn worktree_common_dir(dot_git_file: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(dot_git_file).ok()?;
    let target = raw.trim().strip_prefix("gitdir:")?.trim();
    let git_dir = resolve_relative(dot_git_file.parent()?, Path::new(target));

    let pointer = git_dir.join("commondir");
    let Ok(raw) = std::fs::read_to_string(&pointer) else {
        // No pointer means this is not a linked worktree after all.
        return Some(canonical(git_dir));
    };
    Some(canonical(resolve_relative(&git_dir, Path::new(raw.trim()))))
}

fn resolve_relative(base: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        target.to_path_buf()
    } else {
        base.join(target)
    }
}

fn canonical(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

fn is_within(candidate: &Path, root: &Path) -> bool {
    let candidate = canonical(candidate.to_path_buf());
    let root = canonical(root.to_path_buf());
    candidate == root || candidate.starts_with(&root)
}

/// Session logs record absolute paths; commits record repository-relative
/// ones. Compare on the relative form.
pub fn normalize(path: &str, repo: &str) -> String {
    path.strip_prefix(repo)
        .map(|rest| rest.trim_start_matches('/').to_string())
        .unwrap_or_else(|| path.to_string())
}

/// First root that actually prefixes `path` wins; otherwise the path is left
/// alone and simply will not intersect anything.
fn normalize_any(path: &str, roots: &[String]) -> String {
    for root in roots {
        if let Some(rest) = path.strip_prefix(root.as_str()) {
            return rest.trim_start_matches('/').to_string();
        }
    }
    path.to_string()
}

fn ratio(part: usize, whole: usize) -> f32 {
    if whole == 0 {
        0.0
    } else {
        part as f32 / whole as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::session::test_support::summary_fixture::{commit, edit, session, REPO, T0};

    fn ctx() -> AttributionContext {
        AttributionContext {
            repo_path: PathBuf::from(REPO),
            common_dir: None,
            known_emails: ["dev@example.com".to_string()].into_iter().collect(),
        }
    }

    fn facts<'a>(ctx: &AttributionContext, s: &'a SessionSummary) -> SessionFacts<'a> {
        SessionFacts::new(ctx, s)
    }

    #[test]
    fn full_coverage_on_the_same_branch_is_high() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs", "src/b.rs"]);
        let v = grade_pair(
            &ctx,
            &facts(&ctx, &s),
            &commit(T0 + 30_000, &["src/a.rs", "src/b.rs"]),
        );
        assert_eq!(v.confidence, LinkConfidence::High);
        assert_eq!(v.commit_coverage, 1.0);
        assert!(v.basis.contains(&"branch"));
        assert!(v.basis.contains(&"author"));
        assert!(v.rejection.is_none());
    }

    #[test]
    fn a_branch_mismatch_is_a_hard_refusal() {
        // Defect 1: the old code only checked that a branch was *recorded*.
        let ctx = ctx();
        let s = session(Some("feat/x"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        c.branches = ["main".to_string()].into_iter().collect();
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert_eq!(v.rejection, Some(RejectionReason::BranchMismatch));
        assert!(!v.is_attributed());
    }

    #[test]
    fn a_commit_on_several_branches_matches_any_of_them() {
        // A merged feature branch's commits sit on both refs. Grading against
        // one label only refused work that plainly belongs to the session.
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        c.branches = ["feat/x".to_string(), "main".to_string()]
            .into_iter()
            .collect();
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert!(v.rejection.is_none());
        assert!(v.basis.contains(&"branch"));
        assert_eq!(v.confidence, LinkConfidence::High);
    }

    #[test]
    fn a_commit_on_no_branch_at_all_is_unknown_rather_than_a_mismatch() {
        // Nothing local reaches this commit, so there is no label to disagree
        // with. Unknown caps the grade instead of refusing outright.
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        c.branches.clear();
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert_eq!(v.rejection, None, "absence of evidence is not a mismatch");
        assert!(!v.basis.contains(&"branch"));
        assert_eq!(v.confidence, LinkConfidence::Medium);
    }

    #[test]
    fn a_merge_commit_is_never_attributed() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        c.parent_count = 2;
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert_eq!(v.rejection, Some(RejectionReason::MergeCommit));
    }

    #[test]
    fn perfect_timing_without_file_overlap_is_still_nothing() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let v = grade_pair(&ctx, &facts(&ctx, &s), &commit(T0 + 1, &["src/other.rs"]));
        assert_eq!(v.rejection, Some(RejectionReason::NoFileOverlap));
    }

    #[test]
    fn a_sprawling_session_cannot_own_a_one_file_commit() {
        // Defect 6: coverage was one-directional.
        let ctx = ctx();
        let paths: Vec<String> = (0..200).map(|i| format!("src/f{}.rs", i)).collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let s = session(Some("main"), REPO, &refs);
        let v = grade_pair(&ctx, &facts(&ctx, &s), &commit(T0 + 30_000, &["src/f0.rs"]));
        assert_eq!(v.confidence, LinkConfidence::Medium);
        assert_eq!(v.commit_coverage, 1.0);
        assert!(v.session_coverage < MIN_SESSION_COVERAGE);
    }

    #[test]
    fn a_truncated_log_cannot_claim_partial_coverage() {
        let ctx = ctx();
        let mut s = session(Some("main"), REPO, &["src/a.rs"]);
        s.truncated = true;
        let v = grade_pair(
            &ctx,
            &facts(&ctx, &s),
            &commit(T0 + 30_000, &["src/a.rs", "src/b.rs"]),
        );
        assert_eq!(v.rejection, Some(RejectionReason::PartialLogInsufficient));
    }

    #[test]
    fn a_truncated_log_may_still_claim_a_fully_covered_commit() {
        let ctx = ctx();
        let mut s = session(Some("main"), REPO, &["src/a.rs"]);
        s.truncated = true;
        let v = grade_pair(&ctx, &facts(&ctx, &s), &commit(T0 + 30_000, &["src/a.rs"]));
        assert_eq!(v.confidence, LinkConfidence::High);
    }

    #[test]
    fn a_commit_before_the_session_started_is_refused() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let v = grade_pair(&ctx, &facts(&ctx, &s), &commit(T0 - 1, &["src/a.rs"]));
        assert_eq!(v.rejection, Some(RejectionReason::OutsideSessionWindow));
    }

    #[test]
    fn a_cherry_picked_commit_cannot_be_high() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        // The commit entered HEAD a day after the session ended.
        c.reflog_first_seen_at = Some(T0 + 24 * 60 * 60 * 1000);
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert_eq!(v.confidence, LinkConfidence::Medium);
        assert!(!v.basis.contains(&"reflog"));
    }

    #[test]
    fn a_reflog_entry_inside_the_window_is_positive_evidence() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        c.reflog_first_seen_at = Some(T0 + 30_000);
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert_eq!(v.confidence, LinkConfidence::High);
        assert!(v.basis.contains(&"reflog"));
    }

    #[test]
    fn a_foreign_author_blocks_high_but_not_medium() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        c.author_email = Some("someone-else@example.com".into());
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert_eq!(v.confidence, LinkConfidence::Medium);
        assert_eq!(v.rejection, Some(RejectionReason::DifferentAuthor));
    }

    #[test]
    fn an_unknown_author_is_neutral() {
        let mut ctx = ctx();
        ctx.known_emails.clear();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let mut c = commit(T0 + 30_000, &["src/a.rs"]);
        c.author_email = Some("whoever@example.com".into());
        let v = grade_pair(&ctx, &facts(&ctx, &s), &c);
        assert_eq!(v.confidence, LinkConfidence::High);
        assert!(!v.basis.contains(&"author"), "no claim without evidence");
    }

    #[test]
    fn a_stale_session_file_blocks_high() {
        let ctx = ctx();
        let mut s = session(Some("main"), REPO, &["src/a.rs"]);
        // The log stopped growing an hour before the commit landed.
        s.ended_at = T0 + 3 * 60 * 60 * 1000;
        s.modified_at = T0 + 1000;
        let v = grade_pair(&ctx, &facts(&ctx, &s), &commit(T0 + 60 * 60 * 1000, &["src/a.rs"]));
        assert_eq!(v.confidence, LinkConfidence::Medium);
        assert!(!v.basis.contains(&"mtime"));
    }

    #[test]
    fn an_unrelated_cwd_is_refused_outright() {
        let ctx = ctx();
        let s = session(Some("main"), "/somewhere/else", &["src/a.rs"]);
        let v = grade_pair(&ctx, &facts(&ctx, &s), &commit(T0 + 30_000, &["src/a.rs"]));
        assert_eq!(v.rejection, Some(RejectionReason::DifferentWorktree));
    }

    #[test]
    fn unattributed_files_explain_a_medium() {
        let ctx = ctx();
        let s = session(Some("main"), REPO, &["src/a.rs"]);
        let v = grade_pair(
            &ctx,
            &facts(&ctx, &s),
            &commit(T0 + 30_000, &["src/a.rs", "src/z.rs"]),
        );
        assert_eq!(v.confidence, LinkConfidence::Medium);
        assert_eq!(v.unattributed_files, vec!["src/z.rs".to_string()]);
    }

    #[test]
    fn normalization_maps_absolute_session_paths_onto_commit_paths() {
        assert_eq!(normalize("/repo/src/a.rs", "/repo"), "src/a.rs");
        assert_eq!(normalize("src/a.rs", "/repo"), "src/a.rs");
    }

    /// Worktree resolution is filesystem behaviour, so these use real
    /// repositories rather than synthetic paths.
    mod worktrees {
        use super::*;
        use crate::verify::session::test_support::TempDir;
        use crate::verify::types::FileEditSummary;
        use git2::Repository;

        /// `main/` with one commit plus a linked worktree at `linked/`.
        fn linked_pair(dir: &TempDir) -> (PathBuf, PathBuf) {
            let main = dir.path().join("main");
            std::fs::create_dir_all(&main).expect("create main");
            let repo = Repository::init(&main).expect("init");
            let signature = git2::Signature::now("T", "t@example.com").expect("signature");
            let tree_id = repo.index().expect("index").write_tree().expect("tree id");
            let tree = repo.find_tree(tree_id).expect("tree");
            repo.commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
                .expect("commit");

            let linked = dir.path().join("linked");
            let worktree = repo.worktree("linked", &linked, None).expect("worktree");
            (main, worktree.path().to_path_buf())
        }

        fn edited_at(root: &Path, rel: &str) -> FileEditSummary {
            FileEditSummary {
                path: root.join(rel).to_string_lossy().to_string(),
                ..edit(rel)
            }
        }

        #[test]
        fn a_session_in_a_linked_worktree_is_a_sibling_and_caps_at_medium() {
            let dir = TempDir::new();
            let (main, linked) = linked_pair(&dir);
            let ctx = AttributionContext::for_repo(&main)
                .with_emails(["dev@example.com".to_string()]);

            let mut s = session(Some("main"), &linked.to_string_lossy(), &[]);
            s.files_edited = vec![edited_at(&linked, "src/a.rs")];
            let facts = SessionFacts::new(&ctx, &s);

            assert_eq!(facts.relation, CwdRelation::SiblingWorktree);
            assert!(
                facts.edited.contains("src/a.rs"),
                "paths must be normalised against the session's own checkout, got {:?}",
                facts.edited
            );

            let v = grade_pair(&ctx, &facts, &commit(T0 + 30_000, &["src/a.rs"]));
            assert_eq!(
                v.confidence,
                LinkConfidence::Medium,
                "another checkout cannot be stated as fact"
            );
            assert!(v.basis.contains(&"siblingWorktree"));
            assert!(!v.basis.contains(&"cwd"));
        }

        #[test]
        fn a_session_in_a_subdirectory_still_belongs_to_this_worktree() {
            let dir = TempDir::new();
            let (main, _) = linked_pair(&dir);
            let ctx = AttributionContext::for_repo(&main);
            let nested = main.join("src");
            std::fs::create_dir_all(&nested).expect("create src");

            let s = session(Some("main"), &nested.to_string_lossy(), &[]);
            assert_eq!(
                SessionFacts::new(&ctx, &s).relation,
                CwdRelation::ThisWorktree
            );
        }

        #[test]
        fn the_published_basis_vocabulary_is_exactly_what_grading_emits() {
            // `BASIS_TOKENS` is the list the frontend renders from; a token
            // outside it shows as nothing, and a stale entry documents evidence
            // that no longer exists. Both directions are checked here.
            let dir = TempDir::new();
            let (main, linked) = linked_pair(&dir);
            let ctx =
                AttributionContext::for_repo(&main).with_emails(["dev@example.com".to_string()]);

            // This worktree, with reflog evidence.
            let mut here = session(Some("main"), &main.to_string_lossy(), &[]);
            here.files_edited = vec![edited_at(&main, "src/a.rs")];
            let mut c = commit(T0 + 30_000, &["src/a.rs"]);
            c.reflog_first_seen_at = Some(T0 + 30_000);
            let mut emitted: BTreeSet<&str> =
                grade_pair(&ctx, &SessionFacts::new(&ctx, &here), &c)
                    .basis
                    .into_iter()
                    .collect();

            // A sibling worktree, which is the only source of `siblingWorktree`.
            let mut there = session(Some("main"), &linked.to_string_lossy(), &[]);
            there.files_edited = vec![edited_at(&linked, "src/a.rs")];
            emitted.extend(
                grade_pair(
                    &ctx,
                    &SessionFacts::new(&ctx, &there),
                    &commit(T0 + 30_000, &["src/a.rs"]),
                )
                .basis,
            );

            let published: BTreeSet<&str> =
                crate::verify::types::BASIS_TOKENS.iter().copied().collect();
            assert_eq!(emitted, published);
        }

        #[test]
        fn a_session_in_an_unrelated_repository_is_refused() {
            let dir = TempDir::new();
            let (main, _) = linked_pair(&dir);
            let other = dir.path().join("other");
            std::fs::create_dir_all(&other).expect("create other");
            Repository::init(&other).expect("init other");

            let ctx = AttributionContext::for_repo(&main);
            let mut s = session(Some("main"), &other.to_string_lossy(), &[]);
            s.files_edited = vec![edited_at(&other, "src/a.rs")];

            let v = grade_pair(
                &ctx,
                &SessionFacts::new(&ctx, &s),
                &commit(T0 + 30_000, &["src/a.rs"]),
            );
            assert_eq!(v.rejection, Some(RejectionReason::DifferentWorktree));
        }
    }
}
