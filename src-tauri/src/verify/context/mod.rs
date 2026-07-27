// SPDX-License-Identifier: GPL-3.0-or-later
//! Codebase context rules — V7 (reinvented function), V8 (orphan code) and
//! V9 (blast radius), plus the symbol index all three read.
//!
//! Three invariants, in priority order:
//!
//! 1. **No index is not "clean".** Every rule here needs a repository-wide
//!    symbol index. When it is absent or partial the rule emits
//!    `ScanLimit{MissingArtifact}` and zero findings (contract §7-①).
//! 2. **Under-report rather than over-report.** Name-based resolution cannot be
//!    complete — dynamic imports, string dispatch and macros are invisible to
//!    it. Every exclusion rule here exists because a false "this is dead code"
//!    costs more trust than a missed one.
//! 3. **Indexing never blocks the UI.** [`build::build_index`] is a blocking
//!    function the command layer runs inside `spawn_blocking`; it checks a
//!    [`cancel::CancelToken`] before every file and reports progress through a
//!    callback so cancelling is instant and a large repository is never a
//!    frozen window (spec §7-④).

pub mod build;
pub mod cache;
pub mod cancel;
pub mod changes;
pub mod extract;
pub mod index;
pub mod lang;
pub mod model;
pub mod reach;
pub mod reinvent;
pub mod store;
pub mod tokens;

use crate::verify::config::RuleConfig;
use crate::verify::rules::RuleOutcome;
use crate::verify::types::{FindingKind, ScanLimit, UncheckedReason};

pub use build::{build_index, BuildOutcome, IndexPhase, IndexProgress};
pub use cancel::CancelToken;
pub use changes::{changed_symbols, ChangeSet, ChangedSymbol, FileRevision};
pub use index::RepoIndex;
pub use model::{
    FileStamp, FileSymbols, Span, SymbolKind, SymbolRecord, SyntaxLanguage,
};
pub use reach::{blast_radius, BlastRadiusEntry, CallSite, CallerResolution};
pub use store::{IndexState, SymbolIndexStatus, SymbolIndexStore};

// ── Budgets (design §2.3) ────────────────────────────────────────────────────

/// Hand-written source does not exceed 1 MiB. Anything larger is a bundle, a
/// generated file or a minified blob, and parsing it buys nothing.
pub const MAX_SOURCE_BYTES: u64 = 1024 * 1024;
/// Hard ceiling on indexed files, so a pathological repository cannot pin a
/// worker forever.
pub const MAX_INDEXED_FILES: usize = 50_000;
pub const MAX_SYMBOLS_PER_FILE: usize = 2_000;
pub const MAX_REFERENCES_PER_FILE: usize = 20_000;
pub const MAX_CALLS_PER_SYMBOL: usize = 256;
/// Whole-build wall clock. Exceeding it finishes with a *partial* index, which
/// is a limit, not an error.
pub const MAX_INDEX_MILLIS: u64 = 120_000;
/// Symbols below this token count are never clone candidates — getters and
/// one-line wrappers are supposed to look alike.
pub const MIN_CLONE_TOKENS: u32 = 40;
pub const PROGRESS_THROTTLE_MILLIS: u64 = 100;
/// Progress is also reported every this many files, so a repository of small
/// files still shows movement inside one throttle window.
pub const PROGRESS_STEP_FILES: usize = 100;

/// The kinds this module owns. The runner uses it for on/off accounting.
pub const KINDS: &[FindingKind] = &[
    FindingKind::ReinventedFunction,
    FindingKind::OrphanCode,
    FindingKind::BlastRadius,
];

/// Everything the three rules read. Assembled by the command layer; every field
/// is optional-by-absence so a missing index degrades to limits, not errors.
pub struct ContextInput<'a> {
    /// Absolute repository root, used only by V8's text-confirmation pass.
    /// `None` skips that pass and is recorded in the finding detail.
    pub repo_root: Option<&'a std::path::Path>,
    pub changes: &'a ChangeSet,
    /// `None` when no index has been built for this repository yet.
    pub index: Option<&'a RepoIndex>,
}

