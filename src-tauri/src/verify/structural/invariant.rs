// SPDX-License-Identifier: GPL-3.0-or-later
//! V17 — assert the invariant a commit's own type claims.
//!
//! A conventional-commit type is a promise. `docs:` and `style:` promise the
//! executable code is untouched; `refactor:` and `perf:` promise the public
//! surface is unchanged. Both promises are checkable the moment V1 exists, and
//! neither needs the commit's diff text — only the structural comparison.
//!
//! **Partial by construction, and it says so.** The full `refactor:` invariant
//! is *behavioural* equivalence, which cannot be established statically; it
//! needs a before/after test run (V11). This module checks the statically
//! decidable half — the exported name / arity / visibility surface — and emits
//! a `ScanLimit{NotImplemented}` for the behavioural half on every such commit.
//! Contract §2.3 explicitly allows one rule to appear in both `checked` and
//! `unchecked`; reporting v17 as wholly implemented would violate §7-①.
//!
//! The commit type is parsed here, locally, rather than in `git/commit.rs`:
//! that file is out of scope for this subsystem and the parse is four lines.

use super::pair::ApiChange;
use super::verdict::FileVerdict;
use super::{FileComparison, StructuralFileDiff, StructuralOutcome};
use crate::verify::rules::context::RuleOutcome;
use crate::verify::types::{Finding, FindingKind, UncheckedReason};

pub const KINDS: &[FindingKind] = &[FindingKind::InvariantViolation];

/// How many symbol or API names a `detail` names before eliding.
const MAX_NAMED: usize = 5;

/// What a commit's type promises about the change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitIntent {
    /// `docs:` / `style:` — executable code must not change at all.
    NoCodeChange,
    /// `refactor:` / `perf:` — behaviour and public surface must be preserved.
    ApiPreserving,
    /// Every other type promises nothing this rule can check.
    Unconstrained,
}

/// Parse the conventional-commit type off the subject line.
///
/// `fix(diff)!: subject` → `fix`. Anything without a leading `type:` — a plain
/// sentence, a merge commit, a revert — is `Unconstrained`.
pub fn commit_intent(message: &str) -> CommitIntent {
    let subject = message.lines().next().unwrap_or("").trim();
    let Some((head, _)) = subject.split_once(':') else {
        return CommitIntent::Unconstrained;
    };
    let head = head.trim();
    // Strip the optional scope, then the optional breaking-change marker.
    let commit_type = match head.split_once('(') {
        Some((commit_type, _)) => commit_type,
        None => head,
    }
    .trim_end_matches('!')
    .trim()
    .to_ascii_lowercase();

    match commit_type.as_str() {
        "docs" | "style" => CommitIntent::NoCodeChange,
        "refactor" | "perf" => CommitIntent::ApiPreserving,
        _ => CommitIntent::Unconstrained,
    }
}

/// The commit type as written, for use in an untranslated message.
fn commit_type_of(message: &str) -> String {
    let subject = message.lines().next().unwrap_or("").trim();
    let head = subject.split_once(':').map(|(head, _)| head).unwrap_or("");
    match head.split_once('(') {
        Some((commit_type, _)) => commit_type,
        None => head,
    }
    .trim()
    .trim_end_matches('!')
    .to_ascii_lowercase()
}

