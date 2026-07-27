//! V36 — sub-commit bisect (spec §Layer 6, `v36.subCommitBisect`).
//!
//! `git bisect` naming a commit that touched 15 files tells you almost nothing.
//! This module narrows *inside* one commit: it applies subsets of the commit's
//! file changes on top of its parent, runs the user's verification command, and
//! delta-debugs down to the minimal failing subset.
//!
//! **Safety is the whole design.** The user's working tree, index and `.git`
//! directory are never written to:
//!
//! - Only read-only `git2` calls are used (`find_commit`, `tree`, `find_blob`,
//!   `diff_tree_to_tree`). No `checkout_tree`, no index, no temporary worktree —
//!   a `git worktree add` would register state under `.git/worktrees` that a
//!   crash could leave behind.
//! - The parent tree is materialized by hand into a directory under the system
//!   temp dir. [`Scratch`] removes it on drop, including on error and unwind.
//! - Every path from the tree is validated before it becomes a filesystem path.
//!
//! **The registry row `v36.subCommitBisect` stays `Planned`**, for two reasons
//! that both matter:
//!
//! 1. It produces no `Finding` — it is an investigation tool the user drives,
//!    not a rule that scans a diff. The registry invariant (an `Implemented` row
//!    owns exactly one `FindingKind`) would be violated by flipping it.
//! 2. A scratch tree has no `node_modules`, no `target/`, no `.env`. For most
//!    real projects the verification command therefore fails on the parent tree
//!    too, and the run ends at [`BisectVerdict::ParentAlreadyFails`] — correct,
//!    but not yet a routinely useful answer. [`BisectRequest::prepare_command`]
//!    is the escape hatch; until that has been exercised on real repositories,
//!    claiming the rule is implemented would be dishonest.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use git2::{Delta, Repository};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Delta debugging is O(n²) in the worst case; beyond this a commit is better
/// split than bisected.
pub const MAX_GROUPS: usize = 128;
/// Changed-blob bytes held in memory (old + new). A commit larger than this is
/// not a bisect candidate.
pub const MAX_PAYLOAD_BYTES: u64 = 64 * 1024 * 1024;
/// Files written when materializing the parent tree.
pub const MAX_TREE_FILES: usize = 100_000;

const SYMLINK_MODE: u32 = 0o120000;
/// Output kept per non-passing run, so a `ParentAlreadyFails` verdict can say
/// *why* (a missing `node_modules` looks nothing like a real regression).
const MAX_OUTPUT_TAIL_CHARS: usize = 2_000;

// ── Request / result types ───────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct BisectRequest {
    pub repo_path: PathBuf,
    pub commit_id: String,
    /// Shell command deciding pass/fail, run in the scratch checkout.
    ///
    /// **From user settings only.** It reaches `/bin/sh -c`, so it must never
    /// come from a commit message, a diff, or a session log.
    pub command: String,
    /// Optional one-time setup run once in the scratch checkout before the
    /// search starts (`pnpm install --frozen-lockfile`, `cargo fetch`).
    pub prepare_command: Option<String>,
    /// Wall clock allowed for a single verification run.
    pub run_timeout: Duration,
    /// Wall clock allowed for the whole search.
    pub total_timeout: Duration,
    /// Hard ceiling on verification runs.
    pub max_runs: usize,
}

