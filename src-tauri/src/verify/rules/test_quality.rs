// SPDX-License-Identifier: GPL-3.0-or-later
//! V3 — test quality anti-patterns, over *added* lines in test files only.
//!
//! Spec §P3 is explicit that this must point at concrete patterns and never at
//! "AI wrote this test". Every message here names the pattern and quotes the
//! line. All of `v3.*` ships disabled by default because these heuristics are
//! the most false-positive-prone in the set.
//!
//! Block-shaped signals (`noAssertionTest`, `assertionRoulette`,
//! `mockOnlyAssertion`) only fire on a test whose whole body is present in the
//! added lines. If the body predates the diff we cannot see it, so we say
//! nothing rather than guess.

use crate::verify::types::{Finding, FindingKind};

use super::context::{
    applicable_files, ChangeKind, ChangedLine, DiffContext, FileChange, FileScope, Language,
    RuleOutcome,
};
use super::patterns;

pub const KINDS: &[FindingKind] = &[
    FindingKind::VacuousAssertion,
    FindingKind::MockOnlyAssertion,
    FindingKind::NoAssertionTest,
    FindingKind::BroadExceptionAssertion,
    FindingKind::AssertionRoulette,
];

/// More assertions than this in one test makes a failure hard to localise.
const ROULETTE_THRESHOLD: usize = 5;

const MAX_PER_KIND_PER_FILE: usize = 20;

pub fn run(ctx: &DiffContext) -> RuleOutcome {
    let mut out = RuleOutcome::new();
    let applicable = applicable_files(ctx, FileScope::Test);
    out.account(&applicable, KINDS);

    for file in applicable.files(ctx) {
        if file.change == ChangeKind::Deleted {
            continue;
        }
        report_vacuous(file, &mut out);
        report_broad_exceptions(file, &mut out);
        report_self_mocking(file, &mut out);
        report_blocks(file, &mut out);
    }

    out
}

// ── Line-shaped signals ──────────────────────────────────────────────────────

fn report_vacuous(file: &FileChange, out: &mut RuleOutcome) {
    let mut emitted = 0usize;
    let mut seen: Vec<u32> = Vec::new();

    if file.language.is_js_family() {
        for token in patterns::JS_VACUOUS_ASSERTIONS {
            let added = patterns::lines_matching(&file.added, token, file.language, true);
            let removed = patterns::lines_matching(&file.removed, token, file.language, true).len();
            for line in patterns::net_new(added, removed) {
                if emitted >= MAX_PER_KIND_PER_FILE {
                    return;
                }
                if seen.contains(&line.line_no) {
                    continue;
                }
                seen.push(line.line_no);
                emitted += 1;
                out.push(vacuous_finding(file, line, token));
            }
        }
        // `expect(xs.length).toBeGreaterThan(0)` — the JS shape of `len(x) > 0`.
        for line in nonempty_length_checks(&file.added) {
            if seen.contains(&line.line_no) {
                continue;
            }
            seen.push(line.line_no);
            out.push(vacuous_finding(file, line, "length > 0"));
        }
        return;
    }

    for line in rust_vacuous_lines(&file.added) {
        out.push(vacuous_finding(file, line, "assert on is_ok/is_some only"));
    }
}

fn vacuous_finding(file: &FileChange, line: &ChangedLine, token: &str) -> Finding {
    Finding::new(
        FindingKind::VacuousAssertion,
        file.path.clone(),
        format!("vacuous assertion: {}", token),
    )
    .at_line(line.line_no)
    .with_detail(patterns::evidence(line))
}

fn nonempty_length_checks(lines: &[ChangedLine]) -> Vec<&ChangedLine> {
    lines
        .iter()
        .filter(|line| {
            let trimmed = line.text.trim_start();
            !patterns::is_comment(trimmed, Language::TypeScript)
                && trimmed.contains(".length")
                && (trimmed.contains("toBeGreaterThan(0)")
                    || trimmed.contains("toBeGreaterThan( 0 )"))
        })
        .collect()
}

/// `assert!(x.is_ok())` proves a value exists without checking what it is.
fn rust_vacuous_lines(lines: &[ChangedLine]) -> Vec<&ChangedLine> {
    lines
        .iter()
        .filter(|line| {
            let trimmed = line.text.trim_start();
            patterns::is_assertion_line(trimmed, Language::Rust)
                && patterns::contains_any(trimmed, patterns::RUST_VACUOUS_SUFFIXES)
        })
        .collect()
}

fn report_broad_exceptions(file: &FileChange, out: &mut RuleOutcome) {
    for line in file.added.iter() {
        let trimmed = line.text.trim_start();
        if patterns::is_comment(trimmed, file.language) {
            continue;
        }
        let Some(reason) = broad_exception_reason(trimmed, file.language) else {
            continue;
        };
        out.push(
            Finding::new(
                FindingKind::BroadExceptionAssertion,
                file.path.clone(),
                format!("broad failure assertion: {}", reason),
            )
            .at_line(line.line_no)
            .with_detail(patterns::evidence(line)),
        );
    }
}

