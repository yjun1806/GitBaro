//! § What is affected — the call sites this session changed the shape of, and
//! did not visit.
//!
//! The whole section rests on the tree-sitter symbol index, and the index is
//! built only when the user asks for it. So the first thing this module decides
//! is whether it is allowed to speak at all: **no index, or a partial one, ends
//! in `unavailable` — never in an empty entry list.** An empty list reads as
//! "nothing is affected", which is a claim we have no basis to make.

use std::collections::BTreeSet;
use std::path::Path;

use git2::{Repository, Tree};

use crate::verify::context::{blast_radius, changed_symbols, FileRevision, IndexState, RepoIndex};
use crate::verify::structural::MAX_STRUCTURAL_BYTES;

use super::did::CommitSnapshot;
use super::model::{ImpactBasis, ImpactSection, Provenance, Unavailable, UnavailableReason};
use super::MAX_IMPACT_ENTRIES;

/// Everything the section needs, so the caller decides the baseline once.
pub struct ImpactInput<'a> {
    pub repo: &'a Repository,
    pub repo_root: &'a Path,
    /// Repository-relative paths the session edited.
    pub session_paths: &'a BTreeSet<String>,
    /// Attributed commits, newest first. Empty ⇒ worktree fallback.
    pub attributed: &'a [&'a CommitSnapshot],
    pub index: Option<&'a RepoIndex>,
    pub index_state: IndexState,
    /// The assembly budget already ran out; report that rather than spend more.
    pub over_budget: bool,
}

pub fn build(input: &ImpactInput<'_>) -> ImpactSection {
    let basis = if input.attributed.is_empty() {
        ImpactBasis::WorktreeFallback
    } else {
        ImpactBasis::AttributedCommitRange
    };

    if input.over_budget {
        return empty(
            Unavailable::with_detail(
                UnavailableReason::ParseBudget,
                "the report budget ran out before the blast radius was computed",
            ),
            input.index_state,
            basis,
        );
    }

    let Some(index) = usable_index(input.index) else {
        return empty(missing_index(input.index), input.index_state, basis);
    };

    let revisions = match basis {
        ImpactBasis::AttributedCommitRange => commit_range_revisions(input),
        ImpactBasis::WorktreeFallback => worktree_revisions(input),
    };
    let changes = changed_symbols(&revisions);

    if changes.signature_changed.is_empty() {
        return empty(
            Unavailable::with_detail(
                UnavailableReason::NotApplicable,
                "no function or method signature changed in this session",
            ),
            input.index_state,
            basis,
        );
    }

    // A signature change whose callers were all updated in the same work has
    // nothing to say — the section only carries what was left behind.
    let mut entries: Vec<_> = blast_radius(&changes, index)
        .into_iter()
        .filter(|entry| entry.untouched_caller_count > 0)
        .collect();
    entries.sort_by(|a, b| {
        b.untouched_caller_count
            .cmp(&a.untouched_caller_count)
            .then_with(|| a.file.cmp(&b.file))
            .then_with(|| a.symbol.cmp(&b.symbol))
    });

    let total_untouched_callers = entries
        .iter()
        .map(|entry| entry.untouched_caller_count)
        .sum();
    entries.truncate(MAX_IMPACT_ENTRIES);

    if entries.is_empty() {
        return empty(
            Unavailable::with_detail(
                UnavailableReason::NotApplicable,
                "every caller of the changed signatures was updated in the same work",
            ),
            input.index_state,
            basis,
        );
    }

    ImpactSection {
        unavailable: None,
        entries,
        total_untouched_callers,
        index_state: input.index_state,
        basis,
        provenance: Provenance::SymbolIndex,
    }
}

fn empty(reason: Unavailable, index_state: IndexState, basis: ImpactBasis) -> ImpactSection {
    ImpactSection {
        unavailable: Some(reason),
        entries: Vec::new(),
        total_untouched_callers: 0,
        index_state,
        basis,
        provenance: Provenance::SymbolIndex,
    }
}

/// A partial index is treated as identical to an absent one, matching what the
/// context rules already do (`context::collect_context_rules`).
fn usable_index(index: Option<&RepoIndex>) -> Option<&RepoIndex> {
    index.filter(|index| index.complete && !index.is_empty())
}