/// Run V17 against a commit message and the structural comparisons of its files.
pub fn collect(message: Option<&str>, files: &[FileComparison]) -> RuleOutcome {
    let mut outcome = RuleOutcome::new();

    let Some(message) = message else {
        outcome.limit(
            FindingKind::InvariantViolation,
            UncheckedReason::NotApplicable,
            Some("no commit message to read an invariant from".to_string()),
        );
        return outcome;
    };

    let intent = commit_intent(message);
    if intent == CommitIntent::Unconstrained {
        outcome.limit(
            FindingKind::InvariantViolation,
            UncheckedReason::NotApplicable,
            Some(format!(
                "a `{}:` commit asserts no structural invariant",
                commit_type_of(message)
            )),
        );
        return outcome;
    }

    // The honesty device: behavioural equivalence is the other half of the
    // `refactor:` / `perf:` promise, and it is not implemented.
    if intent == CommitIntent::ApiPreserving {
        outcome.limit(
            FindingKind::InvariantViolation,
            UncheckedReason::NotImplemented,
            Some(
                "behavioural invariance for refactor:/perf: requires before/after \
                 test runs (V11) — only the public API surface is checked"
                    .to_string(),
            ),
        );
    }

    let commit_type = commit_type_of(message);
    let mut compared = 0usize;
    for file in files {
        match &file.outcome {
            StructuralOutcome::Compared { diff } => {
                compared += 1;
                let finding = match intent {
                    CommitIntent::NoCodeChange => code_change_finding(&commit_type, diff),
                    CommitIntent::ApiPreserving => api_change_finding(&commit_type, diff),
                    CommitIntent::Unconstrained => None,
                };
                if let Some(finding) = finding {
                    outcome.push(finding);
                }
            }
            // A file we could not parse is a file we cannot assert anything
            // about. It is never evidence of a violation.
            StructuralOutcome::Degraded { reason, detail } => outcome.limit(
                FindingKind::InvariantViolation,
                reason.unchecked_reason(),
                Some(format!("{}: {}", file.path, detail)),
            ),
        }
    }

    if compared > 0 {
        outcome.check(FindingKind::InvariantViolation);
    } else if files.is_empty() {
        outcome.limit(
            FindingKind::InvariantViolation,
            UncheckedReason::NotApplicable,
            Some("no comparable source file in this commit".to_string()),
        );
    }
    outcome
}

/// `docs:` / `style:` — any semantic change at all is a violation.
fn code_change_finding(commit_type: &str, diff: &StructuralFileDiff) -> Option<Finding> {
    if diff.verdict != FileVerdict::Semantic {
        return None;
    }
    let changed: Vec<String> = diff
        .symbols
        .iter()
        .filter(|change| change.verdict.is_semantic())
        .map(|change| format!("{} {}", change.name, verb(change.verdict)))
        .collect();
    // `Semantic` without a named declaration means the change is in top-level
    // code; say so rather than reporting "0 declarations".
    let count = changed.len();
    let message = if count == 0 {
        format!("`{commit_type}:` commit changes executable code outside any declaration")
    } else {
        format!("`{commit_type}:` commit changes executable code — {count} declaration(s) differ")
    };

    let finding = Finding::new(FindingKind::InvariantViolation, &diff.path, message)
        .with_detail(elide(&changed));
    Some(match diff.summary.semantic_ranges.first() {
        Some(range) => finding.at_line(range.start_line),
        None => finding,
    })
}

/// `refactor:` / `perf:` — the exported surface must survive unchanged.
fn api_change_finding(commit_type: &str, diff: &StructuralFileDiff) -> Option<Finding> {
    if diff.api.is_empty() {
        return None;
    }
    let described: Vec<String> = diff
        .api
        .iter()
        .map(|change: &ApiChange| format!("{} ({})", change.name, change.detail))
        .collect();
    let message = format!(
        "`{commit_type}:` commit changes the public API surface — {} export(s) affected",
        diff.api.len()
    );
    Some(
        Finding::new(FindingKind::InvariantViolation, &diff.path, message)
            .with_detail(elide(&described)),
    )
}

fn verb(verdict: super::verdict::SymbolVerdict) -> &'static str {
    use super::verdict::SymbolVerdict as V;
    match verdict {
        V::Added => "added",
        V::Removed => "removed",
        V::SignatureOnly => "signature changed",
        _ => "changed",
    }
}