fn broad_exception_reason(trimmed: &str, language: Language) -> Option<&'static str> {
    if language == Language::Rust {
        // `#[should_panic]` without `expected = "…"` accepts any panic.
        if trimmed.starts_with("#[should_panic]") {
            return Some("#[should_panic] without expected message");
        }
        return None;
    }
    let squashed: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if squashed.contains("toThrow()") || squashed.contains("toThrowError()") {
        return Some("toThrow() without an expected error");
    }
    None
}

/// A test that mocks the very module it is exercising verifies the mock.
fn report_self_mocking(file: &FileChange, out: &mut RuleOutcome) {
    if !file.language.is_js_family() {
        return;
    }
    let Some(subject) = subject_under_test(&file.path) else {
        return;
    };
    for line in file.added.iter() {
        let trimmed = line.text.trim_start();
        if patterns::is_comment(trimmed, file.language) {
            continue;
        }
        if patterns::first_match(trimmed, patterns::MOCK_FACTORIES).is_none() {
            continue;
        }
        let Some(module) = quoted_argument(trimmed) else {
            continue;
        };
        if module_basename(&module) != subject {
            continue;
        }
        out.push(
            Finding::new(
                FindingKind::MockOnlyAssertion,
                file.path.clone(),
                format!("test mocks its own subject module ('{}')", module),
            )
            .at_line(line.line_no)
            .with_detail(patterns::evidence(line)),
        );
    }
}

/// `src/foo.test.ts` → `foo`; `src/__tests__/foo.ts` → `foo`.
fn subject_under_test(path: &str) -> Option<String> {
    let file = path.rsplit('/').next()?;
    let stem = file.split('.').next()?;
    if stem.is_empty() {
        None
    } else {
        Some(stem.to_ascii_lowercase())
    }
}

fn module_basename(module: &str) -> String {
    let last = module.rsplit('/').next().unwrap_or(module);
    last.split('.').next().unwrap_or(last).to_ascii_lowercase()
}

/// First single- or double-quoted argument on the line.
fn quoted_argument(line: &str) -> Option<String> {
    let open = line.find(['"', '\''])?;
    let quote = line.as_bytes()[open] as char;
    let rest = &line[open + 1..];
    let close = rest.find(quote)?;
    Some(rest[..close].to_string())
}

// ── Block-shaped signals ─────────────────────────────────────────────────────

struct TestBlock<'a> {
    start: &'a ChangedLine,
    lines: Vec<&'a ChangedLine>,
    /// The closing brace was found inside the added lines, so the whole test
    /// body is new and can be judged.
    complete: bool,
}

fn report_blocks(file: &FileChange, out: &mut RuleOutcome) {
    for block in extract_blocks(file) {
        if !block.complete {
            continue;
        }
        let assertions: Vec<&&ChangedLine> = block
            .lines
            .iter()
            .filter(|line| patterns::is_assertion_line(line.text.trim_start(), file.language))
            .collect();

        if assertions.is_empty() {
            out.push(
                Finding::new(
                    FindingKind::NoAssertionTest,
                    file.path.clone(),
                    format!("test body has no assertion ({} lines)", block.lines.len()),
                )
                .at_line(block.start.line_no)
                .with_detail(patterns::evidence(block.start)),
            );
            continue;
        }

        if file.language.is_js_family()
            && assertions
                .iter()
                .all(|line| patterns::contains_any(&line.text, patterns::MOCK_CALL_ASSERTIONS))
        {
            out.push(
                Finding::new(
                    FindingKind::MockOnlyAssertion,
                    file.path.clone(),
                    format!(
                        "all {} assertion(s) only check that a mock was called",
                        assertions.len()
                    ),
                )
                .at_line(block.start.line_no)
                .with_detail(patterns::evidence(assertions[0])),
            );
        }

        if assertions.len() > ROULETTE_THRESHOLD {
            out.push(
                Finding::new(
                    FindingKind::AssertionRoulette,
                    file.path.clone(),
                    format!("{} assertions in one test", assertions.len()),
                )
                .at_line(block.start.line_no)
                .with_detail(patterns::evidence(block.start)),
            );
        }
    }
}

