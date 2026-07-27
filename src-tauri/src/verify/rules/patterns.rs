// SPDX-License-Identifier: GPL-3.0-or-later
//! Literal token tables shared by the static diff rules.
//!
//! Contract §5 rules out a regex crate on purpose: every signal here is a
//! literal substring test against a whitespace-trimmed line. When a signal
//! genuinely needs more than that, it needs an AST (V1) — not a regex.

use super::context::{ChangedLine, Language};

/// Longest snippet quoted back as evidence in `Finding::detail`.
pub const MAX_SNIPPET_CHARS: usize = 160;
/// Hard cap on an assembled `Finding::detail` (contract §2.2).
pub const MAX_DETAIL_CHARS: usize = 512;

// ── V2 · test disabling markers ──────────────────────────────────────────────

pub const JS_SKIP_MARKERS: &[&str] = &[
    "it.skip(",
    "test.skip(",
    "describe.skip(",
    "suite.skip(",
    "context.skip(",
    "it.todo(",
    "test.todo(",
    "describe.todo(",
    "xit(",
    "xtest(",
    "xdescribe(",
    "xcontext(",
    "it.concurrent.skip(",
    "test.concurrent.skip(",
    ".skipIf(",
];

pub const RUST_SKIP_MARKERS: &[&str] = &["#[ignore]", "#[ignore =", "#[ignore("];

// ── V2 · assertion tokens ────────────────────────────────────────────────────

pub const JS_ASSERTION_TOKENS: &[&str] =
    &["expect(", "assert(", "assert.", ".should.", "expectTypeOf("];

pub const RUST_ASSERTION_TOKENS: &[&str] = &[
    "assert!",
    "assert_eq!",
    "assert_ne!",
    "assert_matches!",
    "debug_assert!",
    "debug_assert_eq!",
    "debug_assert_ne!",
];

// ── V3 · test quality anti-patterns ──────────────────────────────────────────

/// Assertions that pass for almost any value.
pub const JS_VACUOUS_ASSERTIONS: &[&str] = &[
    "toBeDefined()",
    "toBeTruthy()",
    "toBeFalsy()",
    "not.toBeNull()",
    "not.toBeUndefined()",
    "expect.anything()",
    "toBeInstanceOf(Object)",
];

/// `assert!(x.is_ok())` is the Rust shape of "is not None" — it proves a value
/// exists without checking it.
pub const RUST_VACUOUS_SUFFIXES: &[&str] = &[".is_ok()", ".is_some()", ".is_empty()"];

pub const MOCK_CALL_ASSERTIONS: &[&str] = &[
    "toHaveBeenCalled(",
    "toHaveBeenCalledTimes(",
    "toHaveBeenCalledWith(",
    "toHaveBeenCalledOnce(",
    "toHaveBeenNthCalledWith(",
    "toHaveBeenLastCalledWith(",
    "toBeCalled(",
    "toBeCalledWith(",
    "toBeCalledTimes(",
];

pub const MOCK_FACTORIES: &[&str] = &["vi.mock(", "jest.mock(", "mock.module("];

/// Test declarations, used to slice added lines into per-test blocks.
pub const JS_TEST_DECLARATIONS: &[&str] = &[
    "it(",
    "test(",
    "it.each(",
    "test.each(",
    "it.concurrent(",
    "test.concurrent(",
];

pub const RUST_TEST_ATTRIBUTES: &[&str] = &["#[test]", "#[tokio::test]", "#[rstest]"];

// ── V5 · verification bypass ─────────────────────────────────────────────────

/// Suppressions that switch a checker off outright.
pub const JS_BYPASS_PRAGMAS: &[&str] = &[
    "@ts-ignore",
    "@ts-nocheck",
    "eslint-disable",
    "biome-ignore",
    "oxlint-disable",
    "istanbul ignore",
    "c8 ignore",
    "v8 ignore",
    "--no-verify",
];

/// Blanket Rust suppressions. Narrow on purpose — a targeted `#[allow(dead_code)]`
/// is ordinary, a crate-wide `#![allow(...)]` is not.
pub const RUST_BYPASS_PRAGMAS: &[&str] = &[
    "#![allow(",
    "#[allow(warnings)",
    "#[allow(unused_must_use)",
    "#[allow(clippy::",
    "--no-verify",
];

/// Type escape hatches — sanctioned but still a hole in the type checker.
pub const TS_ESCAPE_HATCHES: &[&str] = &[
    "as any",
    "as unknown as",
    ": any",
    "<any>",
    "any[]",
    "@ts-expect-error",
];

pub const RUST_UNWRAPS: &[&str] = &[".unwrap()", ".unwrap_unchecked()"];

// ── V10 · deletion classification ────────────────────────────────────────────

pub const JS_PUBLIC_EXPORT_PREFIXES: &[&str] = &[
    "export ",
    "export{",
    "export*",
    "module.exports",
    "exports.",
];

pub const RUST_PUBLIC_EXPORT_PREFIXES: &[&str] = &[
    "pub fn ",
    "pub async fn ",
    "pub unsafe fn ",
    "pub struct ",
    "pub enum ",
    "pub trait ",
    "pub const ",
    "pub static ",
    "pub type ",
    "pub mod ",
    "pub use ",
];

pub const JS_ERROR_HANDLING_TOKENS: &[&str] = &[
    "try {",
    "catch (",
    "catch(",
    "} catch",
    "finally {",
    "throw ",
    ".catch(",
    "Promise.reject",
];

pub const RUST_ERROR_HANDLING_TOKENS: &[&str] = &[
    "Err(",
    ".map_err(",
    ".ok_or(",
    ".ok_or_else(",
    ".unwrap_or_else(",
    "panic!(",
];