fn missing_index(index: Option<&RepoIndex>) -> Unavailable {
    match index {
        None => Unavailable::with_detail(
            UnavailableReason::NoSymbolIndex,
            "no symbol index has been built for this repository",
        ),
        Some(index) if index.is_empty() => Unavailable::with_detail(
            UnavailableReason::NoSymbolIndex,
            "the symbol index is empty",
        ),
        Some(index) => Unavailable::with_detail(
            UnavailableReason::PartialSymbolIndex,
            format!(
                "symbol index is partial ({} of {} file(s) indexed)",
                index.file_count(),
                index.files_total.max(index.file_count())
            ),
        ),
    }
}

/// Oldest attributed commit's first parent → newest attributed commit.
///
/// Renames inside the range are not chained: a file that moved reads as an
/// addition on the new path, so its symbols land in `added` rather than
/// `signature_changed`. That under-reports, which is the safe direction here.
fn commit_range_revisions(input: &ImpactInput<'_>) -> Vec<FileRevision> {
    let newest = input.attributed[0];
    let oldest = input.attributed[input.attributed.len() - 1];

    let head_tree = input
        .repo
        .find_commit_by_prefix(&newest.oid)
        .ok()
        .and_then(|commit| commit.tree().ok());
    let base_tree = input
        .repo
        .find_commit_by_prefix(&oldest.oid)
        .ok()
        .and_then(|commit| commit.parent(0).ok())
        .and_then(|parent| parent.tree().ok());

    let paths: BTreeSet<String> = input
        .attributed
        .iter()
        .flat_map(|facts| facts.files.iter().map(|file| file.path.clone()))
        .collect();

    paths
        .into_iter()
        .map(|path| FileRevision {
            old_source: base_tree
                .as_ref()
                .and_then(|tree| blob_text(input.repo, tree, &path)),
            new_source: head_tree
                .as_ref()
                .and_then(|tree| blob_text(input.repo, tree, &path)),
            path,
        })
        .collect()
}

/// `HEAD` against the working tree, narrowed to the paths the session edited.
///
/// Anything else the working tree carries belongs to other work, so it is left
/// out — but changes made to *these* paths after the session still leak in, and
/// the `WorktreeFallback` basis exists so the UI can say so.
fn worktree_revisions(input: &ImpactInput<'_>) -> Vec<FileRevision> {
    let head_tree = input
        .repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_tree().ok());

    input
        .session_paths
        .iter()
        .map(|path| FileRevision {
            old_source: head_tree
                .as_ref()
                .and_then(|tree| blob_text(input.repo, tree, path)),
            new_source: read_capped(&input.repo_root.join(path)),
            path: path.clone(),
        })
        .collect()
}

fn blob_text(repo: &Repository, tree: &Tree<'_>, path: &str) -> Option<String> {
    let entry = tree.get_path(Path::new(path)).ok()?;
    let blob = repo.find_blob(entry.id()).ok()?;
    let content = blob.content();
    if content.len() > MAX_STRUCTURAL_BYTES {
        return None;
    }
    std::str::from_utf8(content).ok().map(str::to_string)
}