/// Slice the added lines into test bodies. Only runs of consecutive added line
/// numbers are considered, which is what makes "the whole body is new" checkable.
fn extract_blocks(file: &FileChange) -> Vec<TestBlock<'_>> {
    let added = &file.added;
    let mut blocks = Vec::new();
    let mut index = 0usize;

    while index < added.len() {
        let line = &added[index];
        let trimmed = line.text.trim_start();
        if patterns::is_comment(trimmed, file.language)
            || !is_test_declaration(trimmed, file.language)
        {
            index += 1;
            continue;
        }

        if is_self_closing(trimmed) {
            blocks.push(TestBlock {
                start: line,
                lines: vec![line],
                complete: true,
            });
            index += 1;
            continue;
        }

        let indent = indent_of(&line.text);
        let mut body = vec![line];
        let mut complete = false;
        let mut cursor = index + 1;
        while cursor < added.len() && added[cursor].line_no == added[cursor - 1].line_no + 1 {
            let current = &added[cursor];
            body.push(current);
            cursor += 1;
            let text = current.text.trim_start();
            if text.starts_with('}') && indent_of(&current.text) <= indent {
                complete = true;
                break;
            }
        }
        blocks.push(TestBlock {
            start: line,
            lines: body,
            complete,
        });
        index = cursor.max(index + 1);
    }

    blocks
}

fn is_test_declaration(trimmed: &str, language: Language) -> bool {
    if language == Language::Rust {
        return patterns::RUST_TEST_ATTRIBUTES
            .iter()
            .any(|attr| trimmed.starts_with(attr));
    }
    patterns::JS_TEST_DECLARATIONS
        .iter()
        .any(|name| contains_call(trimmed, name))
}

/// `name` used as a call, not as the tail of another identifier — this is what
/// keeps `/re/.test(x)` and `visit(url)` out of the test-declaration set.
fn contains_call(line: &str, name: &str) -> bool {
    let mut from = 0usize;
    while let Some(found) = line[from..].find(name) {
        let at = from + found;
        let previous = line[..at].chars().next_back();
        let is_boundary = previous
            .map(|c| !(c.is_alphanumeric() || c == '_' || c == '$' || c == '.'))
            .unwrap_or(true);
        if is_boundary {
            return true;
        }
        from = at + name.len();
    }
    false
}

/// A one-line test: braces balance on the declaration line itself.
fn is_self_closing(trimmed: &str) -> bool {
    let opens = trimmed.matches('{').count();
    let closes = trimmed.matches('}').count();
    opens > 0 && opens == closes
}

fn indent_of(text: &str) -> usize {
    text.len() - text.trim_start().len()
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

    fn has(out: &RuleOutcome, kind: FindingKind) -> bool {
        out.findings.iter().any(|f| f.kind == kind)
    }

    #[test]
    fn flags_vacuous_assertions() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,4 @@
 import { a } from \"./a\";
+    expect(result).toBeDefined();
+    expect(list.length).toBeGreaterThan(0);
+    expect(value).toBe(42);
",
        );
        let vacuous: Vec<&Finding> = out
            .findings
            .iter()
            .filter(|f| f.kind == FindingKind::VacuousAssertion)
            .collect();
        assert_eq!(vacuous.len(), 2);
        assert_eq!(vacuous[0].line, Some(2));
        assert!(out.checked.contains(&"v3.vacuousAssertion".to_string()));
    }

    #[test]
    fn precise_assertions_are_not_flagged() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,3 @@
 import { a } from \"./a\";
+    expect(result).toEqual({ id: 1 });
+    expect(list).toHaveLength(3);
",
        );
        assert!(out.findings.is_empty());
        assert!(out.checked.contains(&"v3.vacuousAssertion".to_string()));
    }

    #[test]
    fn flags_rust_is_ok_only_assertion() {
        let out = run_on(
            "\
diff --git a/src/a.rs b/src/a.rs
--- a/src/a.rs
+++ b/src/a.rs
@@ -1,1 +1,4 @@
 fn main() {}
+    #[test]
+    fn parses() {
+        assert!(parse(\"x\").is_ok());
",
        );
        assert!(has(&out, FindingKind::VacuousAssertion));
    }

    #[test]
    fn flags_test_with_no_assertion_only_when_body_is_new() {
        let complete = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,5 @@
 import { a } from \"./a\";
+  it(\"renders\", () => {
+    const r = render();
+    r.update();
+  });
",
        );
        assert!(has(&complete, FindingKind::NoAssertionTest));

        // Same declaration, but the body already existed → not judgeable.
        let partial = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,3 +1,4 @@
 import { a } from \"./a\";
+  it(\"renders\", () => {
     const r = render();
   });
",
        );
        assert!(!has(&partial, FindingKind::NoAssertionTest));
    }

    #[test]
    fn a_test_with_an_assertion_is_not_flagged() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,4 @@
 import { a } from \"./a\";
+  it(\"renders\", () => {
+    expect(render()).toEqual(1);
+  });
",
        );
        assert!(out.findings.is_empty());
    }

    #[test]
    fn regex_test_calls_are_not_test_declarations() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,4 @@
 import { a } from \"./a\";
