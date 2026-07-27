// SPDX-License-Identifier: GPL-3.0-or-later
//! Extension → language mapping, grammar handles, and the shared syntax
//! vocabulary this module compares against.
//!
//! **Reconciliation note.** `SyntaxLanguage`, `SymbolKind` and `Span` are
//! defined here with the exact shape (and serde representation) of the same
//! three types in `verify::context::model`. That module owns the vocabulary but
//! is not yet declarable — it has no `mod.rs` — so `structural` carries its own
//! copy to stay compilable. When `verify::context` lands, delete the three
//! definitions below and replace them with:
//!
//! ```ignore
//! pub use crate::verify::context::lang::{language_of_path, parser_for};
//! pub use crate::verify::context::model::{Span, SymbolKind, SyntaxLanguage};
//! ```
//!
//! Nothing else in `structural` needs to change: every consumer imports these
//! names from this file.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tree_sitter::{Language, Node, Parser};

/// The whole supported language surface (contract §0 / spec §7-⑤).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SyntaxLanguage {
    TypeScript,
    Tsx,
    JavaScript,
    Jsx,
    Rust,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LanguageFamily {
    JsFamily,
    Rust,
}

impl SyntaxLanguage {
    /// TS/TSX/JS/JSX share one declaration vocabulary; Rust has its own. The
    /// extractor branches on this and nothing else.
    pub fn family(self) -> LanguageFamily {
        match self {
            SyntaxLanguage::Rust => LanguageFamily::Rust,
            _ => LanguageFamily::JsFamily,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Interface,
    TypeAlias,
    Const,
    Struct,
    Enum,
    Trait,
    Impl,
    Macro,
}

impl SymbolKind {
    /// Only these declare parameters, so only these carry an arity worth
    /// asserting on a `refactor:` commit (V17).
    pub fn is_callable(self) -> bool {
        matches!(self, SymbolKind::Function | SymbolKind::Method)
    }
}

/// 1-based inclusive lines, half-open byte range.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start_line: u32,
    pub end_line: u32,
    pub start_byte: u32,
    pub end_byte: u32,
}

impl Span {
    pub fn of(node: Node) -> Self {
        Self {
            start_line: node.start_position().row as u32 + 1,
            end_line: node.end_position().row as u32 + 1,
            start_byte: node.start_byte() as u32,
            end_byte: node.end_byte() as u32,
        }
    }
}

/// `None` means "outside the TS/JS/Rust scope" — the caller records a
/// `ScanLimit{UnsupportedLanguage}` rather than skipping it silently (§7-⑤).
pub fn language_of_path(path: &str) -> Option<SyntaxLanguage> {
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let ext = file.rsplit_once('.').map(|(_, ext)| ext)?;
    match ext.to_ascii_lowercase().as_str() {
        "ts" | "mts" | "cts" => Some(SyntaxLanguage::TypeScript),
        "tsx" => Some(SyntaxLanguage::Tsx),
        "js" | "mjs" | "cjs" => Some(SyntaxLanguage::JavaScript),
        "jsx" => Some(SyntaxLanguage::Jsx),
        "rs" => Some(SyntaxLanguage::Rust),
        _ => None,
    }
}

/// Grammars are `Send + Sync` and are built once per process — compiling one is
/// far more expensive than parsing a file with it.
fn grammar(language: SyntaxLanguage) -> &'static Language {
    static TYPESCRIPT: OnceLock<Language> = OnceLock::new();
    static TSX: OnceLock<Language> = OnceLock::new();
    static JAVASCRIPT: OnceLock<Language> = OnceLock::new();
    static RUST: OnceLock<Language> = OnceLock::new();

    match language {
        SyntaxLanguage::TypeScript => {
            TYPESCRIPT.get_or_init(|| tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
        }
        SyntaxLanguage::Tsx => TSX.get_or_init(|| tree_sitter_typescript::LANGUAGE_TSX.into()),
        // JSX is a superset the JavaScript grammar already parses.
        SyntaxLanguage::JavaScript | SyntaxLanguage::Jsx => {
            JAVASCRIPT.get_or_init(|| tree_sitter_javascript::LANGUAGE.into())
        }
        SyntaxLanguage::Rust => RUST.get_or_init(|| tree_sitter_rust::LANGUAGE.into()),
    }
}

/// A parser bound to `language`. `Err` is impossible for a grammar we ship, so
/// an ABI mismatch is logged and surfaces as "cannot compare" rather than as a
/// user-facing error.
pub fn parser_for(language: SyntaxLanguage) -> Option<Parser> {
    let mut parser = Parser::new();
    match parser.set_language(grammar(language)) {
        Ok(()) => Some(parser),
        Err(e) => {
            tracing::warn!("[verify] grammar for {:?} failed to load: {}", language, e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_map_to_languages_case_insensitively() {
        assert_eq!(
            language_of_path("src/a.ts"),
            Some(SyntaxLanguage::TypeScript)
        );
        assert_eq!(
            language_of_path("src/a.d.ts"),
            Some(SyntaxLanguage::TypeScript)
        );
        assert_eq!(language_of_path("src/A.TSX"), Some(SyntaxLanguage::Tsx));
        assert_eq!(
            language_of_path("src/a.mjs"),
            Some(SyntaxLanguage::JavaScript)
        );
        assert_eq!(language_of_path("src/a.jsx"), Some(SyntaxLanguage::Jsx));
        assert_eq!(
            language_of_path("src-tauri/src/a.rs"),
            Some(SyntaxLanguage::Rust)
        );
    }

    #[test]
    fn unsupported_and_extensionless_paths_map_to_none() {
        assert_eq!(language_of_path("main.py"), None);
        assert_eq!(language_of_path("Makefile"), None);
        // A directory that looks like a source file must not leak its extension.
        assert_eq!(language_of_path("dir.ts/Makefile"), None);
    }

    #[test]
    fn every_grammar_parses_its_own_language_without_errors() {
        let cases = [
            (
                SyntaxLanguage::TypeScript,
                "export function a(b: number) { return b; }",
            ),
            (
                SyntaxLanguage::Tsx,
                "export const A = () => <div className=\"x\">hi</div>;",
            ),
            (
                SyntaxLanguage::JavaScript,
                "export function a(b) { return b; }",
            ),
            (SyntaxLanguage::Jsx, "export const A = () => <div>hi</div>;"),
            (SyntaxLanguage::Rust, "pub fn a(b: u32) -> u32 { b }"),
        ];
        for (language, source) in cases {
            let mut parser = parser_for(language).expect("grammar loads");
            let tree = parser.parse(source, None).expect("parse succeeds");
            assert!(
                !tree.root_node().has_error(),
                "{:?} produced an ERROR node",
                language
            );
        }
    }
}
