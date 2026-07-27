// SPDX-License-Identifier: GPL-3.0-or-later
//! V1 classification and rule-outcome tests for [`super`].
//!
//! Split out of `mod.rs` to keep that file inside the 800-line ceiling.
//! Every fixture is an inline source string, so the suite is hermetic.

use super::test_support::{comparison, verdict_of};
use super::*;
use crate::verify::types::Severity;
use verdict::SymbolVerdict;

const TS_BEFORE: &str = "\
export function fetchUser(id: string) {
  const user = load(id);
  return user;
}

export function formatName(user: User) {
  return user.first + \" \" + user.last;
}
";

const RS_BEFORE: &str = "\
pub fn fetch_user(id: &str) -> User {
load(id)
}

pub fn format_name(user: &User) -> String {
format!(\"{} {}\", user.first, user.last)
}
";

fn diff_of(path: &str, before: &str, after: &str) -> Box<StructuralFileDiff> {
    match compare(path, before.as_bytes(), after.as_bytes()) {
        StructuralOutcome::Compared { diff } => diff,
        StructuralOutcome::Degraded { reason, detail } => {
            panic!("expected a comparison, got {reason:?}: {detail}")
        }
    }
}

fn verdict_for(diff: &StructuralFileDiff, name: &str) -> SymbolVerdict {
    diff.symbols
        .iter()
        .find(|change| change.name == name)
        .unwrap_or_else(|| panic!("{name} is not in the diff"))
        .verdict
}

// ── V1 classification ────────────────────────────────────────────────

#[test]
fn pure_reindentation_is_formatting_only() {
    let after = "\
export function fetchUser( id : string )
{
    const user = load( id ) ;
    return user ;
}

export function formatName( user : User ) { return user.first + \" \" + user.last ; }
";
    assert_eq!(
        verdict_of("src/api.ts", TS_BEFORE, after),
        FileVerdict::FormattingOnly
    );
}

#[test]
fn rust_reindentation_is_formatting_only() {
    let after = "\
pub fn fetch_user(id: &str) -> User { load(id) }

pub fn format_name(user: &User) -> String { format!(\"{} {}\", user.first, user.last) }
";
    assert_eq!(
        verdict_of("src/api.rs", RS_BEFORE, after),
        FileVerdict::FormattingOnly
    );
}

#[test]
fn adding_a_comment_is_comments_only() {
    let after = "\
/** Looks a user up by id. */
export function fetchUser(id: string) {
  const user = load(id); // cached
  return user;
}

export function formatName(user: User) {
  return user.first + \" \" + user.last;
}
";
    assert_eq!(
        verdict_of("src/api.ts", TS_BEFORE, after),
        FileVerdict::CommentsOnly
    );
}

#[test]
fn adding_a_rust_doc_comment_is_comments_only() {
    let after = "\
/// Looks a user up by id.
pub fn fetch_user(id: &str) -> User {
// straight through
load(id)
}

pub fn format_name(user: &User) -> String {
format!(\"{} {}\", user.first, user.last)
}
";
    assert_eq!(
        verdict_of("src/api.rs", RS_BEFORE, after),
        FileVerdict::CommentsOnly
    );
}

#[test]
fn renaming_a_symbol_and_its_uses_is_rename_only() {
    let after = "\
export function loadUser(key: string) {
  const account = load(key);
  return account;
}

export function formatName(user: User) {
  return user.first + \" \" + user.last;
}
";
    let diff = diff_of("src/api.ts", TS_BEFORE, after);
    assert_eq!(diff.verdict, FileVerdict::RenameOnly);
    assert_eq!(verdict_for(&diff, "loadUser"), SymbolVerdict::RenameOnly);
    assert_eq!(
        diff.symbols
            .iter()
            .find(|c| c.name == "loadUser")
            .and_then(|c| c.old_name.as_deref()),
        Some("fetchUser")
    );
}

#[test]
fn renaming_a_rust_binding_is_rename_only() {
    let before = "pub fn run() -> u32 {\n    let total = 1 + 2;\n    total\n}\n";
    let after = "pub fn run() -> u32 {\n    let sum = 1 + 2;\n    sum\n}\n";
    assert_eq!(
        verdict_of("src/run.rs", before, after),
        FileVerdict::RenameOnly
    );
}

#[test]
fn moving_a_function_within_a_file_is_motion_not_semantics() {
    let after = "\
export function formatName(user: User) {
  return user.first + \" \" + user.last;
}

export function fetchUser(id: string) {
  const user = load(id);
  return user;
}
";
    let diff = diff_of("src/api.ts", TS_BEFORE, after);
    assert_eq!(diff.verdict, FileVerdict::Moved);
    assert_eq!(verdict_for(&diff, "fetchUser"), SymbolVerdict::Moved);
    assert_eq!(verdict_for(&diff, "formatName"), SymbolVerdict::Moved);
    assert_eq!(diff.summary.semantic_symbols, 0);
    assert!(diff.summary.semantic_ranges.is_empty());
}

#[test]
fn moving_a_rust_function_within_a_file_is_motion() {
    let after = "\
pub fn format_name(user: &User) -> String {
format!(\"{} {}\", user.first, user.last)
}

pub fn fetch_user(id: &str) -> User {
load(id)
}
";
    assert_eq!(
        verdict_of("src/api.rs", RS_BEFORE, after),
        FileVerdict::Moved
    );
}

#[test]
fn a_real_logic_change_is_semantic_and_names_only_the_changed_symbol() {
    let after = "\
export function fetchUser(id: string) {
  const user = load(id);
  if (!user) { throw new Error(\"missing\"); }
  return user;
}

export function formatName(user: User) {
  return user.first + \" \" + user.last;
}
";
    let diff = diff_of("src/api.ts", TS_BEFORE, after);
    assert_eq!(diff.verdict, FileVerdict::Semantic);
    assert_eq!(verdict_for(&diff, "fetchUser"), SymbolVerdict::Changed);
    assert_eq!(verdict_for(&diff, "formatName"), SymbolVerdict::Unchanged);
    assert_eq!(diff.summary.semantic_symbols, 1);
    assert_eq!(diff.summary.unchanged, 1);
    assert_eq!(diff.summary.semantic_ranges.len(), 1);
    assert_eq!(diff.summary.semantic_ranges[0].start_line, 1);
}

#[test]
fn a_real_rust_logic_change_is_semantic() {
    let after = "\
pub fn fetch_user(id: &str) -> User {
let user = load(id);
assert!(!id.is_empty());
user
}

pub fn format_name(user: &User) -> String {
format!(\"{} {}\", user.first, user.last)
}
";
    let diff = diff_of("src/api.rs", RS_BEFORE, after);
    assert_eq!(diff.verdict, FileVerdict::Semantic);
    assert_eq!(verdict_for(&diff, "fetch_user"), SymbolVerdict::Changed);
    assert_eq!(verdict_for(&diff, "format_name"), SymbolVerdict::Unchanged);
}

#[test]
fn changing_only_a_signature_is_reported_as_such() {
    let after = "\
export function fetchUser(id: string, force: boolean) {
  const user = load(id);
  return user;
}

export function formatName(user: User) {
  return user.first + \" \" + user.last;
}
";
    let diff = diff_of("src/api.ts", TS_BEFORE, after);
    assert_eq!(
        verdict_for(&diff, "fetchUser"),
        SymbolVerdict::SignatureOnly
    );
    assert_eq!(diff.api.len(), 1);
}

#[test]
fn a_whole_file_rewrite_reports_every_declaration() {
    let after = "\
export class UserService {
  constructor(private readonly http: Http) {}
  find(id: string) { return this.http.get(id); }
}
";
    let diff = diff_of("src/api.ts", TS_BEFORE, after);
    assert_eq!(diff.verdict, FileVerdict::Semantic);
    assert!(diff.summary.semantic_ratio() >= NOISE_RATIO);
    assert!(reassurance(&diff).is_none(), "nothing reassuring to say");
}

// ── Degradation ──────────────────────────────────────────────────────

#[test]
fn a_broken_new_side_degrades_and_never_claims_formatting_only() {
    let outcome = compare(
        "src/api.ts",
        TS_BEFORE.as_bytes(),
        b"export function fetchUser(id: string {\n  return",
    );
    match outcome {
        StructuralOutcome::Degraded { reason, .. } => {
            assert_eq!(reason, DegradeReason::ParseError);
        }
        StructuralOutcome::Compared { diff } => {
            panic!("a broken source must never be compared: {:?}", diff.verdict)
        }
    }
}

#[test]
fn a_broken_old_side_degrades_too() {
    let outcome = compare("src/api.ts", b"function f( {", TS_BEFORE.as_bytes());
    assert!(matches!(
        outcome,
        StructuralOutcome::Degraded {
            reason: DegradeReason::ParseError,
            ..
        }
    ));
}

#[test]
fn an_unsupported_language_degrades() {
    let outcome = compare("scripts/build.py", b"a = 1\n", b"a = 2\n");
    assert!(matches!(
        outcome,
        StructuralOutcome::Degraded {
            reason: DegradeReason::UnsupportedLanguage,
            ..
        }
    ));
}

#[test]
fn an_oversized_side_degrades_on_budget() {
    let huge = vec![b' '; MAX_STRUCTURAL_BYTES + 1];
    let outcome = compare("src/api.ts", b"const a = 1;", &huge);
    assert!(matches!(
        outcome,
        StructuralOutcome::Degraded {
            reason: DegradeReason::TooLarge,
            ..
        }
    ));
}

#[test]
fn non_utf8_content_is_not_comparable() {
    let outcome = compare("src/api.ts", &[0xff, 0xfe, 0x00], b"const a = 1;");
    assert!(matches!(
        outcome,
        StructuralOutcome::Degraded {
            reason: DegradeReason::NotComparable,
            ..
        }
    ));
}

#[test]
fn an_added_or_deleted_file_is_not_comparable() {
    for outcome in [
        compare_versions("src/api.ts", None, Some(b"const a = 1;")),
        compare_versions("src/api.ts", Some(b"const a = 1;"), None),
        compare_versions("src/api.ts", None, None),
    ] {
        assert!(matches!(
            outcome,
            StructuralOutcome::Degraded {
                reason: DegradeReason::NotComparable,
                ..
            }
        ));
    }
}

#[test]
fn identical_bytes_are_identical() {
    assert_eq!(
        verdict_of("src/api.ts", TS_BEFORE, TS_BEFORE),
        FileVerdict::Identical
    );
}

// ── Rule outcome ─────────────────────────────────────────────────────

#[test]
fn a_degraded_file_produces_a_limit_and_never_a_finding() {
    let outcome = collect(&[FileComparison {
        path: "src/api.ts".to_string(),
        outcome: compare("src/api.ts", b"function f( {", b"function f( {{"),
    }]);
    assert!(outcome.findings.is_empty(), "degradation is not a signal");
    assert_eq!(outcome.limits.len(), 1);
    assert_eq!(outcome.limits[0].rule_id, "v1.structuralDiff");
    assert_eq!(outcome.limits[0].reason, UncheckedReason::ParseFailed);
    assert!(outcome.checked.is_empty());
}

#[test]
fn an_unsupported_file_lands_in_unchecked_with_its_own_reason() {
    let outcome = collect(&[FileComparison {
        path: "scripts/build.py".to_string(),
        outcome: compare("scripts/build.py", b"a = 1\n", b"a = 2\n"),
    }]);
    assert!(outcome.findings.is_empty());
    assert_eq!(
        outcome.limits[0].reason,
        UncheckedReason::UnsupportedLanguage
    );
}

#[test]
fn an_empty_file_list_is_not_applicable() {
    let outcome = collect(&[]);
    assert!(outcome.findings.is_empty());
    assert_eq!(outcome.limits[0].reason, UncheckedReason::NotApplicable);
}

#[test]
fn formatting_only_produces_an_info_finding_that_shrinks_the_review() {
    let after = TS_BEFORE.replace("  ", "    ");
    let outcome = collect(&[comparison("src/api.ts", TS_BEFORE, &after)]);
    assert_eq!(outcome.findings.len(), 1);
    let finding = &outcome.findings[0];
    assert_eq!(finding.rule_id, "v1.structuralDiff");
    assert_eq!(finding.severity, Severity::Info);
    assert!(finding.message.starts_with("formatting only"));
    assert_eq!(outcome.checked, vec!["v1.structuralDiff".to_string()]);
}

#[test]
fn a_small_semantic_change_still_reports_what_can_be_skipped() {
    let after = TS_BEFORE.replace("return user;", "return user ?? null;");
    let outcome = collect(&[comparison("src/api.ts", TS_BEFORE, &after)]);
    assert_eq!(outcome.findings.len(), 1);
    assert!(outcome.findings[0]
        .message
        .contains("1 of 2 declaration(s) changed"));
    assert!(outcome.findings[0].line.is_some());
}

#[test]
fn structural_diff_never_rises_above_info() {
    assert_eq!(
        FindingKind::StructuralDiff.default_severity(),
        Severity::Info
    );
}

/// Contract §2.3 / §7-①: a rule may only claim to be `Implemented` when it
/// really runs. Both rows this module owns are flipped, and the kinds they
/// map to are exactly the ones it emits.
#[test]
fn both_owned_registry_rows_are_implemented_and_correctly_wired() {
    use crate::verify::registry::{find, RuleStatus};

    for kind in KINDS.iter().chain(invariant::KINDS) {
        let entry = find(kind.rule_id())
            .unwrap_or_else(|| panic!("{} is missing from the registry", kind.rule_id()));
        assert_eq!(
            entry.status,
            RuleStatus::Implemented,
            "{} still says Planned",
            entry.id
        );
        assert_eq!(entry.kind, Some(*kind));
    }
    assert_eq!(KINDS, &[FindingKind::StructuralDiff]);
    assert_eq!(invariant::KINDS, &[FindingKind::InvariantViolation]);
}

/// Every id this module puts into a `RuleOutcome` — finding or limit — must
/// be one of its declared kinds, or the report's accounting would attribute
/// coverage to a rule that never ran.
#[test]
fn a_scan_only_ever_reports_its_own_rule_ids() {
    let files = vec![
        comparison("src/api.ts", TS_BEFORE, &TS_BEFORE.replace("  ", "    ")),
        comparison("scripts/build.py", "a = 1\n", "a = 2\n"),
        comparison("src/broken.ts", "function f( {", "function g( {{"),
    ];
    let structural = collect(&files);
    let invariants = invariant::collect(Some("docs: update"), &files);

    for (outcome, expected) in [
        (&structural, "v1.structuralDiff"),
        (&invariants, "v17.invariantViolation"),
    ] {
        for finding in &outcome.findings {
            assert_eq!(finding.rule_id, expected);
        }
        for limit in &outcome.limits {
            assert_eq!(limit.rule_id, expected);
        }
        for id in &outcome.checked {
            assert_eq!(id, expected);
        }
    }
}
