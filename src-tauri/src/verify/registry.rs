//! The static rule table (contract §2.4).
//!
//! Every rule the subsystem knows about lives here — including the ones that
//! are *not implemented*. That is deliberate: §7-① requires a report to say
//! "these N rules ran, these M did not", and a `Planned` entry is what makes an
//! unimplemented rule show up as `unchecked` instead of silently vanishing.
//!
//! Adding a rule means adding a row here first. A rule that is not in this
//! table cannot be reported, configured, or explained to the user.

use serde::{Deserialize, Serialize};

use super::types::{FindingKind, Severity};

#[derive(Clone, Copy, Debug)]
pub struct RuleEntry {
    /// `"v2.testSkipAdded"` — matches `FindingKind::rule_id`.
    pub id: &'static str,
    /// `None` for `Planned` rules, which have no `FindingKind` yet.
    pub kind: Option<FindingKind>,
    pub v_number: &'static str,
    /// Layer number from the spec §4 (0–6).
    pub layer: u8,
    pub default_severity: Severity,
    pub default_enabled: bool,
    pub status: RuleStatus,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuleStatus {
    Implemented,
    /// Registered but not implemented. Always reported as `unchecked` with
    /// `NotImplemented`. This is the mechanism that makes §7-① automatic.
    Planned,
}

/// Shorthand for an implemented row.
const fn implemented(
    id: &'static str,
    kind: FindingKind,
    v_number: &'static str,
    layer: u8,
    default_severity: Severity,
    default_enabled: bool,
) -> RuleEntry {
    RuleEntry {
        id,
        kind: Some(kind),
        v_number,
        layer,
        default_severity,
        default_enabled,
        status: RuleStatus::Implemented,
    }
}

/// Shorthand for a registered-but-unimplemented row.
const fn planned(id: &'static str, v_number: &'static str, layer: u8) -> RuleEntry {
    RuleEntry {
        id,
        kind: None,
        v_number,
        layer,
        default_severity: Severity::Warn,
        default_enabled: false,
        status: RuleStatus::Planned,
    }
}

use FindingKind as K;
use Severity::{Danger, Info, Warn};

/// Ordered by V-number so the settings screen reads like the spec.
static RULES: &[RuleEntry] = &[
    // ── Layer 0 ──────────────────────────────────────────────────────────
    // V1 is the one rule whose finding is good news — it proves what a reviewer
    // may skip — so it is `Info` and never rises above it.
    implemented("v1.structuralDiff", K::StructuralDiff, "V1", 0, Info, true),
    // ── Layer 1: deterministic risk signals ──────────────────────────────
    implemented("v2.testSkipAdded", K::TestSkipAdded, "V2", 1, Warn, true),
    implemented(
        "v2.testFileDeleted",
        K::TestFileDeleted,
        "V2",
        1,
        Danger,
        true,
    ),
    implemented(
        "v2.assertionRemoved",
        K::AssertionRemoved,
        "V2",
        1,
        Warn,
        true,
    ),
    // V3 ships off — highest false-positive risk of the whole set (§7-②).
    implemented(
        "v3.vacuousAssertion",
        K::VacuousAssertion,
        "V3",
        1,
        Warn,
        false,
    ),
    implemented(
        "v3.mockOnlyAssertion",
        K::MockOnlyAssertion,
        "V3",
        1,
        Warn,
        false,
    ),
    implemented(
        "v3.noAssertionTest",
        K::NoAssertionTest,
        "V3",
        1,
        Warn,
        false,
    ),
    implemented(
        "v3.broadExceptionAssertion",
        K::BroadExceptionAssertion,
        "V3",
        1,
        Warn,
        false,
    ),
    implemented(
        "v3.assertionRoulette",
        K::AssertionRoulette,
        "V3",
        1,
        Info,
        false,
    ),
    // V4 needs a manifest and (optionally) the network — off by default.
    implemented(
        "v4.hallucinatedDependency",
        K::HallucinatedDependency,
        "V4",
        1,
        Danger,
        false,
    ),
    implemented(
        "v4.suspiciousNewDependency",
        K::SuspiciousNewDependency,
        "V4",
        1,
        Warn,
        false,
    ),
    implemented(
        "v5.verificationBypassed",
        K::VerificationBypassed,
        "V5",
        1,
        Warn,
        true,
    ),
    implemented(
        "v5.typeEscapeHatchAdded",
        K::TypeEscapeHatchAdded,
        "V5",
        1,
        Warn,
        false,
    ),
    implemented(
        "v5.emptyCatchAdded",
        K::EmptyCatchAdded,
        "V5",
        1,
        Warn,
        true,
    ),
    implemented(
        "v5.unsafeUnwrapAdded",
        K::UnsafeUnwrapAdded,
        "V5",
        1,
        Warn,
        false,
    ),
    implemented("v6.scopeDrift", K::ScopeDrift, "V6", 1, Warn, true),
    // ── Layer 2: codebase context ────────────────────────────────────────
    // V7 ships off: the similarity thresholds are literature conventions, not
    // values tuned on any real repository yet (design §12-3).
    implemented(
        "v7.reinventedFunction",
        K::ReinventedFunction,
        "V7",
        2,
        Warn,
        false,
    ),
    // V8 ships off: name-based reachability cannot be complete, and a wrong
    // "this is dead code" is the finding users trust least (design §12-2).
    implemented("v8.orphanCode", K::OrphanCode, "V8", 2, Info, false),
    // V9 ships on: it only speaks when a signature changed and a caller did
    // not, so it is structurally quiet.
    implemented("v9.blastRadius", K::BlastRadius, "V9", 2, Info, true),
    // V10 is Info: a deletion is information for the reviewer, not a warning.
    implemented(
        "v10.publicExportDeleted",
        K::PublicExportDeleted,
        "V10",
        2,
        Info,
        true,
    ),
    implemented(
        "v10.errorHandlingDeleted",
        K::ErrorHandlingDeleted,
        "V10",
        2,
        Info,
        true,
    ),
    implemented(
        "v10.validationDeleted",
        K::ValidationDeleted,
        "V10",
        2,
        Info,
        true,
    ),
    // ── Layer 3: execution evidence ──────────────────────────────────────
    implemented(
        "v11.testEvidenceMissing",
        K::TestEvidenceMissing,
        "V11",
        3,
        Warn,
        true,
    ),
    implemented(
        "v11.testEvidenceStale",
        K::TestEvidenceStale,
        "V11",
        3,
        Warn,
        true,
    ),
    implemented(
        "v11.testEvidenceFailed",
        K::TestEvidenceFailed,
        "V11",
        3,
        Danger,
        true,
    ),
    implemented(
        "v12.uncoveredNewLines",
        K::UncoveredNewLines,
        "V12",
        3,
        Warn,
        false,
    ),
    planned("v15.mutationScore", "V15", 3),
    // Partially implemented on purpose: the public-API half of the `refactor:`
    // promise runs, the behavioural half emits a `NotImplemented` limit on every
    // such commit. §2.3 allows a rule in `checked` and `unchecked` at once.
    implemented(
        "v17.invariantViolation",
        K::InvariantViolation,
        "V17",
        3,
        Warn,
        true,
    ),
    // ── Layer 4: review process ──────────────────────────────────────────
    planned("v16.claimMismatch", "V16", 4),
    planned("v18.blindReviewMode", "V18", 4),
    // ── Layer 5: CLI session evidence ────────────────────────────────────
    // V19 is a review-priority weight, never a warning (§7-⑨) — keep it Info.
    implemented("v19.readLessEdit", K::ReadLessEdit, "V19", 5, Info, true),
    implemented(
        "v20.testFailureThenTestEdited",
        K::TestFailureThenTestEdited,
        "V20",
        5,
        Danger,
        true,
    ),
    implemented(
        "v20.testsNeverRunInSession",
        K::TestsNeverRunInSession,
        "V20",
        5,
        Warn,
        true,
    ),
    implemented(
        "v21.hookBypassCommand",
        K::HookBypassCommand,
        "V21",
        5,
        Danger,
        true,
    ),
    implemented(
        "v22.unrewindableChange",
        K::UnrewindableChange,
        "V22",
        5,
        Warn,
        true,
    ),
    implemented("v23.subagentEdit", K::SubagentEdit, "V23", 5, Info, true),
    implemented(
        "v24.postCompactionEdit",
        K::PostCompactionEdit,
        "V24",
        5,
        Info,
        false,
    ),
    implemented("v25.repeatedEdit", K::RepeatedEdit, "V25", 5, Info, false),
    // V26 ships **on**: it is the fifth section of the session report, and a
    // page that cannot say "the prompt named X and X never changed" answers
    // only four of its five questions. It is structurally quiet — zero
    // resolvable anchors means zero findings, never "everything drifted" — so
    // default-on does not make it noisy. It is evaluated in
    // `verify/report/drift.rs`, not in `session/rules.rs`, because it needs the
    // repository to resolve a mention against.
    // V26 stays planned even though the drift analysis itself ships: the report
    // renders it as a section, and the registry tracks the *finding* channel,
    // which this rule does not use. Claiming otherwise would tell a reader a
    // finding could appear when none ever can.
    planned("v26.promptScopeDrift", "V26", 5),
    // V27 stays planned: it has no data source at all — current Claude Code
    // builds never write the injected CLAUDE.md into the session log.
    planned("v27.staleRulesInjected", "V27", 5),
    planned("v28.hookCollector", "V28", 5),
    // ── Layer 6: post-commit ─────────────────────────────────────────────
    implemented("v31.tangledCommit", K::TangledCommit, "V31", 6, Warn, true),
    implemented("v32.revertUnsafe", K::RevertUnsafe, "V32", 6, Warn, true),
    implemented(
        "v35.agentTrailerMismatch",
        K::AgentTrailerMismatch,
        "V35",
        6,
        Info,
        false,
    ),
    planned("v36.subCommitBisect", "V36", 6),
];

pub fn registry() -> &'static [RuleEntry] {
    RULES
}