impl BisectRequest {
    pub fn new(repo_path: PathBuf, commit_id: String, command: String) -> Self {
        Self {
            repo_path,
            commit_id,
            command,
            prepare_command: None,
            run_timeout: Duration::from_secs(600),
            total_timeout: Duration::from_secs(3600),
            max_runs: 64,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunOutcome {
    /// The verification command succeeded for this subset.
    Pass,
    /// The verification command failed — this subset reproduces the problem.
    Fail,
    /// Timed out or could not be judged. Never counted as `Fail`: narrowing
    /// into a subset we did not actually observe failing would be a lie.
    Inconclusive,
    /// Cancelled, out of budget, or over the run ceiling. Stops the search.
    Aborted,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BisectVerdict {
    /// A minimal failing subset was isolated and its complement passes.
    Isolated,
    /// A minimal failing subset was found, but removing it still fails: the
    /// changes are interdependent, or there is more than one cause.
    Interdependent,
    /// The parent tree already fails — the cause predates this commit, or the
    /// scratch checkout is missing build dependencies.
    ParentAlreadyFails,
    /// The whole commit passes in the scratch checkout: nothing to bisect.
    CommitPasses,
    /// Cancelled, out of time, or out of runs before a conclusion was reached.
    Aborted,
}

/// One atom of the search. A rename is two path operations that make no sense
/// apart, so a group can carry several.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeGroupInfo {
    pub id: usize,
    pub paths: Vec<String>,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub group_ids: Vec<usize>,
    pub outcome: RunOutcome,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    /// Tail of stdout+stderr, kept only for runs that did not pass. May contain
    /// whatever the verification command prints — never re-logged.
    pub output_tail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BisectReport {
    pub commit_id: String,
    pub parent_id: String,
    pub verdict: BisectVerdict,
    /// **Not translated.** A factual sentence; the frontend renders its own
    /// copy from `verdict` and uses this as evidence detail.
    pub explanation: String,
    pub groups: Vec<ChangeGroupInfo>,
    pub culprit_group_ids: Vec<usize>,
    pub culprit_paths: Vec<String>,
    pub runs: Vec<RunRecord>,
    pub inconclusive_runs: usize,
    /// Changes this tool cannot apply (submodule pointers), excluded from the
    /// search and reported so the answer is not silently partial.
    pub skipped_paths: Vec<String>,
    pub duration_ms: u64,
}

// ── Change extraction (git2, read-only) ──────────────────────────────────────

/// One file operation: the new content, plus the parent's content so the
/// operation can be undone without going back to the repository.
#[derive(Clone, Debug)]
struct FileOp {
    path: String,
    /// `None` deletes the file.
    new: Option<Vec<u8>>,
    new_mode: u32,
    /// `None` means the file did not exist in the parent.
    old: Option<Vec<u8>>,
    old_mode: u32,
}

#[derive(Clone, Debug)]
struct ChangeGroup {
    info: ChangeGroupInfo,
    ops: Vec<FileOp>,
}

/// Everything phase 2 needs. Deliberately holds no `git2` handle, so it is
/// `Send` and the async driver can own it.
struct Plan {
    commit_id: String,
    parent_id: String,
    groups: Vec<ChangeGroup>,
    skipped_paths: Vec<String>,
    scratch: Scratch,
}

fn blob_bytes(repo: &Repository, oid: git2::Oid) -> Result<Vec<u8>, AppError> {
    Ok(repo.find_blob(oid)?.content().to_vec())
}

/// Build the change groups and materialize the parent tree into `scratch`.
///
/// Synchronous and `git2`-bound: the caller runs it inside `spawn_blocking`.
fn plan(request: &BisectRequest, scratch: Scratch) -> Result<Plan, AppError> {
    let repo = Repository::open(&request.repo_path)?;
    let oid = git2::Oid::from_str(&request.commit_id)
        .map_err(|_| AppError::Verify(format!("Not a commit id: {}", request.commit_id)))?;
    let commit = repo.find_commit(oid)?;

    if commit.parent_count() != 1 {
        return Err(AppError::Verify(
            "Only a commit with exactly one parent can be bisected: a merge has \
             no single baseline to apply subsets on top of."
                .to_string(),
        ));
    }
    let parent = commit.parent(0)?;
    let parent_tree = parent.tree()?;
    let commit_tree = commit.tree()?;

    let mut diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None)?;
    diff.find_similar(Some(git2::DiffFindOptions::new().renames(true)))?;

    let mut groups: Vec<ChangeGroup> = Vec::new();
    let mut skipped_paths: Vec<String> = Vec::new();
    let mut bytes: u64 = 0;

    for delta in diff.deltas() {
        let old_file = delta.old_file();
        let new_file = delta.new_file();
        let old_path = old_file.path().and_then(|p| p.to_str()).map(str::to_string);
        let new_path = new_file.path().and_then(|p| p.to_str()).map(str::to_string);

        // Submodule pointers are not file content; applying one would need a
        // recursive fetch we deliberately do not perform.
        if is_gitlink(old_file.mode()) || is_gitlink(new_file.mode()) {
            skipped_paths.extend(new_path.or(old_path));
            continue;
        }

        let mut ops: Vec<FileOp> = Vec::new();
        // A deletion drops `old_path`; a rename drops it *and* writes
        // `new_path`, and both halves must travel together or a subset would
        // duplicate or lose the file. git2 repeats the path on a `Deleted`
        // delta, so the two cases are matched explicitly rather than compared.
        let removed = match delta.status() {
            Delta::Deleted | Delta::Renamed => old_path.clone(),
            _ => None,
        };

        if let Some(path) = removed {
            let old = blob_bytes(&repo, old_file.id())?;
            bytes += old.len() as u64;
            ops.push(FileOp {
                path,
                new: None,
                new_mode: 0,
                old_mode: mode_of(old_file.mode()),
                old: Some(old),
            });
        }

        if let Some(path) = new_path.clone().filter(|_| delta.status() != Delta::Deleted) {
            let new = blob_bytes(&repo, new_file.id())?;
            let old = match delta.status() {
                Delta::Added | Delta::Renamed | Delta::Copied => None,
                _ => Some(blob_bytes(&repo, old_file.id())?),
            };
            bytes += new.len() as u64 + old.as_ref().map_or(0, |o| o.len()) as u64;
            ops.push(FileOp {
                path,
                new_mode: mode_of(new_file.mode()),
                new: Some(new),
                old_mode: mode_of(old_file.mode()),
                old,
            });
        }

        if ops.is_empty() {
            continue;
        }
        if bytes > MAX_PAYLOAD_BYTES {
            return Err(AppError::Verify(format!(
                "This commit changes more than {} MiB of file content — too large \
                 to bisect in a scratch checkout.",
                MAX_PAYLOAD_BYTES / (1024 * 1024)
            )));
        }

        let paths: Vec<String> = ops.iter().map(|op| op.path.clone()).collect();
        groups.push(ChangeGroup {
            info: ChangeGroupInfo {
                id: groups.len(),
                label: paths.join(" → "),
                paths,
            },
            ops,
        });
    }

    if groups.len() < 2 {
        return Err(AppError::Verify(format!(
            "This commit has {} applicable file change(s). Sub-commit bisect \
             needs at least two to narrow between.",
            groups.len()
        )));
    }
    if groups.len() > MAX_GROUPS {
        return Err(AppError::Verify(format!(
            "This commit changes {} files; the search is limited to {}.",
            groups.len(),
            MAX_GROUPS
        )));
    }

    materialize(&repo, &parent_tree, scratch.root())?;

    Ok(Plan {
        commit_id: commit.id().to_string(),
        parent_id: parent.id().to_string(),
        groups,
        skipped_paths,
        scratch,
    })
}

fn is_gitlink(mode: git2::FileMode) -> bool {
    mode == git2::FileMode::Commit
}

fn mode_of(mode: git2::FileMode) -> u32 {
    i32::from(mode) as u32
}

// ── Scratch checkout ─────────────────────────────────────────────────────────

/// A directory under the system temp dir, removed on drop — including on an
/// error return and on unwind. Never inside the user's repository.
pub struct Scratch {
    root: PathBuf,
}

impl Scratch {
    pub fn create() -> Result<Self, AppError> {
        let root = std::env::temp_dir().join(format!("gitbaro-bisect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_dir_all(&self.root) {
            tracing::warn!(
                "[verify] could not remove bisect scratch {}: {}",
                self.root.display(),
                e
            );
        }
    }
}

/// Reject anything that could escape `root`. Tree entries are well-formed in
/// practice; this is the defence for when they are not. Pure — no I/O.
fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let bad = relative.is_empty()
        || relative.starts_with('/')
        || relative.contains('\0')
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..");
    if bad {
        return Err(AppError::Verify(format!(
            "Refusing to write an unsafe path from the commit tree: {:?}",
            relative
        )));
    }
    Ok(root.join(relative))
}

/// `create_dir`, but never through a symlink.
fn ensure_dir(path: &Path) -> Result<(), AppError> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err(AppError::Verify(format!(
            "Refusing to descend through {} in the scratch checkout: it is not a \
             real directory.",
            path.display()
        ))),
        Err(_) => Ok(std::fs::create_dir(path)?),
    }
}

/// Resolve `relative` under `root`, creating its parent directories one
/// component at a time and refusing to pass through a symlink.
///
/// `create_dir_all` would happily follow one. That matters here: a commit that
/// replaces the symlink `a` with a directory `a/` produces two independent
/// change groups, and a subset containing only `a/b.txt` would otherwise write
/// through the still-present symlink — outside the scratch tree.
fn prepare_path(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let full = safe_join(root, relative)?;
    let parts: Vec<&str> = relative.split('/').collect();
    let mut current = root.to_path_buf();
    for part in &parts[..parts.len() - 1] {
        current.push(part);
        ensure_dir(&current)?;
    }
    Ok(full)
}

fn write_file(path: &Path, content: &[u8], mode: u32) -> Result<(), AppError> {
    // Remove first so an existing symlink is replaced instead of followed.
    let _ = std::fs::remove_file(path);

    #[cfg(unix)]
    if mode == SYMLINK_MODE {
        use std::os::unix::ffi::OsStrExt;
        let target = std::ffi::OsStr::from_bytes(content);
        std::os::unix::fs::symlink(target, path)?;
        return Ok(());
    }

    std::fs::write(path, content)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bits = if mode & 0o111 != 0 { 0o755 } else { 0o644 };
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(bits))?;
    }
    Ok(())
}

