// SPDX-License-Identifier: GPL-3.0-or-later
//! V5 — verification bypass traces in *added* lines.
//!
//! These are the marks left when a checker was switched off rather than
//! satisfied: `@ts-ignore`, `eslint-disable`, crate-wide `#![allow(...)]`,
//! `as any`, `.unwrap()`, and empty `catch` blocks.
//!
//! Occurrences are netted against removals so that reindenting a line that
//! already carried the pragma is not reported as a newly introduced bypass.

use crate::verify::types::{Finding, FindingKind};

use super::context::{
    applicable_files, ChangeKind, ChangedLine, DiffContext, FileChange, FileScope, Language,
    RuleOutcome,
};
use super::patterns;

pub const KINDS: &[FindingKind] = &[
    FindingKind::VerificationBypassed,
    FindingKind::TypeEscapeHatchAdded,
    FindingKind::EmptyCatchAdded,
    FindingKind::UnsafeUnwrapAdded,
];

const MAX_PER_KIND_PER_FILE: usize = 20;

pub fn run(ctx: &DiffContext) -> RuleOutcome {
    let mut out = RuleOutcome::new();
    let applicable = applicable_files(ctx, FileScope::Source);
    out.account(&applicable, KINDS);

    for file in applicable.files(ctx) {
        if file.change == ChangeKind::Deleted {
            continue;
        }
        report_pragmas(file, &mut out);
        report_escape_hatches(file, &mut out);
        report_unwraps(file, &mut out);
        report_empty_catches(file, &mut out);
    }

    out
}

fn report_pragmas(file: &FileChange, out: &mut RuleOutcome) {
    let tokens = match file.language {
        Language::Rust => patterns::RUST_BYPASS_PRAGMAS,
        _ => patterns::JS_BYPASS_PRAGMAS,
    };
    // A pragma lives inside a comment by definition, so comments are kept here.
    emit_token_findings(
        file,
        tokens,
        FindingKind::VerificationBypassed,
        false,
        out,
        |token| format!("{} added", token.trim_end_matches('(')),
    );
}

fn report_escape_hatches(file: &FileChange, out: &mut RuleOutcome) {
    if file.language != Language::TypeScript {
        return;
    }
    emit_token_findings(
        file,
        patterns::TS_ESCAPE_HATCHES,
        FindingKind::TypeEscapeHatchAdded,
        true,
        out,
        |token| format!("`{}` added", token),
    );
}

fn report_unwraps(file: &FileChange, out: &mut RuleOutcome) {
    // `.unwrap()` inside a test is how a test asserts; only production code
    // counts here.
    if file.language != Language::Rust || file.is_test_scope() {
        return;
    }
    emit_token_findings(
        file,
        patterns::RUST_UNWRAPS,
        FindingKind::UnsafeUnwrapAdded,
        true,
        out,
        |token| format!("{} added outside tests", token),
    );
}

/// Shared net-new token emitter.
fn emit_token_findings(
    file: &FileChange,
    tokens: &[&str],
    kind: FindingKind,
    ignore_comments: bool,
    out: &mut RuleOutcome,
    message: impl Fn(&str) -> String,
) {
    let mut emitted = 0usize;
    // One finding per line even when several tokens of the same kind match
    // (`const a: any = x as any`).
    let mut seen: Vec<u32> = Vec::new();
    for token in tokens {
        let added = patterns::lines_matching(&file.added, token, file.language, ignore_comments);
        let removed =
            patterns::lines_matching(&file.removed, token, file.language, ignore_comments).len();
        for line in patterns::net_new(added, removed) {
            if emitted >= MAX_PER_KIND_PER_FILE {
                return;
            }
            if seen.contains(&line.line_no) {
                continue;
            }
            seen.push(line.line_no);
            emitted += 1;
            out.push(
                Finding::new(kind, file.path.clone(), message(token))
                    .at_line(line.line_no)
                    .with_detail(patterns::evidence(line)),
            );
        }
    }
}

fn report_empty_catches(file: &FileChange, out: &mut RuleOutcome) {
    if !file.language.is_js_family() {
        return;
    }
    let added = empty_catch_lines(&file.added);
    let removed = empty_catch_lines(&file.removed).len();
    for line in patterns::net_new(added, removed) {
        out.push(
            Finding::new(
                FindingKind::EmptyCatchAdded,
                file.path.clone(),
                "empty catch block added".to_string(),
            )
            .at_line(line.line_no)
            .with_detail(patterns::evidence(line)),
        );
    }
}

/// Lines that open a `catch` whose body is empty, in either the single-line
/// (`catch (e) {}`, `.catch(() => {})`) or the two-line (`} catch (e) {` then
/// `}`) shape.
fn empty_catch_lines(lines: &[ChangedLine]) -> Vec<&ChangedLine> {
    let mut hits = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.text.trim_start();
        if patterns::is_comment(trimmed, Language::TypeScript) || !trimmed.contains("catch") {
            continue;
        }
        let squashed: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
        if has_inline_empty_catch(&squashed) {
            hits.push(line);
            continue;
        }
        if squashed.ends_with('{') && closes_immediately(lines, index, line.line_no) {
            hits.push(line);
        }
    }
    hits
}