pub fn find(rule_id: &str) -> Option<&'static RuleEntry> {
    RULES.iter().find(|entry| entry.id == rule_id)
}

/// Whether a rule is on when the user has expressed no preference.
/// Unknown ids are off — an id we cannot explain must not silently run.
pub fn default_enabled(rule_id: &str) -> bool {
    find(rule_id)
        .map(|entry| entry.default_enabled)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    /// Every `FindingKind` the code can construct, for the coverage test below.
    const ALL_KINDS: &[FindingKind] = &[
        // ── V1: structural diff ──────────────────────────────────────────
        K::StructuralDiff,
        K::TestSkipAdded,
        K::TestFileDeleted,
        K::AssertionRemoved,
        K::VacuousAssertion,
        K::MockOnlyAssertion,
        K::NoAssertionTest,
        K::BroadExceptionAssertion,
        K::AssertionRoulette,
        K::HallucinatedDependency,
        K::SuspiciousNewDependency,
        K::VerificationBypassed,
        K::TypeEscapeHatchAdded,
        K::EmptyCatchAdded,
        K::UnsafeUnwrapAdded,
        K::ScopeDrift,
        K::ReinventedFunction,
        K::OrphanCode,
        K::BlastRadius,
        K::PublicExportDeleted,
        K::ErrorHandlingDeleted,
        K::ValidationDeleted,
        K::TestEvidenceMissing,
        K::TestEvidenceStale,
        K::TestEvidenceFailed,
        K::UncoveredNewLines,
        // ── V17: invariant assertions ────────────────────────────────────
        K::InvariantViolation,
        K::ReadLessEdit,
        K::TestFailureThenTestEdited,
        K::TestsNeverRunInSession,
        K::HookBypassCommand,
        K::UnrewindableChange,
        K::SubagentEdit,
        K::PostCompactionEdit,
        K::RepeatedEdit,
        // K::StaleRulesInjected is deliberately absent: the variant exists so
        // V27 can name itself in an `UNIMPLEMENTED_KINDS` limit, but no code
        // constructs a `Finding` from it. It is a `Planned` row and must stay
        // out of this list.
        K::TangledCommit,
        K::RevertUnsafe,
        K::AgentTrailerMismatch,
    ];

    #[test]
    fn rule_ids_are_unique() {
        let ids: BTreeSet<&str> = RULES.iter().map(|entry| entry.id).collect();
        assert_eq!(ids.len(), RULES.len(), "duplicate rule_id in the registry");
    }

    #[test]
    fn every_finding_kind_has_a_registry_entry() {
        for kind in ALL_KINDS {
            let entry = find(kind.rule_id())
                .unwrap_or_else(|| panic!("{} is missing from the registry", kind.rule_id()));
            assert_eq!(
                entry.kind,
                Some(*kind),
                "{} maps to the wrong kind",
                entry.id
            );
        }
    }

    /// Guards the list above from drifting out of sync with the enum, in *both*
    /// directions. A row may only claim `Implemented` when a kind the code can
    /// actually construct maps to it — otherwise the settings screen offers the
    /// user a rule that can never produce a finding.
    #[test]
    fn implemented_entries_match_the_kind_list() {
        let implemented: BTreeSet<&str> = RULES
            .iter()
            .filter(|entry| entry.status == RuleStatus::Implemented)
            .map(|entry| entry.id)
            .collect();
        let constructible: BTreeSet<&str> = ALL_KINDS.iter().map(|kind| kind.rule_id()).collect();
        assert_eq!(
            implemented, constructible,
            "an Implemented row whose kind no code constructs is an empty promise"
        );
    }

    /// `ALL_KINDS` above is hand-maintained, so it can claim a kind the code
    /// never constructs — which is exactly how `v26.promptScopeDrift` shipped
    /// as `Implemented` while its only producer was a function called from
    /// tests. This derives the truth from the source instead: every implemented
    /// kind must be named in production code somewhere outside the two files
    /// that merely *declare* it.
    #[test]
    fn every_implemented_kind_is_named_in_production_code() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut production = String::new();
        collect_production_source(&root, &mut production);
        assert!(
            production.len() > 10_000,
            "source scan found almost nothing; the walk is broken"
        );

        let missing: Vec<&str> = ALL_KINDS
            .iter()
            .filter(|kind| {
                let variant = format!("{kind:?}");
                !production.contains(&format!("::{variant}"))
            })
            .map(|kind| kind.rule_id())
            .collect();

        assert!(
            missing.is_empty(),
            "these rules claim Implemented but no production code constructs them: {missing:?}"
        );
    }

    /// Every `.rs` under `src/`, truncated at its first `#[cfg(test)]` so test
    /// code cannot vouch for a rule. `registry.rs` and `types.rs` are skipped:
    /// they only declare kinds and map them to ids, never produce findings.
    fn collect_production_source(dir: &std::path::Path, out: &mut String) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_production_source(&path, out);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            match path.file_name().and_then(|n| n.to_str()) {
                Some("registry.rs") | Some("types.rs") => continue,
                _ => {}
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            out.push_str(&strip_kind_lists(production_prefix(&text)));
        }
    }

    /// Text before the first inline `#[cfg(test)] mod … { … }`.
    ///
    /// A one-line `#[cfg(test)] pub mod test_support;` is a declaration, not
    /// test code, and cutting there would hide the whole file — which is how an
    /// earlier version of this scan wrongly accused `evidence/mod.rs`. Only an
    /// attribute followed by a brace before the next semicolon starts a test
    /// module.
    fn production_prefix(text: &str) -> &str {
        let mut from = 0;
        while let Some(offset) = text[from..].find("#[cfg(test)]") {
            let at = from + offset;
            let rest = &text[at + "#[cfg(test)]".len()..];
            let brace = rest.find('{');
            let semi = rest.find(';');
            match (brace, semi) {
                (Some(b), Some(sc)) if b < sc => return &text[..at],
                (Some(_), None) => return &text[..at],
                _ => from = at + "#[cfg(test)]".len(),
            }
        }
        text
    }

    /// Production text with `const …_KINDS: &[FindingKind] = &[…];` tables
    /// removed.
    ///
    /// Those tables *name* kinds without producing them — `REPO_SCOPED_KINDS`
    /// exists precisely to say "not emitted here". Counting a mention inside
    /// one as construction is what let the first version of this test pass
    /// while the bug it was written for was reintroduced.
    fn strip_kind_lists(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(start) = rest.find("&[FindingKind] = &[") {
            let (before, tail) = rest.split_at(start);
            out.push_str(before);
            match tail.find("];") {
                Some(end) => rest = &tail[end + 2..],
                None => {
                    rest = "";
                    break;
                }
            }
        }
        out.push_str(rest);
        out
    }

    #[test]
    fn strip_kind_lists_drops_a_declaration_table_but_keeps_real_code() {
        let text = "const REPO_SCOPED_KINDS: &[FindingKind] = &[FindingKind::PromptScopeDrift];\nlet f = Finding::new(FindingKind::ScopeDrift, \"a\", \"b\");";
        let kept = strip_kind_lists(text);
        assert!(!kept.contains("PromptScopeDrift"), "table mention must not count");
        assert!(kept.contains("ScopeDrift"), "real construction must survive");
    }

    #[test]
    fn production_prefix_keeps_code_after_a_test_only_module_declaration() {
        let text = "#[cfg(test)]\npub mod test_support;\nfn real() {}\n#[cfg(test)]\nmod tests { fn t() {} }";
        let kept = production_prefix(text);
        assert!(kept.contains("fn real()"), "declaration must not end the scan");
        assert!(!kept.contains("mod tests"), "the inline test module must be cut");
    }

    #[test]
    fn planned_entries_carry_no_kind() {
        for entry in RULES.iter().filter(|e| e.status == RuleStatus::Planned) {
            assert!(
                entry.kind.is_none(),
                "{} is planned but has a kind",
                entry.id
            );
        }
    }

    #[test]
    fn read_less_edit_never_exceeds_info() {
        let entry = find("v19.readLessEdit").expect("v19 registered");
        assert_eq!(entry.default_severity, Severity::Info);
    }

    #[test]
    fn unknown_rule_is_disabled_by_default() {
        assert!(!default_enabled("v99.nonexistent"));
    }
}