/// Write every blob of `tree` under `dest`. Hand-rolled rather than
/// `checkout_tree`, because libgit2's checkout reads and rewrites the
/// repository index and this must be provably read-only.
fn materialize(repo: &Repository, tree: &git2::Tree<'_>, dest: &Path) -> Result<(), AppError> {
    let mut failure: Option<AppError> = None;
    let mut files = 0usize;

    let walk = tree.walk(git2::TreeWalkMode::PreOrder, |root, entry| {
        let Some(name) = entry.name() else {
            return git2::TreeWalkResult::Ok;
        };
        let relative = format!("{}{}", root, name);

        let mut attempt = || -> Result<(), AppError> {
            match entry.kind() {
                Some(git2::ObjectType::Tree) => {
                    ensure_dir(&prepare_path(dest, &relative)?)?;
                }
                Some(git2::ObjectType::Blob) => {
                    files += 1;
                    if files > MAX_TREE_FILES {
                        return Err(AppError::Verify(format!(
                            "This tree has more than {} files — too large for a \
                             scratch checkout.",
                            MAX_TREE_FILES
                        )));
                    }
                    let content = blob_bytes(repo, entry.id())?;
                    write_file(
                        &prepare_path(dest, &relative)?,
                        &content,
                        entry.filemode() as u32,
                    )?;
                }
                // Submodule pointers have no content to write.
                _ => {}
            }
            Ok(())
        };

        match attempt() {
            Ok(()) => git2::TreeWalkResult::Ok,
            Err(e) => {
                failure = Some(e);
                git2::TreeWalkResult::Abort
            }
        }
    });

    if let Some(e) = failure {
        return Err(e);
    }
    walk?;
    Ok(())
}

fn apply_op(root: &Path, op: &FileOp) -> Result<(), AppError> {
    match &op.new {
        Some(content) => write_file(&prepare_path(root, &op.path)?, content, op.new_mode),
        None => remove(&safe_join(root, &op.path)?),
    }
}

fn revert_op(root: &Path, op: &FileOp) -> Result<(), AppError> {
    match &op.old {
        Some(content) => write_file(&prepare_path(root, &op.path)?, content, op.old_mode),
        None => remove(&safe_join(root, &op.path)?),
    }
}

fn remove(path: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

// ── Verification command ─────────────────────────────────────────────────────

struct CommandResult {
    passed: bool,
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u64,
    output_tail: String,
}

/// Run one verification command in the scratch checkout.
///
/// `evidence::runner` is not reusable here (its module is private), and the
/// needs differ: no progress streaming, and a timeout is `Inconclusive` rather
/// than a recorded failure. `kill_on_drop` plus dropping the future on timeout
/// is what guarantees no child outlives the search.
async fn run_command(
    dir: &Path,
    command: &str,
    timeout: Duration,
) -> Result<CommandResult, AppError> {
    use std::process::Stdio;

    let started = Instant::now();
    let child = tokio::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let waited = tokio::time::timeout(timeout, child.wait_with_output()).await;
    let duration_ms = started.elapsed().as_millis() as u64;

    match waited {
        Ok(output) => {
            let output = output?;
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            Ok(CommandResult {
                passed: output.status.success(),
                exit_code: output.status.code(),
                timed_out: false,
                duration_ms,
                output_tail: tail_chars(&text, MAX_OUTPUT_TAIL_CHARS),
            })
        }
        // The future owned the child; dropping it triggers `kill_on_drop`.
        Err(_) => Ok(CommandResult {
            passed: false,
            exit_code: None,
            timed_out: true,
            duration_ms,
            output_tail: format!("timed out after {}s", timeout.as_secs()),
        }),
    }
}

/// Keep the last `max` characters, on a char boundary.
fn tail_chars(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        return text.to_string();
    }
    text.chars().skip(count - max).collect()
}