fn elide(items: &[String]) -> String {
    let shown: Vec<&str> = items.iter().take(MAX_NAMED).map(String::as_str).collect();
    if items.len() > MAX_NAMED {
        format!("{}, +{} more", shown.join("; "), items.len() - MAX_NAMED)
    } else {
        shown.join("; ")
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::comparison;
    use super::*;
    use crate::verify::types::Severity;

    const BEFORE: &str = "\
export function fetchUser(id: string) {
  const user = load(id);
  return user;
}
";

    fn ids(outcome: &RuleOutcome) -> Vec<UncheckedReason> {
        outcome.limits.iter().map(|limit| limit.reason).collect()
    }

    #[test]
    fn conventional_types_map_to_their_promise() {
        assert_eq!(
            commit_intent("docs: update readme"),
            CommitIntent::NoCodeChange
        );
        assert_eq!(
            commit_intent("style(diff): reformat"),
            CommitIntent::NoCodeChange
        );
        assert_eq!(
            commit_intent("refactor(git): extract helpers"),
            CommitIntent::ApiPreserving
        );
        assert_eq!(
            commit_intent("perf!: cache lookups"),
            CommitIntent::ApiPreserving
        );
        assert_eq!(commit_intent("DOCS: shout"), CommitIntent::NoCodeChange);
        assert_eq!(
            commit_intent("feat: add a thing"),
            CommitIntent::Unconstrained
        );
        assert_eq!(commit_intent("no type here"), CommitIntent::Unconstrained);
        assert_eq!(
            commit_intent("Merge branch 'main': whatever"),
            CommitIntent::Unconstrained
        );
    }

    #[test]
    fn only_the_subject_line_is_read() {
        let message = "docs: update readme\n\nrefactor: this body line must not win\n";
        assert_eq!(commit_intent(message), CommitIntent::NoCodeChange);
    }

    // ── docs: / style: ───────────────────────────────────────────────────

    #[test]
    fn a_docs_commit_that_changes_code_is_flagged() {
        let after = BEFORE.replace("return user;", "return user ?? null;");
        let outcome = collect(
            Some("docs: clarify the user lookup"),
            &[comparison("src/api.ts", BEFORE, &after)],
        );
        assert_eq!(outcome.findings.len(), 1);
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, "v17.invariantViolation");
        assert_eq!(finding.severity, Severity::Warn);
        assert!(finding
            .message
            .contains("`docs:` commit changes executable code"));
        assert!(finding
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("fetchUser"));
        assert_eq!(outcome.checked, vec!["v17.invariantViolation".to_string()]);
    }

    #[test]
    fn a_docs_commit_that_only_adds_comments_passes() {
        let after = format!("// explains the lookup\n{BEFORE}");
        let outcome = collect(
            Some("docs: explain the lookup"),
            &[comparison("src/api.ts", BEFORE, &after)],
        );
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.checked, vec!["v17.invariantViolation".to_string()]);
    }

    #[test]
    fn a_style_commit_that_only_reformats_passes() {
        let after = BEFORE.replace("  ", "      ");
        let outcome = collect(
            Some("style: widen indentation"),
            &[comparison("src/api.ts", BEFORE, &after)],
        );
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn a_docs_commit_that_only_renames_a_local_passes() {
        let after = BEFORE
            .replace("const user =", "const account =")
            .replace("return user;", "return account;");
        let outcome = collect(
            Some("docs: tidy naming"),
            &[comparison("src/api.ts", BEFORE, &after)],
        );
        assert!(outcome.findings.is_empty());
    }

    /// The reason literals are not normalized away: this must not pass.
    #[test]
    fn a_docs_commit_that_changes_a_literal_is_flagged() {
        let before = "export const TIMEOUT = 30;\n";
        let after = "export const TIMEOUT = 3000;\n";
        let outcome = collect(
            Some("docs: note the timeout"),
            &[comparison("src/config.ts", before, after)],
        );
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn a_docs_commit_over_rust_code_is_checked_too() {
        let before = "pub fn run() -> u32 {\n    1\n}\n";
        let after = "pub fn run() -> u32 {\n    2\n}\n";
        let outcome = collect(
            Some("docs: describe run"),
            &[comparison("src/run.rs", before, after)],
        );
        assert_eq!(outcome.findings.len(), 1);
    }

    // ── refactor: / perf: ────────────────────────────────────────────────

    /// The honesty device — this limit is emitted on every such commit.
    #[test]
    fn a_refactor_commit_always_confesses_the_unimplemented_half() {
        let after = BEFORE.replace("  ", "    ");
        let outcome = collect(
            Some("refactor: reformat"),
            &[comparison("src/api.ts", BEFORE, &after)],
        );
        assert!(ids(&outcome).contains(&UncheckedReason::NotImplemented));
        let confession = outcome
            .limits
            .iter()
            .find(|limit| limit.reason == UncheckedReason::NotImplemented)
            .and_then(|limit| limit.detail.clone())
            .unwrap_or_default();
        assert!(confession.contains("before/after test runs"));
        // …and it is still `checked`, because the API half really did run.
        assert_eq!(outcome.checked, vec!["v17.invariantViolation".to_string()]);
    }

    #[test]
    fn a_perf_commit_confesses_the_same_gap() {
        let outcome = collect(
            Some("perf: cache the lookup"),
            &[comparison("src/api.ts", BEFORE, BEFORE)],
        );
        assert!(ids(&outcome).contains(&UncheckedReason::NotImplemented));
    }

    #[test]
    fn a_refactor_that_removes_an_export_is_flagged() {
        let after = "export function other() { return 1; }\n";
        let outcome = collect(
            Some("refactor: tidy the api"),
            &[comparison("src/api.ts", BEFORE, after)],
        );
        assert_eq!(outcome.findings.len(), 1);
        assert!(outcome.findings[0]
            .message
            .contains("changes the public API surface"));
        assert!(outcome.findings[0]
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("fetchUser"));
    }

    #[test]
    fn a_refactor_that_changes_an_exported_arity_is_flagged() {
        let after = BEFORE.replace("(id: string)", "(id: string, force: boolean)");
        let outcome = collect(
            Some("refactor: thread the force flag"),
            &[comparison("src/api.ts", BEFORE, &after)],
        );
        assert_eq!(outcome.findings.len(), 1);
        assert!(outcome.findings[0]
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("arity 1 → 2"));
    }

    #[test]
    fn a_refactor_that_rewrites_a_body_but_keeps_the_surface_passes() {
        let after = "\
export function fetchUser(id: string) {
  const cached = cache.get(id);
  if (cached) { return cached; }
  const user = load(id);
  cache.set(id, user);
  return user;
}
";
        let outcome = collect(
            Some("refactor: add a cache"),
            &[comparison("src/api.ts", BEFORE, after)],
        );
        assert!(
            outcome.findings.is_empty(),
            "a body rewrite is exactly what refactor: is for"
        );
    }

    #[test]
    fn a_refactor_that_renames_a_private_helper_passes() {
        let before = "function helper(a: number) { return a; }\nexport const x = 1;\n";
        let after = "function assist(a: number) { return a; }\nexport const x = 1;\n";
        let outcome = collect(
            Some("refactor: rename the helper"),
            &[comparison("src/api.ts", before, after)],
        );
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn a_refactor_over_rust_that_narrows_visibility_is_flagged() {
        let before = "pub fn run() -> u32 { 1 }\n";
        let after = "fn run() -> u32 { 1 }\n";
        let outcome = collect(
            Some("refactor: hide run"),
            &[comparison("src/run.rs", before, after)],
        );
        assert_eq!(outcome.findings.len(), 1);
        assert!(outcome.findings[0]
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("exported → private"));
    }

    // ── Non-applicability and degradation ────────────────────────────────

    #[test]
    fn an_unconstrained_commit_type_is_not_applicable() {
        let outcome = collect(
            Some("feat: add a thing"),
            &[comparison("src/api.ts", BEFORE, BEFORE)],
        );
        assert!(outcome.findings.is_empty());
        assert_eq!(ids(&outcome), vec![UncheckedReason::NotApplicable]);
        assert!(outcome.checked.is_empty());
    }

    #[test]
    fn a_missing_commit_message_is_not_applicable() {
        let outcome = collect(None, &[comparison("src/api.ts", BEFORE, BEFORE)]);
        assert_eq!(ids(&outcome), vec![UncheckedReason::NotApplicable]);
    }

    #[test]
    fn a_degraded_file_never_produces_an_invariant_finding() {
        let outcome = collect(
            Some("docs: update"),
            &[comparison("src/api.ts", "function f( {", "function g( {{")],
        );
        assert!(
            outcome.findings.is_empty(),
            "an unparsable file is unchecked, not a violation"
        );
        assert!(ids(&outcome).contains(&UncheckedReason::ParseFailed));
        assert!(outcome.checked.is_empty());
    }

    #[test]
    fn an_unsupported_language_never_produces_an_invariant_finding() {
        let outcome = collect(
            Some("docs: update"),
            &[comparison("scripts/build.py", "a = 1\n", "a = 2\n")],
        );
        assert!(outcome.findings.is_empty());
        assert!(ids(&outcome).contains(&UncheckedReason::UnsupportedLanguage));
    }

    #[test]
    fn a_docs_commit_touching_no_source_file_is_not_applicable() {
        let outcome = collect(Some("docs: update readme"), &[]);
        assert!(outcome.findings.is_empty());
        assert!(ids(&outcome).contains(&UncheckedReason::NotApplicable));
    }
}
