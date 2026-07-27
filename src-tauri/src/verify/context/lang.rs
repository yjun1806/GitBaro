// SPDX-License-Identifier: GPL-3.0-or-later
//! Extension → language mapping and tree-sitter grammar handles.
//!
//! Grammars are `Send + Sync` and cheap to clone (they are `&'static` tables
//! behind a pointer), so each is built once in a `OnceLock` and handed out by
//! reference. Parsers are *not* `Sync` and are created per call site.

use std::sync::OnceLock;

use tree_sitter::{Language, Parser};

use super::model::SyntaxLanguage;

/// `None` means "outside the TS/JS/Rust scope" — the caller counts it into a
/// `ScanLimit{UnsupportedLanguage}` rather than skipping it silently (§7-⑤).
pub fn language_of_path(path: &str) -> Option<SyntaxLanguage> {
    let file = path.rsplit('/').next().unwrap_or(path);
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

/// The extension used for `skipped_by_language` accounting. Lowercased, without
/// the dot; `""` for an extensionless file.
pub fn extension_of_path(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn grammar(language: SyntaxLanguage) -> &'static Language {
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
/// the ABI mismatch is logged and reported as "cannot parse" rather than
/// bubbling a user-facing error.
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
        assert_eq!(language_of_path("src/a.rs"), Some(SyntaxLanguage::Rust));
    }

    #[test]
    fn unsupported_and_extensionless_paths_map_to_none() {
        assert_eq!(language_of_path("main.py"), None);
        assert_eq!(language_of_path("Makefile"), None);
        assert_eq!(language_of_path("dir.ts/Makefile"), None);
        assert_eq!(extension_of_path("main.PY"), "py");
        assert_eq!(extension_of_path("Makefile"), "");
    }

    #[test]
    fn every_grammar_parses_its_own_language_without_errors() {
        let cases = [
            (SyntaxLanguage::TypeScript, "export function a(b: number) { return b; }"),
            (SyntaxLanguage::Tsx, "export const A = () => <div className=\"x\">hi</div>;"),
            (SyntaxLanguage::JavaScript, "export function a(b) { return b; }"),
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