// ── Delta-debugging search ───────────────────────────────────────────────────

/// Evaluates one subset of change-group ids. Implemented for real by
/// [`ScratchProbe`]; tests substitute a table-driven fake.
#[allow(async_fn_in_trait)]
pub trait SubsetProbe {
    async fn probe(&mut self, subset: &[usize]) -> RunOutcome;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Minimized {
    /// The smallest observed failing subset.
    pub subset: Vec<usize>,
    /// False when the search stopped early (abort), so `subset` is an upper
    /// bound rather than a 1-minimal answer.
    pub complete: bool,
    pub inconclusive: usize,
}

/// Partition `items` into `n` contiguous, near-equal chunks.
fn split(items: &[usize], n: usize) -> Vec<Vec<usize>> {
    let n = n.clamp(1, items.len().max(1));
    (0..n)
        .map(|i| {
            let start = items.len() * i / n;
            let end = items.len() * (i + 1) / n;
            items[start..end].to_vec()
        })
        .filter(|chunk| !chunk.is_empty())
        .collect()
}

fn without(items: &[usize], removed: &[usize]) -> Vec<usize> {
    let removed: BTreeSet<usize> = removed.iter().copied().collect();
    items.iter().copied().filter(|i| !removed.contains(i)).collect()
}

/// Zeller's minimizing delta debugging (ddmin), with memoized probes.
///
/// Degenerates to binary search when a single change is responsible, which is
/// the common case, but stays correct when two changes only fail together.
/// `Inconclusive` is never treated as a failure, so the search never narrows
/// into a subset it did not observe failing.
pub async fn minimize<P: SubsetProbe>(all: &[usize], probe: &mut P) -> Minimized {
    let mut memo: BTreeMap<Vec<usize>, RunOutcome> = BTreeMap::new();
    let mut inconclusive = 0usize;
    let mut current = all.to_vec();
    let mut granularity = 2usize;

    while current.len() >= 2 {
        let chunks = split(&current, granularity);
        let mut candidates: Vec<Vec<usize>> = chunks.clone();
        // Complements come second: shrinking to one chunk is the bigger win.
        candidates.extend(
            chunks
                .iter()
                .map(|chunk| without(&current, chunk))
                .filter(|complement| !complement.is_empty()),
        );

        let mut next: Option<(Vec<usize>, bool)> = None;
        for (index, candidate) in candidates.iter().enumerate() {
            let outcome = match memo.get(candidate) {
                Some(cached) => *cached,
                None => {
                    let outcome = probe.probe(candidate).await;
                    memo.insert(candidate.clone(), outcome);
                    if outcome == RunOutcome::Inconclusive {
                        inconclusive += 1;
                    }
                    outcome
                }
            };
            match outcome {
                RunOutcome::Aborted => {
                    return Minimized {
                        subset: current,
                        complete: false,
                        inconclusive,
                    }
                }
                RunOutcome::Fail => {
                    next = Some((candidate.clone(), index < chunks.len()));
                    break;
                }
                _ => {}
            }
        }

        match next {
            // A single chunk still fails: restart at the finest granularity.
            Some((subset, true)) => {
                current = subset;
                granularity = 2;
            }
            // A complement still fails: one chunk's worth of changes is
            // irrelevant, so granularity drops by one.
            Some((subset, false)) => {
                current = subset;
                granularity = granularity.saturating_sub(1).max(2);
            }
            None if granularity >= current.len() => break,
            None => granularity = (granularity * 2).min(current.len()),
        }
    }

    Minimized {
        subset: current,
        complete: true,
        inconclusive,
    }
}

// ── Driver ───────────────────────────────────────────────────────────────────

struct ScratchProbe<'a> {
    root: PathBuf,
    groups: &'a [ChangeGroup],
    applied: BTreeSet<usize>,
    command: String,
    run_timeout: Duration,
    deadline: Instant,
    max_runs: usize,
    cancel: Arc<AtomicBool>,
    runs: Vec<RunRecord>,
}

impl ScratchProbe<'_> {
    /// Bring the scratch tree to exactly `subset` by applying and reverting the
    /// difference against what is currently on disk.
    fn sync(&mut self, subset: &BTreeSet<usize>) -> Result<(), AppError> {
        for id in self.applied.difference(subset).copied().collect::<Vec<_>>() {
            for op in self.groups[id].ops.iter().rev() {
                revert_op(&self.root, op)?;
            }
            self.applied.remove(&id);
        }
        for id in subset.difference(&self.applied).copied().collect::<Vec<_>>() {
            for op in &self.groups[id].ops {
                apply_op(&self.root, op)?;
            }
            self.applied.insert(id);
        }
        Ok(())
    }

    fn stop_reason(&self) -> Option<&'static str> {
        if self.cancel.load(Ordering::Relaxed) {
            Some("cancelled")
        } else if Instant::now() >= self.deadline {
            Some("out of time")
        } else if self.runs.len() >= self.max_runs {
            Some("run ceiling reached")
        } else {
            None
        }
    }
}

