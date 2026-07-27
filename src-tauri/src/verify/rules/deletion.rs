// SPDX-License-Identifier: GPL-3.0-or-later
//! V10 — deletion classification.
//!
//! In a large diff, deletions are what a reviewer misses. This rule sorts
//! removed lines into the three buckets the registry defines — public exports,
//! error handling, validation — so the UI can lift them out of the diff into
//! their own section. Severity is `Info`: these are *reading aids*, not defects.
//!
//! Removed *test* code is deliberately not a bucket here — that is V2
//! (`testFileDeleted` / `assertionRemoved`), and test files are excluded so the
//! two rules never double-report the same deletion.
//!
//! Every bucket nets removals against additions of the same bucket, so moving a
//! `try/catch` between functions reports nothing.

use crate::verify::types::{Finding, FindingKind};

use super::context::{
    applicable_files, ChangedLine, DiffContext, FileChange, FileScope, Language, RuleOutcome,
};
use super::patterns;

pub const KINDS: &[FindingKind] = &[
    FindingKind::PublicExportDeleted,
    FindingKind::ErrorHandlingDeleted,
    FindingKind::ValidationDeleted,
];

const MAX_EVIDENCE_LINES: usize = 5;

pub fn run(ctx: &DiffContext) -> RuleOutcome {
    let mut out = RuleOutcome::new();
    let applicable = applicable_files(ctx, FileScope::Source);
    out.account(&applicable, KINDS);

    for file in applicable.files(ctx) {
        // Test deletions belong to V2.
        if file.is_test_scope() {
            continue;
        }
        for &kind in KINDS {
            report_bucket(file, kind, &mut out);
        }
    }

    out
}

fn report_bucket(file: &FileChange, kind: FindingKind, out: &mut RuleOutcome) {
    let removed = lines_in_bucket(&file.removed, file.language, kind);
    if removed.is_empty() {
        return;
    }
    let added = lines_in_bucket(&file.added, file.language, kind).len();
    let net = removed.len().saturating_sub(added);
    if net == 0 {
        return;
    }

    let evidence: Vec<String> = removed
        .iter()
        .take(MAX_EVIDENCE_LINES)
        .map(|line| format!("-{}", patterns::evidence(line)))
        .collect();

    out.push(
        Finding::new(
            kind,
            file.path.clone(),
            format!("{} {} removed", net, label(kind)),
        )
        .with_detail(patterns::detail_from(&evidence)),
    );
}

fn label(kind: FindingKind) -> &'static str {
    match kind {
        FindingKind::PublicExportDeleted => "public export line(s)",
        FindingKind::ErrorHandlingDeleted => "error-handling line(s)",
        FindingKind::ValidationDeleted => "validation line(s)",
        _ => "line(s)",
    }
}

fn lines_in_bucket(
    lines: &[ChangedLine],
    language: Language,
    kind: FindingKind,
) -> Vec<&ChangedLine> {
    lines
        .iter()
        .filter(|line| classify(line.text.trim_start(), language) == Some(kind))
        .collect()
}

/// One bucket per line, most specific first: a removed `pub fn validate_x` is
/// reported as a public export, not counted twice.
fn classify(trimmed: &str, language: Language) -> Option<FindingKind> {
    if trimmed.is_empty() || patterns::is_comment(trimmed, language) {
        return None;
    }
    if is_public_export(trimmed, language) {
        return Some(FindingKind::PublicExportDeleted);
    }
    if is_validation(trimmed, language) {
        return Some(FindingKind::ValidationDeleted);
    }
    if is_error_handling(trimmed, language) {
        return Some(FindingKind::ErrorHandlingDeleted);
    }
    None
}

fn is_public_export(trimmed: &str, language: Language) -> bool {
    match language {
        Language::Rust => patterns::RUST_PUBLIC_EXPORT_PREFIXES
            .iter()
            .any(|p| trimmed.starts_with(p)),
        _ => {
            trimmed.starts_with("export ")
                || trimmed.starts_with("export{")
                || trimmed.starts_with("export*")
                || trimmed.contains("module.exports")
                || trimmed.starts_with("exports.")
        }
    }
}