+  const matched = /ab/.test(input);
+  const visited = visit(url);
+  log(matched, visited);
",
        );
        assert!(!has(&out, FindingKind::NoAssertionTest));
    }

    #[test]
    fn flags_mock_only_assertions() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,5 @@
 import { a } from \"./a\";
+  it(\"saves\", () => {
+    save(user);
+    expect(repo.save).toHaveBeenCalledWith(user);
+  });
",
        );
        assert!(has(&out, FindingKind::MockOnlyAssertion));
        assert!(!has(&out, FindingKind::NoAssertionTest));
    }

    #[test]
    fn mixed_assertions_are_not_mock_only() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,6 @@
 import { a } from \"./a\";
+  it(\"saves\", () => {
+    const saved = save(user);
+    expect(repo.save).toHaveBeenCalledWith(user);
+    expect(saved.id).toBe(7);
+  });
",
        );
        assert!(!has(&out, FindingKind::MockOnlyAssertion));
    }

    #[test]
    fn flags_self_mocking_of_the_subject_module() {
        let out = run_on(
            "\
diff --git a/src/parser.test.ts b/src/parser.test.ts
--- a/src/parser.test.ts
+++ b/src/parser.test.ts
@@ -1,1 +1,3 @@
 import { parse } from \"./parser\";
+vi.mock(\"./parser\");
+vi.mock(\"./network\");
",
        );
        let mocks: Vec<&Finding> = out
            .findings
            .iter()
            .filter(|f| f.kind == FindingKind::MockOnlyAssertion)
            .collect();
        assert_eq!(mocks.len(), 1);
        assert!(mocks[0].message.contains("./parser"));
    }

    #[test]
    fn flags_broad_failure_assertions() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,3 @@
 import { a } from \"./a\";
+    expect(() => run()).toThrow();
+    expect(() => run()).toThrow(RangeError);
",
        );
        let broad: Vec<&Finding> = out
            .findings
            .iter()
            .filter(|f| f.kind == FindingKind::BroadExceptionAssertion)
            .collect();
        assert_eq!(broad.len(), 1);
        assert_eq!(broad[0].line, Some(2));
    }

    #[test]
    fn flags_rust_should_panic_without_expected() {
        let out = run_on(
            "\
diff --git a/tests/api.rs b/tests/api.rs
--- a/tests/api.rs
+++ b/tests/api.rs
@@ -1,1 +1,3 @@
 use crate::a;
+#[should_panic]
+#[should_panic(expected = \"boom\")]
",
        );
        let broad: Vec<&Finding> = out
            .findings
            .iter()
            .filter(|f| f.kind == FindingKind::BroadExceptionAssertion)
            .collect();
        assert_eq!(broad.len(), 1);
    }

    #[test]
    fn flags_assertion_roulette_above_threshold() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,9 @@
 import { a } from \"./a\";
+  it(\"everything\", () => {
+    expect(a).toBe(1);
+    expect(b).toBe(2);
+    expect(c).toBe(3);
+    expect(d).toBe(4);
+    expect(e).toBe(5);
+    expect(f).toBe(6);
+  });
",
        );
        assert!(has(&out, FindingKind::AssertionRoulette));
        assert_eq!(
            out.findings
                .iter()
                .find(|f| f.kind == FindingKind::AssertionRoulette)
                .map(|f| f.message.as_str()),
            Some("6 assertions in one test")
        );
    }

    #[test]
    fn production_files_are_out_of_scope() {
        let out = run_on(
            "\
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,2 @@
 const a = 1;
+expect(a).toBeDefined();
",
        );
        assert!(out.findings.is_empty());
        assert!(out.checked.is_empty());
        assert!(out
            .limits
            .iter()
            .all(|l| l.reason == UncheckedReason::NotApplicable));
        assert_eq!(out.limits.len(), KINDS.len());
    }

    #[test]
    fn unsupported_test_files_are_reported_as_unchecked() {
        let out = run_on(
            "\
diff --git a/py/test_api.py b/py/test_api.py
--- a/py/test_api.py
+++ b/py/test_api.py
@@ -1,1 +1,2 @@
 import pytest
+def test_a(): assert x is not None
",
        );
        assert!(out.findings.is_empty());
        assert_eq!(out.limits.len(), KINDS.len());
        assert!(out
            .limits
            .iter()
            .all(|l| l.reason == UncheckedReason::UnsupportedLanguage));
    }

    #[test]
    fn all_kinds_appear_in_checked_when_a_test_file_is_scanned() {
        let out = run_on(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,2 @@
 import { a } from \"./a\";
+const noop = 1;
",
        );
        let mut checked = out.checked.clone();
        checked.sort();
        assert_eq!(checked.len(), KINDS.len());
        assert!(out.limits.is_empty());
    }
}