impl SubsetProbe for ScratchProbe<'_> {
    async fn probe(&mut self, subset: &[usize]) -> RunOutcome {
        if let Some(reason) = self.stop_reason() {
            tracing::info!("[verify] sub-commit bisect stopped: {}", reason);
            return RunOutcome::Aborted;
        }

        let wanted: BTreeSet<usize> = subset.iter().copied().collect();
        if let Err(e) = self.sync(&wanted) {
            tracing::warn!("[verify] bisect could not stage a subset: {}", e);
            return RunOutcome::Inconclusive;
        }

        let remaining = self.deadline.saturating_duration_since(Instant::now());
        let record = match run_command(
            &self.root,
            &self.command,
            self.run_timeout.min(remaining),
        )
        .await
        {
            Ok(run) => RunRecord {
                group_ids: subset.to_vec(),
                outcome: match run {
                    _ if run.timed_out => RunOutcome::Inconclusive,
                    _ if run.passed => RunOutcome::Pass,
                    _ => RunOutcome::Fail,
                },
                duration_ms: run.duration_ms,
                exit_code: run.exit_code,
                output_tail: (!run.passed).then_some(run.output_tail),
            },
            Err(e) => {
                tracing::warn!("[verify] bisect run could not be executed: {}", e);
                RunRecord {
                    group_ids: subset.to_vec(),
                    outcome: RunOutcome::Inconclusive,
                    duration_ms: 0,
                    exit_code: None,
                    output_tail: None,
                }
            }
        };

        let outcome = record.outcome;
        self.runs.push(record);
        outcome
    }
}

/// Narrow a commit down to the minimal subset of its file changes that still
/// fails `request.command`.
///
/// Never writes to the user's repository. Returns `Err` only when the commit
/// cannot be planned at all (merge commit, too large, unreadable); an
/// inconclusive *search* is a [`BisectReport`] with an explaining verdict.
pub async fn run_bisect(
    request: BisectRequest,
    cancel: Arc<AtomicBool>,
) -> Result<BisectReport, AppError> {
    let started = Instant::now();
    let deadline = started + request.total_timeout;

    let planning = request.clone();
    let plan = tokio::task::spawn_blocking(move || plan(&planning, Scratch::create()?))
        .await
        .map_err(|e| AppError::Verify(format!("Bisect planning failed: {}", e)))??;

    if let Some(prepare) = &request.prepare_command {
        let outcome = run_command(plan.scratch.root(), prepare, request.run_timeout).await?;
        if !outcome.passed {
            return Ok(report(
                &plan,
                BisectVerdict::Aborted,
                format!(
                    "The preparation command exited {:?} in the scratch checkout, so \
                     no subset could be judged.",
                    outcome.exit_code
                ),
                Vec::new(),
                Vec::new(),
                0,
                started,
            ));
        }
    }

    let ids: Vec<usize> = (0..plan.groups.len()).collect();
    let mut probe = ScratchProbe {
        root: plan.scratch.root().to_path_buf(),
        groups: &plan.groups,
        applied: BTreeSet::new(),
        command: request.command.clone(),
        run_timeout: request.run_timeout,
        deadline,
        max_runs: request.max_runs,
        cancel,
        runs: Vec::new(),
    };

    // Baseline: the parent must pass and the whole commit must fail, or there
    // is nothing here to bisect.
    let (verdict, culprits) = match probe.probe(&[]).await {
        RunOutcome::Pass => match probe.probe(&ids).await {
            RunOutcome::Fail => {
                let minimized = minimize(&ids, &mut probe).await;
                let complement = without(&ids, &minimized.subset);
                // "Isolated" claims the *rest* of the commit is innocent, so it
                // is only ever stated after observing the complement pass.
                let verdict = if !minimized.complete {
                    BisectVerdict::Aborted
                } else if complement.is_empty() {
                    BisectVerdict::Isolated
                } else {
                    match probe.probe(&complement).await {
                        RunOutcome::Pass => BisectVerdict::Isolated,
                        RunOutcome::Fail => BisectVerdict::Interdependent,
                        _ => BisectVerdict::Aborted,
                    }
                };
                (verdict, minimized.subset)
            }
            RunOutcome::Aborted => (BisectVerdict::Aborted, Vec::new()),
            _ => (BisectVerdict::CommitPasses, Vec::new()),
        },
        RunOutcome::Fail => (BisectVerdict::ParentAlreadyFails, Vec::new()),
        _ => (BisectVerdict::Aborted, Vec::new()),
    };

    let inconclusive = probe
        .runs
        .iter()
        .filter(|r| r.outcome == RunOutcome::Inconclusive)
        .count();
    let paths: Vec<String> = culprits
        .iter()
        .flat_map(|id| plan.groups[*id].info.paths.clone())
        .collect();
    let explanation = explain(verdict, &paths, probe.runs.len());
    let runs = std::mem::take(&mut probe.runs);
    drop(probe);

    Ok(report(
        &plan,
        verdict,
        explanation,
        culprits,
        runs,
        inconclusive,
        started,
    ))
}