fn has_inline_empty_catch(squashed: &str) -> bool {
    let mut offset = 0usize;
    while let Some(found) = squashed[offset..].find("catch") {
        let after = &squashed[offset + found + "catch".len()..];
        if after.starts_with("{}") {
            return true;
        }
        if after.starts_with('(') {
            // `catch (e) {}`
            if let Some(close) = after.find(')') {
                if after[close + 1..].starts_with("{}") {
                    return true;
                }
            }
            // `.catch(() => {})`
            if after.contains("=>{})") || after.contains("=>{});") {
                return true;
            }
        }
        offset += found + "catch".len();
    }
    false
}

/// True when the very next added line is a bare `}` — an empty block body.
fn closes_immediately(lines: &[ChangedLine], index: usize, line_no: u32) -> bool {
    lines
        .get(index + 1)
        .is_some_and(|next| next.line_no == line_no + 1 && next.text.trim() == "}")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::verify::rules::context::context_from_unified;
    use crate::verify::types::UncheckedReason;

    fn run_on(diff: &str) -> RuleOutcome {
        run(&context_from_unified(Path::new("/repo"), diff, None, None))
    }

    fn kinds(out: &RuleOutcome) -> Vec<FindingKind> {
        out.findings.iter().map(|f| f.kind).collect()
    }

    #[test]
    fn flags_added_ts_ignore_and_eslint_disable() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,4 @@
 const a = 1;
+// @ts-ignore
+/* eslint-disable no-console */
+const b: string = a;
",
        );
        assert_eq!(
            kinds(&out),
            vec![
                FindingKind::VerificationBypassed,
                FindingKind::VerificationBypassed
            ]
        );
        assert_eq!(out.findings[0].message, "@ts-ignore added");
        assert_eq!(out.findings[0].line, Some(2));
        assert!(out.checked.contains(&"v5.verificationBypassed".to_string()));
    }

    #[test]
    fn removed_or_moved_pragma_is_not_flagged() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,2 @@
-// @ts-ignore
-const a = anyValue as any;
+const a = 1;
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,1 +1,1 @@
-  // @ts-ignore
+    // @ts-ignore
",
        );
        assert!(out.findings.is_empty());
    }

    #[test]
    fn flags_type_escape_hatches_in_typescript_only() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = payload as any;
diff --git a/src/c.js b/src/c.js
--- a/src/c.js
+++ b/src/c.js
@@ -1,1 +1,2 @@
 const a = 1;
+const b = payload as any;
",
        );
        assert_eq!(kinds(&out), vec![FindingKind::TypeEscapeHatchAdded]);
        assert_eq!(out.findings[0].message, "`as any` added");
    }

    #[test]
    fn flags_unwrap_in_production_rust_but_not_in_tests() {
        let out = run_on(
            "\
diff --git a/src/app.rs b/src/app.rs
--- a/src/app.rs
+++ b/src/app.rs
@@ -1,1 +1,2 @@
 fn a() {}
+    let v = load().unwrap();
diff --git a/src/app_test.rs b/src/app_test.rs
--- a/src/app_test.rs
+++ b/src/app_test.rs
@@ -1,1 +1,2 @@
 fn a() {}
+    let v = load().unwrap();
",
        );
        assert_eq!(kinds(&out), vec![FindingKind::UnsafeUnwrapAdded]);
        assert_eq!(out.findings[0].file, "src/app.rs");
    }

    #[test]
    fn flags_empty_catch_blocks_in_both_shapes() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,5 @@
 const a = 1;
+try { risky(); } catch (e) {}
+await risky().catch(() => {});
+  } catch (err) {
+  }
",
        );
        let empty: Vec<&Finding> = out
            .findings
            .iter()
            .filter(|f| f.kind == FindingKind::EmptyCatchAdded)
            .collect();
        assert_eq!(empty.len(), 3);
    }

    #[test]
    fn non_empty_catch_is_not_flagged() {
        let out = run_on(
            "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,5 @@
 const a = 1;
+try { risky(); } catch (e) { report(e); }
+await risky().catch((e) => { report(e); });
+  } catch (err) {
+    report(err);
",
        );
        assert!(out
            .findings
            .iter()
            .all(|f| f.kind != FindingKind::EmptyCatchAdded));
    }

    #[test]
    fn crate_wide_rust_allow_is_a_bypass_but_targeted_allow_is_not() {
        let out = run_on(
            "\
diff --git a/src/a.rs b/src/a.rs
--- a/src/a.rs
+++ b/src/a.rs
@@ -1,1 +1,3 @@
 fn a() {}
+#![allow(unused)]
+#[allow(dead_code)]
",
        );
        assert_eq!(kinds(&out), vec![FindingKind::VerificationBypassed]);
        assert_eq!(out.findings[0].message, "#![allow added");
    }

    #[test]
    fn unsupported_language_is_reported_as_unchecked() {
        let out = run_on(
            "\
diff --git a/main.py b/main.py
--- a/main.py
+++ b/main.py
@@ -1,1 +1,2 @@
 a = 1
+b = 2  # type: ignore
",
        );
        assert!(out.findings.is_empty());
        assert!(out.checked.is_empty());
        assert!(out
            .limits
            .iter()
            .any(|l| l.reason == UncheckedReason::UnsupportedLanguage));
        // All four kinds must confess the skip, not just one.
        assert_eq!(out.limits.len(), KINDS.len());
    }
}