/// Run V7 · V8 · V9 and return the raw outcome. The caller merges this with the
/// static diff outcome and fills registry coverage exactly once (design §9.2).
pub fn collect_context_rules(input: &ContextInput<'_>, config: &RuleConfig) -> RuleOutcome {
    let mut outcome = RuleOutcome::new();

    let enabled: Vec<FindingKind> = KINDS
        .iter()
        .copied()
        .filter(|kind| {
            if config.is_enabled(kind.rule_id()) {
                true
            } else {
                outcome.limits.push(ScanLimit {
                    rule_id: kind.rule_id().to_string(),
                    reason: UncheckedReason::Disabled,
                    detail: None,
                });
                false
            }
        })
        .collect();

    if enabled.is_empty() {
        return outcome;
    }

    let Some(index) = input.index.filter(|index| index.complete && !index.is_empty()) else {
        for kind in enabled {
            outcome.limit(
                kind,
                UncheckedReason::MissingArtifact,
                Some(describe_missing_index(input.index)),
            );
        }
        return outcome;
    };

    if enabled.contains(&FindingKind::ReinventedFunction) {
        outcome.merge(reinvent::run(input.changes, index));
    }
    if enabled.contains(&FindingKind::OrphanCode) {
        outcome.merge(reach::run_orphan(input.changes, index, input.repo_root));
    }
    if enabled.contains(&FindingKind::BlastRadius) {
        outcome.merge(reach::run_blast_radius(input.changes, index));
    }
    outcome
}

fn describe_missing_index(index: Option<&RepoIndex>) -> String {
    match index {
        None => "no symbol index has been built for this repository".to_string(),
        Some(index) if index.is_empty() => "the symbol index is empty".to_string(),
        Some(index) => format!(
            "symbol index is partial ({} of {} file(s) indexed)",
            index.file_count(),
            index.files_total.max(index.file_count())
        ),
    }
}

/// `RuleOutcome` has no combinator of its own, and this module produces three.
trait Merge {
    fn merge(&mut self, other: RuleOutcome);
}

impl Merge for RuleOutcome {
    fn merge(&mut self, other: RuleOutcome) {
        self.findings.extend(other.findings);
        self.limits.extend(other.limits);
        for id in other.checked {
            if !self.checked.contains(&id) {
                self.checked.push(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::index::fixture::index_from_sources;

    fn all_enabled() -> RuleConfig {
        let mut config = RuleConfig::default();
        for kind in KINDS {
            config.set(kind.rule_id(), true);
        }
        config
    }

    fn empty_changes() -> ChangeSet {
        changed_symbols(&[])
    }

    #[test]
    fn a_missing_index_produces_limits_and_never_findings() {
        let changes = empty_changes();
        let outcome = collect_context_rules(
            &ContextInput {
                repo_root: None,
                changes: &changes,
                index: None,
            },
            &all_enabled(),
        );
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.limits.len(), KINDS.len());
        assert!(outcome
            .limits
            .iter()
            .all(|limit| limit.reason == UncheckedReason::MissingArtifact));
    }

    #[test]
    fn a_partial_index_is_treated_as_missing() {
        let mut index = index_from_sources(&[("src/a.ts", "export function a() {}")]);
        index.complete = false;
        index.files_total = 400;
        let changes = empty_changes();
        let outcome = collect_context_rules(
            &ContextInput {
                repo_root: None,
                changes: &changes,
                index: Some(&index),
            },
            &all_enabled(),
        );
        assert!(outcome.findings.is_empty());
        let detail = outcome.limits[0].detail.clone().expect("detail");
        assert!(detail.contains("partial"), "detail was {detail}");
    }

    #[test]
    fn disabled_rules_are_recorded_and_not_run() {
        let index = index_from_sources(&[("src/a.ts", "export function a() {}")]);
        let changes = empty_changes();
        let mut config = all_enabled();
        config.set(FindingKind::OrphanCode.rule_id(), false);

        let outcome = collect_context_rules(
            &ContextInput {
                repo_root: None,
                changes: &changes,
                index: Some(&index),
            },
            &config,
        );
        assert!(outcome
            .limits
            .iter()
            .any(|limit| limit.rule_id == FindingKind::OrphanCode.rule_id()
                && limit.reason == UncheckedReason::Disabled));
        assert!(!outcome
            .checked
            .contains(&FindingKind::OrphanCode.rule_id().to_string()));
    }

    #[test]
    fn every_rule_lands_in_checked_or_limits_whatever_the_input() {
        let index = index_from_sources(&[("src/a.ts", "export function a() { return 1; }")]);
        let changes = empty_changes();
        let outcome = collect_context_rules(
            &ContextInput {
                repo_root: None,
                changes: &changes,
                index: Some(&index),
            },
            &all_enabled(),
        );
        for kind in KINDS {
            let id = kind.rule_id();
            let accounted = outcome.checked.iter().any(|c| c == id)
                || outcome.limits.iter().any(|l| l.rule_id == id);
            assert!(accounted, "{id} appears in neither checked nor limits");
        }
    }
}