fn report(
    plan: &Plan,
    verdict: BisectVerdict,
    explanation: String,
    culprit_group_ids: Vec<usize>,
    runs: Vec<RunRecord>,
    inconclusive_runs: usize,
    started: Instant,
) -> BisectReport {
    BisectReport {
        commit_id: plan.commit_id.clone(),
        parent_id: plan.parent_id.clone(),
        verdict,
        explanation,
        groups: plan.groups.iter().map(|g| g.info.clone()).collect(),
        culprit_paths: culprit_group_ids
            .iter()
            .flat_map(|id| plan.groups[*id].info.paths.clone())
            .collect(),
        culprit_group_ids,
        runs,
        inconclusive_runs,
        skipped_paths: plan.skipped_paths.clone(),
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

fn explain(verdict: BisectVerdict, paths: &[String], runs: usize) -> String {
    match verdict {
        BisectVerdict::Isolated => format!(
            "{} of the commit's file changes reproduce the failure on their own, \
             and the rest pass without them ({} runs): {}",
            paths.len(),
            runs,
            paths.join(", ")
        ),
        BisectVerdict::Interdependent => format!(
            "The smallest failing subset is {}, but the remaining changes fail too. \
             The changes are interdependent, or there is more than one cause — a \
             single file cannot be blamed.",
            paths.join(", ")
        ),
        BisectVerdict::ParentAlreadyFails => "The command already fails on the \
             parent commit in a clean scratch checkout. Either the cause predates \
             this commit, or the checkout is missing build dependencies — set a \
             preparation command and try again."
            .to_string(),
        BisectVerdict::CommitPasses => "The command passes with every change of \
             this commit applied, so there is nothing to narrow down here."
            .to_string(),
        BisectVerdict::Aborted if paths.is_empty() => format!(
            "The search stopped after {} runs without reaching a conclusion \
             (cancelled, out of time, or out of runs).",
            runs
        ),
        BisectVerdict::Aborted => format!(
            "The search stopped after {} runs before the answer could be confirmed. \
             The smallest subset observed failing so far is {} — an upper bound, \
             not a conclusion.",
            runs,
            paths.join(", ")
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── subset splitting ──────────────────────────────────────────────────

    #[test]
    fn split_partitions_without_losing_or_duplicating() {
        let items: Vec<usize> = (0..7).collect();
        for n in 1..=9 {
            let chunks = split(&items, n);
            let flat: Vec<usize> = chunks.iter().flatten().copied().collect();
            assert_eq!(flat, items, "n={} must cover every id in order", n);
            assert!(chunks.iter().all(|c| !c.is_empty()));
        }
        assert_eq!(split(&items, 2), vec![vec![0, 1, 2], vec![3, 4, 5, 6]]);
        assert_eq!(split(&[], 3), Vec::<Vec<usize>>::new());
    }

    #[test]
    fn without_removes_exactly_the_named_ids() {
        assert_eq!(without(&[0, 1, 2, 3], &[1, 3]), vec![0, 2]);
        assert_eq!(without(&[0, 1], &[]), vec![0, 1]);
        assert_eq!(without(&[0, 1], &[0, 1]), Vec::<usize>::new());
    }

    // ── search ────────────────────────────────────────────────────────────

    /// Fails exactly when the subset contains every id in `culprits`.
    struct FakeProbe {
        culprits: BTreeSet<usize>,
        calls: Vec<Vec<usize>>,
        abort_after: Option<usize>,
        inconclusive: BTreeSet<usize>,
    }

    impl FakeProbe {
        fn new(culprits: &[usize]) -> Self {
            Self {
                culprits: culprits.iter().copied().collect(),
                calls: Vec::new(),
                abort_after: None,
                inconclusive: BTreeSet::new(),
            }
        }
    }

    impl SubsetProbe for FakeProbe {
        async fn probe(&mut self, subset: &[usize]) -> RunOutcome {
            if self.abort_after.is_some_and(|n| self.calls.len() >= n) {
                return RunOutcome::Aborted;
            }
            self.calls.push(subset.to_vec());
            let set: BTreeSet<usize> = subset.iter().copied().collect();
            if !self.inconclusive.is_empty() && set == self.inconclusive {
                return RunOutcome::Inconclusive;
            }
            if self.culprits.is_subset(&set) {
                RunOutcome::Fail
            } else {
                RunOutcome::Pass
            }
        }
    }

    fn ids(n: usize) -> Vec<usize> {
        (0..n).collect()
    }

    #[tokio::test]
    async fn isolates_a_single_culprit() {
        for culprit in 0..8 {
            let mut probe = FakeProbe::new(&[culprit]);
            let result = minimize(&ids(8), &mut probe).await;
            assert_eq!(result.subset, vec![culprit]);
            assert!(result.complete);
            assert!(
                probe.calls.len() < 8,
                "a single culprit must cost fewer probes than a linear scan, got {}",
                probe.calls.len()
            );
        }
    }

    #[tokio::test]
    async fn isolates_a_pair_that_only_fails_together() {
        let mut probe = FakeProbe::new(&[1, 6]);
        let result = minimize(&ids(8), &mut probe).await;
        assert_eq!(result.subset, vec![1, 6]);
        assert!(result.complete);
    }

    #[tokio::test]
    async fn keeps_the_whole_set_when_every_change_is_needed() {
        let mut probe = FakeProbe::new(&[0, 1, 2, 3]);
        let result = minimize(&ids(4), &mut probe).await;
        assert_eq!(result.subset, ids(4));
        assert!(result.complete);
    }

    #[tokio::test]
    async fn never_probes_the_same_subset_twice() {
        let mut probe = FakeProbe::new(&[2, 5]);
        minimize(&ids(9), &mut probe).await;
        let mut seen = BTreeSet::new();
        for call in &probe.calls {
            assert!(seen.insert(call.clone()), "re-probed {:?}", call);
        }
    }

    #[tokio::test]
    async fn an_inconclusive_subset_is_never_narrowed_into() {
        let mut probe = FakeProbe::new(&[3]);
        probe.inconclusive = [3].into_iter().collect();
        let result = minimize(&ids(4), &mut probe).await;
        assert_eq!(result.inconclusive, 1);
        assert!(
            result.subset.contains(&3) && result.subset.len() > 1,
            "an unobserved failure must not be reported as the minimal set"
        );
    }

    #[tokio::test]
    async fn aborting_reports_an_incomplete_result() {
        let mut probe = FakeProbe::new(&[4]);
        probe.abort_after = Some(1);
        let result = minimize(&ids(8), &mut probe).await;
        assert!(!result.complete, "an aborted search is an upper bound only");
    }

    // ── path safety ───────────────────────────────────────────────────────

    #[test]
    fn unsafe_tree_paths_are_refused() {
        let root = Path::new("/tmp/scratch");
        assert!(safe_join(root, "src/a.rs").is_ok());
        for bad in ["../escape", "a/../../b", "/etc/passwd", "", "a//b", "a/./b"] {
            assert!(safe_join(root, bad).is_err(), "{:?} must be refused", bad);
        }
    }

    #[test]
    fn writing_never_descends_through_a_symlink() {
        let scratch = Scratch::create().expect("scratch");
        let outside = Scratch::create().expect("outside");
        // The shape a commit that replaces a symlink with a directory produces:
        // the "delete the symlink" half may be in a different subset.
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.root(), scratch.root().join("link"))
            .expect("symlink");

        let err = prepare_path(scratch.root(), "link/payload.txt").expect_err("refuse");
        assert!(err.to_string().contains("not a real directory"));
        assert!(!outside.root().join("payload.txt").exists());

        // A plain nested path still works.
        let ok = prepare_path(scratch.root(), "a/b/c.txt").expect("prepare");
        write_file(&ok, b"x", 0o100644).expect("write");
        assert!(scratch.root().join("a/b/c.txt").is_file());
    }

    // ── plan + materialize against a synthetic repository ─────────────────

    struct TempRepo {
        dir: PathBuf,
    }

    impl TempRepo {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("gitbaro-bisect-repo-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).expect("create repo dir");
            Self { dir }
        }

        fn commit(&self, repo: &Repository, files: &[(&str, &str)], message: &str) -> git2::Oid {
            for (name, body) in files {
                let path = self.dir.join(name);
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).expect("mkdir");
                }
                std::fs::write(path, body).expect("write");
            }
            let mut index = repo.index().expect("index");
            index
                .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
                .expect("add");
            // `add_all` does not stage deletions of tracked files.
            index.update_all(["*"], None).expect("update");
            index.write().expect("write index");
            let tree = repo.find_tree(index.write_tree().expect("tree")).expect("tree");
            let sig = git2::Signature::now("T", "t@example.com").expect("sig");
            let parents: Vec<git2::Commit> = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_commit().ok())
                .into_iter()
                .collect();
            let refs: Vec<&git2::Commit> = parents.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &refs)
                .expect("commit")
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// `Plan` holds raw blob bytes, so it deliberately has no `Debug`;
    /// `expect_err` would require one.
    fn plan_err(request: &BisectRequest) -> AppError {
        match plan(request, Scratch::create().expect("scratch")) {
            Ok(_) => panic!("planning should have been refused"),
            Err(e) => e,
        }
    }

    #[test]
    fn planning_groups_changes_and_materializes_the_parent_only() {
        let fixture = TempRepo::new();
        let repo = Repository::init(&fixture.dir).expect("init");
        fixture.commit(
            &repo,
            &[("a.txt", "one\n"), ("b.txt", "two\n"), ("keep.txt", "k\n")],
            "base",
        );
        std::fs::remove_file(fixture.dir.join("b.txt")).expect("rm");
        let head = fixture.commit(
            &repo,
            &[("a.txt", "ONE\n"), ("c.txt", "three\n")],
            "change three things",
        );
        drop(repo);

        let request = BisectRequest::new(
            fixture.dir.clone(),
            head.to_string(),
            "true".to_string(),
        );
        let scratch = Scratch::create().expect("scratch");
        let scratch_root = scratch.root().to_path_buf();
        let plan = plan(&request, scratch).expect("plan");

        let labels: Vec<&str> = plan.groups.iter().map(|g| g.info.label.as_str()).collect();
        assert_eq!(labels, vec!["a.txt", "b.txt", "c.txt"]);
        assert!(plan.skipped_paths.is_empty());

        // The scratch holds the parent tree, not the commit.
        assert_eq!(
            std::fs::read_to_string(scratch_root.join("a.txt")).expect("read"),
            "one\n"
        );
        assert!(scratch_root.join("b.txt").exists());
        assert!(!scratch_root.join("c.txt").exists());

        // The user's working tree is untouched by planning.
        assert_eq!(
            std::fs::read_to_string(fixture.dir.join("a.txt")).expect("read"),
            "ONE\n"
        );

        // Applying then reverting one group round-trips the scratch tree.
        let group = &plan.groups[0];
        for op in &group.ops {
            apply_op(&scratch_root, op).expect("apply");
        }
        assert_eq!(
            std::fs::read_to_string(scratch_root.join("a.txt")).expect("read"),
            "ONE\n"
        );
        for op in group.ops.iter().rev() {
            revert_op(&scratch_root, op).expect("revert");
        }
        assert_eq!(
            std::fs::read_to_string(scratch_root.join("a.txt")).expect("read"),
            "one\n"
        );

        drop(plan);
        assert!(!scratch_root.exists(), "scratch is removed on drop");
    }

    #[test]
    fn a_merge_commit_is_refused_before_anything_is_written() {
        let fixture = TempRepo::new();
        let repo = Repository::init(&fixture.dir).expect("init");
        let base = fixture.commit(&repo, &[("a.txt", "one\n")], "base");
        let merge = {
            let sig = git2::Signature::now("T", "t@example.com").expect("sig");
            let base_commit = repo.find_commit(base).expect("commit");
            let tree = base_commit.tree().expect("tree");
            // A synthetic two-parent commit is enough to exercise the guard.
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                "merge",
                &tree,
                &[&base_commit, &base_commit],
            )
            .expect("merge commit")
        };
        drop(repo);

        let request =
            BisectRequest::new(fixture.dir.clone(), merge.to_string(), "true".to_string());
        let err = plan_err(&request);
        assert!(err.to_string().contains("one parent"));
    }

    #[test]
    fn a_rename_travels_as_one_group() {
        let fixture = TempRepo::new();
        let repo = Repository::init(&fixture.dir).expect("init");
        fixture.commit(
            &repo,
            &[("old.txt", "body\n"), ("other.txt", "x\n")],
            "base",
        );
        std::fs::remove_file(fixture.dir.join("old.txt")).expect("rm");
        let head = fixture.commit(
            &repo,
            &[("new.txt", "body\n"), ("other.txt", "y\n")],
            "rename plus an edit",
        );
        drop(repo);

        let request =
            BisectRequest::new(fixture.dir.clone(), head.to_string(), "true".to_string());
        let scratch = Scratch::create().expect("scratch");
        let root = scratch.root().to_path_buf();
        let plan = plan(&request, scratch).expect("plan");

        let rename = plan
            .groups
            .iter()
            .find(|g| g.info.paths.contains(&"new.txt".to_string()))
            .expect("rename group");
        assert_eq!(
            rename.info.paths,
            vec!["old.txt".to_string(), "new.txt".to_string()],
            "both halves of a rename must be one atom"
        );

        for op in &rename.ops {
            apply_op(&root, op).expect("apply");
        }
        assert!(!root.join("old.txt").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("new.txt")).expect("read"),
            "body\n"
        );
        for op in rename.ops.iter().rev() {
            revert_op(&root, op).expect("revert");
        }
        assert!(root.join("old.txt").exists());
        assert!(!root.join("new.txt").exists());
    }

    #[tokio::test]
    async fn end_to_end_isolates_the_one_change_that_breaks_the_command() {
        let fixture = TempRepo::new();
        let repo = Repository::init(&fixture.dir).expect("init");
        fixture.commit(
            &repo,
            &[("a.txt", "ok\n"), ("b.txt", "ok\n"), ("c.txt", "ok\n")],
            "base",
        );
        let head = fixture.commit(
            &repo,
            &[("a.txt", "fine\n"), ("b.txt", "BAD\n"), ("c.txt", "fine\n")],
            "three edits, one of them broken",
        );
        drop(repo);

        let mut request = BisectRequest::new(
            fixture.dir.clone(),
            head.to_string(),
            "! grep -rq BAD .".to_string(),
        );
        request.run_timeout = Duration::from_secs(30);
        request.total_timeout = Duration::from_secs(120);

        let report = run_bisect(request, Arc::new(AtomicBool::new(false)))
            .await
            .expect("bisect");

        assert_eq!(report.verdict, BisectVerdict::Isolated);
        assert_eq!(report.culprit_paths, vec!["b.txt".to_string()]);
        assert_eq!(report.inconclusive_runs, 0);
        assert!(report.runs.len() >= 3, "baseline, full commit, then narrowing");

        // The single reason this feature is allowed to exist.
        assert_eq!(
            std::fs::read_to_string(fixture.dir.join("b.txt")).expect("read"),
            "BAD\n",
            "the user's working tree must be exactly as they left it"
        );
        assert!(fixture.dir.join(".git").is_dir());
    }

    #[tokio::test]
    async fn a_command_that_already_fails_on_the_parent_is_reported_as_such() {
        let fixture = TempRepo::new();
        let repo = Repository::init(&fixture.dir).expect("init");
        fixture.commit(&repo, &[("a.txt", "x\n"), ("b.txt", "x\n")], "base");
        let head = fixture.commit(&repo, &[("a.txt", "y\n"), ("b.txt", "y\n")], "edits");
        drop(repo);

        let report = run_bisect(
            BisectRequest::new(fixture.dir.clone(), head.to_string(), "false".to_string()),
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .expect("bisect");

        assert_eq!(report.verdict, BisectVerdict::ParentAlreadyFails);
        assert!(report.culprit_paths.is_empty());
        assert_eq!(report.runs.len(), 1, "no point probing further");
    }

    #[tokio::test]
    async fn a_cancelled_search_stops_before_running_anything() {
        let fixture = TempRepo::new();
        let repo = Repository::init(&fixture.dir).expect("init");
        fixture.commit(&repo, &[("a.txt", "x\n"), ("b.txt", "x\n")], "base");
        let head = fixture.commit(&repo, &[("a.txt", "y\n"), ("b.txt", "y\n")], "edits");
        drop(repo);

        let report = run_bisect(
            BisectRequest::new(fixture.dir.clone(), head.to_string(), "true".to_string()),
            Arc::new(AtomicBool::new(true)),
        )
        .await
        .expect("bisect");

        assert_eq!(report.verdict, BisectVerdict::Aborted);
        assert!(report.runs.is_empty());
    }

    #[test]
    fn a_commit_with_a_single_change_is_refused_as_not_worth_bisecting() {
        let fixture = TempRepo::new();
        let repo = Repository::init(&fixture.dir).expect("init");
        fixture.commit(&repo, &[("a.txt", "one\n")], "base");
        let head = fixture.commit(&repo, &[("a.txt", "two\n")], "one file");
        drop(repo);

        let request =
            BisectRequest::new(fixture.dir.clone(), head.to_string(), "true".to_string());
        let err = plan_err(&request);
        assert!(err.to_string().contains("at least two"));
    }
}
