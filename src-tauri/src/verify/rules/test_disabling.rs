// SPDX-License-Identifier: GPL-3.0-or-later
//! V2 — test disabling.
//!
//! Three signals, all deterministic:
//! 1. a skip marker (`it.skip`, `xit`, `test.todo`, `#[ignore]`) newly added
//!    inside a test file,
//! 2. a test file deleted outright,
//! 3. a net decrease of assertion lines inside a surviving test file.
//!
//! Every signal nets added occurrences against removed ones, so a reindent or a
//! reworded test title that carried the marker already is not reported as new.

use crate::verify::types::{Finding, FindingKind, UncheckedReason};

use super::context::{
    applicable_files, ChangeKind, ChangedLine, DiffContext, FileChange, FileScope, RuleOutcome,
};
use super::patterns;

/// Every kind this rule can emit.
pub const KINDS: &[FindingKind] = &[
    FindingKind::TestSkipAdded,
    FindingKind::TestFileDeleted,
    FindingKind::AssertionRemoved,
];

/// At most this many skip findings per file — a mass rename should not drown
/// the report.
const MAX_SKIPS_PER_FILE: usize = 20;

pub fn run(ctx: &DiffContext) -> RuleOutcome {
    let mut out = RuleOutcome::new();

    report_deleted_test_files(ctx, &mut out);

    let applicable = applicable_files(ctx, FileScope::Test);
    out.account(
        &applicable,
        &[FindingKind::TestSkipAdded, FindingKind::AssertionRemoved],
    );

    for file in applicable.files(ctx) {
        report_added_skips(file, &mut out);
        report_removed_assertions(file, &mut out);
    }

    out
}

/// Deliberately language-agnostic: "this diff deletes a test file" needs no
/// parsing, so an out-of-scope test file (`api_test.py`) is still reported
/// rather than counted as unchecked.
fn report_deleted_test_files(ctx: &DiffContext, out: &mut RuleOutcome) {
    let candidates: Vec<&FileChange> = ctx.files.iter().filter(|f| f.is_test_scope()).collect();
    if candidates.is_empty() {
        out.limit(
            FindingKind::TestFileDeleted,
            UncheckedReason::NotApplicable,
            Some("no test files in this diff".to_string()),
        );
        return;
    }
    out.check(FindingKind::TestFileDeleted);

    for file in candidates {
        if file.change != ChangeKind::Deleted {
            continue;
        }
        let finding = Finding::new(
            FindingKind::TestFileDeleted,
            file.path.clone(),
            format!("test file deleted ({} lines)", file.removed.len()),
        );
        out.push(with_evidence(finding, file));
    }
}

/// Attach removed-assertion evidence only when there is any.
fn with_evidence(finding: Finding, file: &FileChange) -> Finding {
    let detail = assertion_evidence(file);
    if detail.is_empty() {
        finding
    } else {
        finding.with_detail(detail)
    }
}

fn report_added_skips(file: &FileChange, out: &mut RuleOutcome) {
    if file.change == ChangeKind::Deleted {
        return;
    }
    let mut emitted = 0usize;
    for token in patterns::skip_markers(file.language) {
        let added = patterns::lines_matching(&file.added, token, file.language, true);
        let removed = patterns::lines_matching(&file.removed, token, file.language, true).len();
        for line in patterns::net_new(added, removed) {
            if emitted >= MAX_SKIPS_PER_FILE {
                return;
            }
            emitted += 1;
            out.push(
                Finding::new(
                    FindingKind::TestSkipAdded,
                    file.path.clone(),
                    format!("{} added", token.trim_end_matches('(')),
                )
                .at_line(line.line_no)
                .with_detail(patterns::evidence(line)),
            );
        }
    }
}

fn report_removed_assertions(file: &FileChange, out: &mut RuleOutcome) {
    if file.change == ChangeKind::Deleted {
        // Already reported as a deleted test file; do not double-count.
        return;
    }
    let added = count_assertions(&file.added, file);
    let removed = count_assertions(&file.removed, file);
    if removed <= added {
        return;
    }
    let finding = Finding::new(
        FindingKind::AssertionRemoved,
        file.path.clone(),
        format!(
            "{} assertion line(s) removed, {} added",
            removed - added,
            added
        ),
    );
    out.push(with_evidence(finding, file));
}

fn count_assertions(lines: &[ChangedLine], file: &FileChange) -> usize {
    lines
        .iter()
        .filter(|line| patterns::is_assertion_line(line.text.trim_start(), file.language))
        .count()
}