fn read_capped(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_STRUCTURAL_BYTES as u64 {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::index::fixture::index_from_sources;
    use crate::verify::hygiene::test_support::TempRepo;
    use crate::verify::report::did::collect_commit_snapshots;

    const CALLEE_BEFORE: &str = "export function fetchUser(id: string) { return id; }\n";
    const CALLEE_AFTER: &str =
        "export function fetchUser(id: string, force: boolean) { return id; }\n";
    const CALLER: &str =
        "import { fetchUser } from \"./user\";\nexport function useUser(id: string) {\n  return fetchUser(id);\n}\n";

    fn caller_index() -> RepoIndex {
        index_from_sources(&[
            ("src/api/user.ts", CALLEE_AFTER),
            ("src/api/queries.ts", CALLER),
        ])
    }

    fn signature_change_repo() -> (TempRepo, Vec<CommitSnapshot>) {
        let temp = TempRepo::new();
        temp.commit(
            "feat: seed",
            &[("src/api/user.ts", CALLEE_BEFORE), ("src/api/queries.ts", CALLER)],
        );
        temp.commit("feat: widen", &[("src/api/user.ts", CALLEE_AFTER)]);
        let facts = collect_commit_snapshots(&temp.repo, 10).expect("facts");
        (temp, facts)
    }

    fn input<'a>(
        temp: &'a TempRepo,
        attributed: &'a [&'a CommitSnapshot],
        index: Option<&'a RepoIndex>,
        paths: &'a BTreeSet<String>,
    ) -> ImpactInput<'a> {
        ImpactInput {
            repo: &temp.repo,
            repo_root: &temp.dir,
            session_paths: paths,
            attributed,
            index,
            index_state: if index.is_some() {
                IndexState::Ready
            } else {
                IndexState::Idle
            },
            over_budget: false,
        }
    }

    #[test]
    fn without_an_index_the_section_says_so_instead_of_listing_nothing() {
        let (temp, facts) = signature_change_repo();
        let attributed = vec![&facts[0]];
        let paths = BTreeSet::new();
        let section = build(&input(&temp, &attributed, None, &paths));

        assert!(section.entries.is_empty());
        let reason = section.unavailable.expect("reason");
        assert_eq!(reason.reason, UnavailableReason::NoSymbolIndex);
        assert!(reason.detail.expect("detail").contains("no symbol index"));
        assert_eq!(section.index_state, IndexState::Idle);
    }

    #[test]
    fn a_partial_index_is_reported_as_partial_not_as_a_clean_result() {
        let (temp, facts) = signature_change_repo();
        let mut index = caller_index();
        index.complete = false;
        index.files_total = 500;
        let attributed = vec![&facts[0]];
        let paths = BTreeSet::new();
        let section = build(&input(&temp, &attributed, Some(&index), &paths));

        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::PartialSymbolIndex
        );
    }

    #[test]
    fn an_attributed_commit_range_finds_the_caller_the_session_never_visited() {
        let (temp, facts) = signature_change_repo();
        let index = caller_index();
        let attributed = vec![&facts[0]];
        let paths = BTreeSet::new();
        let section = build(&input(&temp, &attributed, Some(&index), &paths));

        assert!(section.unavailable.is_none(), "{:?}", section.unavailable);
        assert_eq!(section.basis, ImpactBasis::AttributedCommitRange);
        assert_eq!(section.entries.len(), 1);
        assert_eq!(section.entries[0].symbol, "fetchUser");
        assert_eq!(section.total_untouched_callers, 1);
    }

    #[test]
    fn a_signature_change_whose_callers_all_moved_reports_nothing_to_say() {
        let temp = TempRepo::new();
        let updated_caller = CALLER.replace("fetchUser(id)", "fetchUser(id, true)");
        temp.commit(
            "feat: seed",
            &[("src/api/user.ts", CALLEE_BEFORE), ("src/api/queries.ts", CALLER)],
        );
        temp.commit(
            "feat: widen",
            &[
                ("src/api/user.ts", CALLEE_AFTER),
                ("src/api/queries.ts", &updated_caller),
            ],
        );
        let facts = collect_commit_snapshots(&temp.repo, 10).expect("facts");
        let index = caller_index();
        let attributed = vec![&facts[0]];
        let paths = BTreeSet::new();
        let section = build(&input(&temp, &attributed, Some(&index), &paths));

        assert!(section.entries.is_empty());
        assert_eq!(
            section.unavailable.expect("reason").reason,
            UnavailableReason::NotApplicable
        );
    }

    #[test]
    fn without_attribution_the_working_tree_is_the_baseline() {
        let temp = TempRepo::new();
        temp.commit(
            "feat: seed",
            &[("src/api/user.ts", CALLEE_BEFORE), ("src/api/queries.ts", CALLER)],
        );
        std::fs::create_dir_all(temp.dir.join("src/api")).expect("mkdir");
        std::fs::write(temp.dir.join("src/api/user.ts"), CALLEE_AFTER).expect("write");

        let index = caller_index();
        let paths: BTreeSet<String> = ["src/api/user.ts".to_string()].into_iter().collect();
        let section = build(&input(&temp, &[], Some(&index), &paths));

        assert_eq!(section.basis, ImpactBasis::WorktreeFallback);
        assert_eq!(section.entries.len(), 1);
        assert_eq!(section.entries[0].symbol, "fetchUser");
    }

    #[test]
    fn an_exhausted_budget_is_reported_rather_than_silently_skipped() {
        let (temp, facts) = signature_change_repo();
        let index = caller_index();
        let attributed = vec![&facts[0]];
        let paths = BTreeSet::new();
        let mut over = input(&temp, &attributed, Some(&index), &paths);
        over.over_budget = true;

        assert_eq!(
            build(&over).unavailable.expect("reason").reason,
            UnavailableReason::ParseBudget
        );
    }
}