fn is_validation(trimmed: &str, language: Language) -> bool {
    let lower = trimmed.to_ascii_lowercase();
    if patterns::contains_any(&lower, patterns::VALIDATION_TOKENS) {
        return true;
    }
    // Test files are excluded from this rule, so an assertion here is a
    // production invariant check.
    if patterns::contains_any(trimmed, patterns::assertion_tokens(language)) {
        return true;
    }
    let guard = trimmed.starts_with("if (!") || trimmed.starts_with("if !");
    guard && (trimmed.contains("throw") || trimmed.contains("return"))
}

fn is_error_handling(trimmed: &str, language: Language) -> bool {
    let tokens = match language {
        Language::Rust => patterns::RUST_ERROR_HANDLING_TOKENS,
        _ => patterns::JS_ERROR_HANDLING_TOKENS,
    };
    patterns::contains_any(trimmed, tokens)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::verify::rules::context::context_from_unified;
    use crate::verify::types::{Severity, UncheckedReason};

    fn run_on(diff: &str) -> RuleOutcome {
        run(&context_from_unified(Path::new("/repo"), diff, None, None))
    }

    fn finding(out: &RuleOutcome, kind: FindingKind) -> Option<&Finding> {
        out.findings.iter().find(|f| f.kind == kind)
    }

    #[test]
    fn classifies_removed_public_exports() {
        let out = run_on(
            "\
diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,4 +1,1 @@
-export function fetchUser() {}
-export const LIMIT = 10;
 const internal = 1;
-module.exports = internal;
",
        );
        let f = finding(&out, FindingKind::PublicExportDeleted).expect("finding");
        assert_eq!(f.message, "3 public export line(s) removed");
        assert_eq!(f.severity, Severity::Info);
        assert!(f
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("-1: export function fetchUser() {}"));
    }

    #[test]
    fn classifies_removed_rust_public_items() {
        let out = run_on(
            "\
diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,1 @@
-pub fn open() {}
-pub struct Repo;
 fn private() {}
",
        );
        let f = finding(&out, FindingKind::PublicExportDeleted).expect("finding");
        assert_eq!(f.message, "2 public export line(s) removed");
    }

    #[test]
    fn classifies_removed_error_handling_and_validation() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,7 +1,1 @@
-  try {
-    risky();
-  } catch (e) {
-    report(e);
-  }
-  if (!isValidEmail(input)) return;
 const a = 1;
",
        );
        assert!(finding(&out, FindingKind::ErrorHandlingDeleted).is_some());
        let validation = finding(&out, FindingKind::ValidationDeleted).expect("validation");
        assert_eq!(validation.message, "1 validation line(s) removed");
    }

    #[test]
    fn moved_error_handling_nets_out() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
-  try {
-  } catch (e) {
+  try {
+  } catch (err) {
 const a = 1;
",
        );
        assert!(finding(&out, FindingKind::ErrorHandlingDeleted).is_none());
        assert!(out
            .checked
            .contains(&"v10.errorHandlingDeleted".to_string()));
    }

    #[test]
    fn comments_and_pure_additions_are_not_deletions() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-// export function old() {}
+export function added() {}
 const a = 1;
",
        );
        assert!(out.findings.is_empty());
    }

    #[test]
    fn test_files_are_left_to_v2() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,3 +1,1 @@
-export function helper() {}
-  expect(a).toBe(1);
 const a = 1;
",
        );
        assert!(out.findings.is_empty());
        // Still counted as checked — the file was looked at and excluded.
        assert!(out.checked.contains(&"v10.publicExportDeleted".to_string()));
    }

    #[test]
    fn unsupported_language_lands_in_limits_for_every_bucket() {
        let out = run_on(
            "\
diff --git a/main.go b/main.go
--- a/main.go
+++ b/main.go
@@ -1,2 +1,1 @@
-func Public() {}
 var a = 1
",
        );
        assert!(out.findings.is_empty());
        assert_eq!(out.limits.len(), KINDS.len());
        assert!(out
            .limits
            .iter()
            .all(|l| l.reason == UncheckedReason::UnsupportedLanguage));
    }
}