/// Quote the removed assertion lines (old-file numbering) as evidence.
fn assertion_evidence(file: &FileChange) -> String {
    let parts: Vec<String> = file
        .removed
        .iter()
        .filter(|line| patterns::is_assertion_line(line.text.trim_start(), file.language))
        .take(5)
        .map(|line| format!("-{}", patterns::evidence(line)))
        .collect();
    patterns::detail_from(&parts)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::verify::rules::context::context_from_unified;
    use crate::verify::types::Severity;

    fn run_on(diff: &str) -> RuleOutcome {
        run(&context_from_unified(Path::new("/repo"), diff, None, None))
    }

    fn kinds(out: &RuleOutcome) -> Vec<FindingKind> {
        out.findings.iter().map(|f| f.kind).collect()
    }

    #[test]
    fn flags_added_skip_marker_in_a_test_file() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -3,3 +3,4 @@
 describe(\"a\", () => {
-  it(\"works\", () => {
+  it.skip(\"works\", () => {
+  xit(\"other\", () => {
",
        );
        assert_eq!(
            kinds(&out),
            vec![FindingKind::TestSkipAdded, FindingKind::TestSkipAdded]
        );
        assert_eq!(out.findings[0].message, "it.skip added");
        assert_eq!(out.findings[0].line, Some(4));
        assert!(out.checked.contains(&"v2.testSkipAdded".to_string()));
    }

    #[test]
    fn flags_rust_ignore_attribute() {
        let out = run_on(
            "\
diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,4 @@
 #[cfg(test)]
 mod tests {
+    #[ignore]
     #[test]
",
        );
        assert_eq!(kinds(&out), vec![FindingKind::TestSkipAdded]);
        assert_eq!(out.findings[0].message, "#[ignore] added");
    }

    #[test]
    fn moved_skip_marker_is_not_a_new_skip() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -3,2 +3,2 @@
-  it.skip(\"old title\", () => {
+  it.skip(\"new title\", () => {
",
        );
        assert!(out.findings.is_empty());
        assert!(out.checked.contains(&"v2.testSkipAdded".to_string()));
    }

    #[test]
    fn removed_skip_marker_is_never_flagged() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -3,2 +3,2 @@
-  it.skip(\"a\", () => {
+  it(\"a\", () => {
",
        );
        assert!(out.findings.is_empty());
    }

    #[test]
    fn skip_marker_inside_a_comment_is_ignored() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -3,1 +3,2 @@
 const a = 1;
+  // use it.skip( to disable a case
",
        );
        assert!(out.findings.is_empty());
    }

    #[test]
    fn skip_marker_outside_a_test_file_is_not_in_scope() {
        let out = run_on(
            "\
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -3,1 +3,2 @@
 const a = 1;
+it.skip(\"x\", () => {});
",
        );
        assert!(out.findings.is_empty());
        assert!(!out.checked.contains(&"v2.testSkipAdded".to_string()));
        assert!(out
            .limits
            .iter()
            .any(|l| l.reason == UncheckedReason::NotApplicable));
    }

    #[test]
    fn flags_deleted_test_file_in_any_language() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
deleted file mode 100644
--- a/src/a.test.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-it(\"a\", () => {
-  expect(1).toBe(1);
-});
diff --git a/py/test_api.py b/py/test_api.py
deleted file mode 100644
--- a/py/test_api.py
+++ /dev/null
@@ -1,1 +0,0 @@
-def test_a(): assert 1 == 1
",
        );
        let deleted: Vec<&Finding> = out
            .findings
            .iter()
            .filter(|f| f.kind == FindingKind::TestFileDeleted)
            .collect();
        assert_eq!(deleted.len(), 2);
        assert!(out.checked.contains(&"v2.testFileDeleted".to_string()));
        // The Python file is still unchecked for the pattern-based kinds.
        assert!(out
            .limits
            .iter()
            .any(|l| l.reason == UncheckedReason::UnsupportedLanguage
                && l.rule_id == "v2.testSkipAdded"));
    }

    #[test]
    fn flags_net_assertion_decrease() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -3,5 +3,3 @@
 it(\"a\", () => {
-  expect(a).toBe(1);
-  expect(b).toBe(2);
-  expect(c).toBe(3);
+  expect(a).toBe(1);
 });
",
        );
        assert_eq!(kinds(&out), vec![FindingKind::AssertionRemoved]);
        assert_eq!(
            out.findings[0].message,
            "2 assertion line(s) removed, 1 added"
        );
        assert!(out.findings[0].line.is_none());
    }

    #[test]
    fn equal_assertion_counts_are_not_flagged() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -3,3 +3,3 @@
 it(\"a\", () => {
-  expect(a).toBe(1);
+  expect(a).toBe(2);
 });
",
        );
        assert!(out.findings.is_empty());
        assert!(out.checked.contains(&"v2.assertionRemoved".to_string()));
    }

    #[test]
    fn deleted_test_file_is_not_double_counted_as_assertion_removal() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
deleted file mode 100644
--- a/src/a.test.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-  expect(a).toBe(1);
-  expect(b).toBe(2);
",
        );
        assert_eq!(kinds(&out), vec![FindingKind::TestFileDeleted]);
    }

    #[test]
    fn severity_comes_from_the_registry() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
deleted file mode 100644
--- a/src/a.test.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-it(\"a\", () => {});
",
        );
        assert_eq!(out.findings[0].severity, Severity::Danger);
        assert_eq!(out.findings[0].rule_id, "v2.testFileDeleted");
    }
}