/// Lowercased substrings that mark input validation in either language.
pub const VALIDATION_TOKENS: &[&str] = &[
    "validate",
    "validation",
    "isvalid",
    "sanitiz",
    ".safeparse(",
    "schema.parse(",
    "z.object(",
];

// ── Matching helpers ─────────────────────────────────────────────────────────

/// First table entry contained in `line`, kept for quoting as evidence.
pub fn first_match<'t>(line: &str, tokens: &[&'t str]) -> Option<&'t str> {
    tokens.iter().copied().find(|token| line.contains(token))
}

pub fn contains_any(line: &str, tokens: &[&str]) -> bool {
    first_match(line, tokens).is_some()
}

/// Whether the trimmed line is a comment. Rules that hunt for pragmas must
/// *not* use this — a pragma lives inside a comment by definition.
pub fn is_comment(trimmed: &str, language: Language) -> bool {
    if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
        return true;
    }
    language.is_js_family() && trimmed.starts_with("<!--")
}

pub fn skip_markers(language: Language) -> &'static [&'static str] {
    match language {
        Language::Rust => RUST_SKIP_MARKERS,
        _ => JS_SKIP_MARKERS,
    }
}

pub fn assertion_tokens(language: Language) -> &'static [&'static str] {
    match language {
        Language::Rust => RUST_ASSERTION_TOKENS,
        _ => JS_ASSERTION_TOKENS,
    }
}

pub fn is_assertion_line(trimmed: &str, language: Language) -> bool {
    !is_comment(trimmed, language) && contains_any(trimmed, assertion_tokens(language))
}

/// Lines matching `token`, optionally ignoring comments.
pub fn lines_matching<'a>(
    lines: &'a [ChangedLine],
    token: &str,
    language: Language,
    ignore_comments: bool,
) -> Vec<&'a ChangedLine> {
    lines
        .iter()
        .filter(|line| {
            let trimmed = line.text.trim_start();
            if ignore_comments && is_comment(trimmed, language) {
                return false;
            }
            trimmed.contains(token)
        })
        .collect()
}

/// The added occurrences that are genuinely new.
///
/// Reindenting or rewording a line that already carried the token shows up as
/// one removal plus one addition; netting them out is what keeps a moved
/// `it.skip` or `@ts-ignore` from being reported as newly introduced.
pub fn net_new(added: Vec<&ChangedLine>, removed_count: usize) -> Vec<&ChangedLine> {
    let net = added.len().saturating_sub(removed_count);
    added.into_iter().take(net).collect()
}

/// Truncate on a char boundary so evidence never splits a multi-byte glyph.
pub fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", cut)
}

pub fn snippet(text: &str) -> String {
    truncate_chars(text.trim(), MAX_SNIPPET_CHARS)
}

/// Join evidence lines into a `Finding::detail`, capped at 512 chars.
pub fn detail_from(parts: &[String]) -> String {
    truncate_chars(&parts.join("\n"), MAX_DETAIL_CHARS)
}

/// `"  12: expect(x).toBeDefined()"` — a quotable evidence line.
pub fn evidence(line: &ChangedLine) -> String {
    format!("{}: {}", line.line_no, snippet(&line.text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(no: u32, text: &str) -> ChangedLine {
        ChangedLine {
            line_no: no,
            text: text.to_string(),
        }
    }

    #[test]
    fn first_match_returns_the_matched_token() {
        assert_eq!(
            first_match("  it.skip(\"a\", () => {", JS_SKIP_MARKERS),
            Some("it.skip(")
        );
        assert_eq!(first_match("it(\"a\", () => {", JS_SKIP_MARKERS), None);
    }

    #[test]
    fn comments_are_recognised_per_language() {
        assert!(is_comment("// @ts-ignore", Language::TypeScript));
        assert!(is_comment("/* eslint-disable */", Language::JavaScript));
        assert!(is_comment("* doc line", Language::Rust));
        assert!(!is_comment("let a = 1; // trailing", Language::Rust));
    }

    #[test]
    fn net_new_cancels_moved_lines() {
        let added = [line(1, "it.skip(\"a\")"), line(2, "it.skip(\"b\")")];
        let refs: Vec<&ChangedLine> = added.iter().collect();
        assert_eq!(net_new(refs.clone(), 0).len(), 2);
        assert_eq!(net_new(refs.clone(), 1).len(), 1);
        assert_eq!(net_new(refs.clone(), 2).len(), 0);
        assert_eq!(net_new(refs, 9).len(), 0);
    }

    #[test]
    fn lines_matching_can_ignore_comments() {
        let lines = vec![
            line(1, "  // it.skip(\"disabled\")"),
            line(2, "  it.skip(\"real\")"),
        ];
        let with_comments = lines_matching(&lines, "it.skip(", Language::TypeScript, false);
        assert_eq!(with_comments.len(), 2);
        let without = lines_matching(&lines, "it.skip(", Language::TypeScript, true);
        assert_eq!(without.len(), 1);
        assert_eq!(without[0].line_no, 2);
    }

    #[test]
    fn truncation_is_char_safe_and_capped() {
        let long = "가".repeat(700);
        let out = detail_from(&[long]);
        assert_eq!(out.chars().count(), MAX_DETAIL_CHARS);
        assert!(out.ends_with('…'));
        assert_eq!(truncate_chars("short", 10), "short");
    }

    #[test]
    fn assertion_detection_is_language_aware() {
        assert!(is_assertion_line(
            "expect(a).toBe(1);",
            Language::TypeScript
        ));
        assert!(is_assertion_line("assert_eq!(a, 1);", Language::Rust));
        assert!(!is_assertion_line(
            "// expect(a).toBe(1);",
            Language::TypeScript
        ));
        assert!(!is_assertion_line("let a = expected;", Language::Rust));
    }
}
