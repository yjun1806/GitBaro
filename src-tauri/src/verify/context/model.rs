// SPDX-License-Identifier: GPL-3.0-or-later
//! Record shapes for the codebase symbol index (design §4).
//!
//! These are the on-disk *and* on-the-wire shapes: the shard cache stores them
//! verbatim as JSON, and the blast-radius command hands them to the frontend.
//! Every consumer (`reinvent.rs`, `reach.rs`, `changes.rs`) treats this file as
//! read-only vocabulary.

use serde::{Deserialize, Serialize};

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

impl SyntaxLanguage {
    /// TS/TSX/JS/JSX share one token vocabulary, so their symbols may be
    /// compared against each other; Rust may not be compared against them.
    pub fn family(self) -> LanguageFamily {
        match self {
            SyntaxLanguage::Rust => LanguageFamily::Rust,
            _ => LanguageFamily::JsFamily,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LanguageFamily {
    JsFamily,
    Rust,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
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
    /// Only these carry a body worth comparing for clones (V7) or a signature
    /// worth tracking for callers (V9).
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

/// The cheap cache probe (design §3.3 step 1). A matching stamp means the file
/// is not even opened.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub size: u64,
    pub mtime_ms: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SymbolRecord {
    pub name: String,
    pub kind: SymbolKind,
    /// TS/JS `export`, Rust `pub` / `pub(crate)`.
    pub exported: bool,
    /// Enclosing class / impl name; `None` at the top level.
    pub container: Option<String>,
    pub span: Span,
    /// Body only, so a signature-only change can be told apart from a rewrite.
    pub body_span: Option<Span>,
    pub token_count: u32,
    /// Winnowed k-gram fingerprint of the identifier-normalized stream (V7).
    /// Sorted and deduplicated.
    pub fingerprint: Vec<u32>,
    /// Hash of the raw token stream — comments included (unchanged / moved).
    pub raw_token_hash: u64,
    /// Hash of the identifier-normalized stream (rename-only detection).
    pub norm_token_hash: u64,
    /// Hash of the tokens outside `body_span` — the signature (V9).
    pub signature_hash: u64,
    /// Identifiers referenced inside this symbol, deduplicated. Feeds the V9
    /// reverse call edge without a span lookup.
    pub calls: Vec<String>,
    /// Rust attribute / TS decorator names, e.g. `tauri::command` (V8).
    pub attributes: Vec<String>,
}

impl SymbolRecord {
    /// `Container::name` when nested, else the bare name. The V1-style match key.
    pub fn qualified_name(&self) -> String {
        match &self.container {
            Some(container) => format!("{container}::{}", self.name),
            None => self.name.clone(),
        }
    }

    pub fn has_attribute(&self, needle: &str) -> bool {
        self.attributes.iter().any(|attr| attr == needle)
    }
}

/// One identifier occurrence that is *not* a definition name.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdentifierRef {
    pub name: String,
    pub line: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportRecord {
    /// `"@/lib/utils"` · `"crate::verify::types"`.
    pub module: String,
    pub names: Vec<String>,
    pub line: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileSymbols {
    /// Repository-relative, slash separated.
    pub path: String,
    pub language: SyntaxLanguage,
    /// `git2::Oid::hash_file` hex of the bytes we actually parsed.
    pub content_id: String,
    pub stamp: FileStamp,
    pub symbols: Vec<SymbolRecord>,
    pub references: Vec<IdentifierRef>,
    pub imports: Vec<ImportRecord>,
    /// Parsed with no ERROR/MISSING node. When false the token streams are
    /// garbage, so the file is **never** used as a clone candidate — only its
    /// `references` are trusted, and only as negative evidence for V8.
    pub parse_ok: bool,
}

impl FileSymbols {
    pub fn is_test_file(&self) -> bool {
        is_test_path(&self.path)
    }
}

/// Path-based test verdict, matching `verify::rules::context::is_test_path`
/// without depending on that module's private item.
pub fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.contains("__tests__/")
        || lower.contains("__mocks__/")
        || lower.contains("/tests/")
        || lower.starts_with("tests/")
        || lower.ends_with("_test.rs")
        || lower.ends_with("_tests.rs")
        || lower.contains("/test_support")
        || lower.ends_with("/testutil.rs")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualified_name_includes_the_container() {
        let symbol = SymbolRecord {
            name: "run".into(),
            kind: SymbolKind::Method,
            exported: true,
            container: Some("Engine".into()),
            span: Span::default(),
            body_span: None,
            token_count: 0,
            fingerprint: Vec::new(),
            raw_token_hash: 0,
            norm_token_hash: 0,
            signature_hash: 0,
            calls: Vec::new(),
            attributes: vec!["tauri::command".into()],
        };
        assert_eq!(symbol.qualified_name(), "Engine::run");
        assert!(symbol.has_attribute("tauri::command"));
        assert!(!symbol.has_attribute("test"));
    }

    #[test]
    fn test_paths_are_recognised_across_both_ecosystems() {
        assert!(is_test_path("src/lib/utils.test.ts"));
        assert!(is_test_path("src/__tests__/a.tsx"));
        assert!(is_test_path("tests/integration.rs"));
        assert!(is_test_path("src/verify/hygiene/test_support.rs"));
        assert!(!is_test_path("src/lib/utils.ts"));
    }

    #[test]
    fn js_family_and_rust_never_share_a_family() {
        assert_eq!(SyntaxLanguage::Tsx.family(), LanguageFamily::JsFamily);
        assert_eq!(SyntaxLanguage::JavaScript.family(), LanguageFamily::JsFamily);
        assert_eq!(SyntaxLanguage::Rust.family(), LanguageFamily::Rust);
    }
}
