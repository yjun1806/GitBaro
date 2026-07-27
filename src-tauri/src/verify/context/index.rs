// SPDX-License-Identifier: GPL-3.0-or-later
//! The in-memory symbol index and its query API.
//!
//! **An absent or partial index is not "clean".** `complete == false` makes V7
//! and V8 refuse to run and emit `ScanLimit{MissingArtifact}` instead of zero
//! findings, because "we did not look" and "we looked and found nothing" are
//! different answers (contract §7-①).
//!
//! Lookups are linear scans rather than maintained maps. The query count per
//! scan is bounded by the number of changed symbols (tens), so a scan over
//! ~50k files costs single-digit milliseconds and avoids a second copy of every
//! name in the repository.

use std::collections::BTreeMap;

use super::model::{FileSymbols, SymbolRecord};

/// Where a symbol lives. Borrowed rather than owned so a query does not clone
/// the record.
#[derive(Clone, Copy, Debug)]
pub struct SymbolRef<'a> {
    pub path: &'a str,
    pub symbol: &'a SymbolRecord,
}

/// One identifier occurrence attributable to an enclosing symbol.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Occurrence {
    pub path: String,
    pub line: u32,
    /// Enclosing symbol name; `None` for top-level code.
    pub symbol: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct RepoIndex {
    /// Visible to `build` and `cache` so they can seed an index with struct
    /// update syntax; every other module goes through the query methods.
    pub(super) files: BTreeMap<String, FileSymbols>,
    /// False whenever a build was cancelled, truncated or budget-limited.
    pub complete: bool,
    /// Paths enumerated, including the ones skipped.
    pub files_total: usize,
    /// Epoch milliseconds of the last successful build.
    pub built_at: Option<i64>,
    /// Extension → count, for the `UnsupportedLanguage` limit detail (§7-⑤).
    pub skipped_by_language: BTreeMap<String, usize>,
    /// Files past `MAX_SOURCE_BYTES` or the file cap.
    pub skipped_by_budget: usize,
    /// Files parsed with an ERROR node — observability for design §12-1.
    pub parse_failed: usize,
}

impl RepoIndex {
    pub fn insert(&mut self, file: FileSymbols) {
        if !file.parse_ok {
            self.parse_failed += 1;
        }
        self.files.insert(file.path.clone(), file);
    }

    pub fn remove(&mut self, path: &str) {
        if let Some(removed) = self.files.remove(path) {
            if !removed.parse_ok {
                self.parse_failed = self.parse_failed.saturating_sub(1);
            }
        }
    }

    pub fn file(&self, path: &str) -> Option<&FileSymbols> {
        self.files.get(path)
    }

    pub fn files(&self) -> impl Iterator<Item = &FileSymbols> {
        self.files.values()
    }

    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    pub fn symbol_count(&self) -> usize {
        self.files.values().map(|file| file.symbols.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// Every symbol carrying `name`, anywhere. More than one hit means
    /// name-based resolution is ambiguous and V9 has to say so.
    pub fn definitions_of(&self, name: &str) -> Vec<SymbolRef<'_>> {
        self.files
            .values()
            .flat_map(|file| {
                file.symbols
                    .iter()
                    .filter(move |symbol| symbol.name == name)
                    .map(move |symbol| SymbolRef {
                        path: file.path.as_str(),
                        symbol,
                    })
            })
            .collect()
    }

    /// Every symbol in the index, for candidate enumeration.
    pub fn all_symbols(&self) -> impl Iterator<Item = SymbolRef<'_>> {
        self.files.values().flat_map(|file| {
            file.symbols.iter().map(move |symbol| SymbolRef {
                path: file.path.as_str(),
                symbol,
            })
        })
    }

    /// Occurrences of `name` that are not its own definition, attributed to the
    /// enclosing symbol when one contains the line.
    pub fn occurrences_of(&self, name: &str) -> Vec<Occurrence> {
        let mut hits = Vec::new();
        for file in self.files.values() {
            for reference in file.references.iter().filter(|r| r.name == name) {
                hits.push(Occurrence {
                    path: file.path.clone(),
                    line: reference.line,
                    symbol: enclosing_symbol(file, reference.line),
                });
            }
        }
        hits
    }

    /// How many files other than `path` mention `name` at all — the cheap
    /// negative test V8 needs before it spends anything on a candidate.
    pub fn referencing_files(&self, name: &str, excluding: &str) -> usize {
        self.files
            .values()
            .filter(|file| file.path != excluding)
            .filter(|file| {
                file.references.iter().any(|r| r.name == name)
                    || file.symbols.iter().any(|s| s.calls.iter().any(|c| c == name))
                    // Imports are excluded from `references` on purpose (they
                    // are not call sites), so V8 has to consult them here.
                    || file
                        .imports
                        .iter()
                        .any(|import| import.names.iter().any(|n| n == name))
            })
            .count()
    }
}

/// The innermost recorded symbol whose span covers `line`.
fn enclosing_symbol(file: &FileSymbols, line: u32) -> Option<String> {
    file.symbols
        .iter()
        .filter(|symbol| symbol.span.start_line <= line && line <= symbol.span.end_line)
        .min_by_key(|symbol| symbol.span.end_line - symbol.span.start_line)
        .map(|symbol| symbol.name.clone())
}

#[cfg(test)]
pub(crate) mod fixture {
    use super::*;
    use crate::verify::context::extract::extract_source;

    /// Build an index straight from `(path, source)` pairs. This is the API
    /// every rule test uses, so rules stay testable without touching disk.
    pub fn index_from_sources(sources: &[(&str, &str)]) -> RepoIndex {
        let mut index = RepoIndex {
            complete: true,
            built_at: Some(0),
            ..RepoIndex::default()
        };
        for (path, source) in sources {
            let file = extract_source(path, source)
                .unwrap_or_else(|| panic!("{path} is not a supported language"));
            index.insert(file);
        }
        index.files_total = index.file_count();
        index
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::index_from_sources;

    #[test]
    fn definitions_are_found_by_name_across_files() {
        let index = index_from_sources(&[
            ("src/a.ts", "export function shared() { return 1; }"),
            ("src/b.ts", "export function shared() { return 2; }"),
            ("src/c.ts", "export function unique() { return 3; }"),
        ]);
        assert_eq!(index.definitions_of("shared").len(), 2);
        assert_eq!(index.definitions_of("unique").len(), 1);
        assert_eq!(index.definitions_of("absent").len(), 0);
    }

    #[test]
    fn occurrences_are_attributed_to_the_enclosing_symbol() {
        let index = index_from_sources(&[
            ("src/a.ts", "export function target() { return 1; }"),
            (
                "src/b.ts",
                "import { target } from \"./a\";\nexport function caller() {\n  return target();\n}\n",
            ),
        ]);
        let hits = index.occurrences_of("target");
        let inside_caller = hits
            .iter()
            .find(|hit| hit.symbol.as_deref() == Some("caller"))
            .expect("the call inside caller() is attributed");
        assert_eq!(inside_caller.path, "src/b.ts");
        assert_eq!(inside_caller.line, 3);
    }

    #[test]
    fn referencing_files_ignores_the_defining_file() {
        let index = index_from_sources(&[
            (
                "src/a.ts",
                "export function target() { return target.name; }",
            ),
            ("src/b.ts", "export const x = 1;"),
            ("src/c.ts", "export const y = target();"),
        ]);
        assert_eq!(
            index.referencing_files("target", "src/a.ts"),
            1,
            "self-references inside the defining file do not count"
        );
        assert_eq!(index.referencing_files("x", "src/a.ts"), 0);
    }

    #[test]
    fn an_import_counts_as_a_reference_but_not_as_a_call_site() {
        let index = index_from_sources(&[
            ("src/a.ts", "export function target() { return 1; }"),
            ("src/b.ts", "import { target } from \"./a\";\nexport const ready = 1;\n"),
        ]);
        assert_eq!(
            index.referencing_files("target", "src/a.ts"),
            1,
            "V8 must see the import"
        );
        assert!(
            index.occurrences_of("target").is_empty(),
            "V9 must not count an import line as a call site"
        );
    }

    #[test]
    fn counters_track_file_and_symbol_totals() {
        let index = index_from_sources(&[
            ("src/a.ts", "export function a() {}\nfunction b() {}"),
            ("src/c.rs", "pub fn c() {}"),
        ]);
        assert_eq!(index.file_count(), 2);
        assert_eq!(index.symbol_count(), 3);
        assert_eq!(index.parse_failed, 0);
        assert!(index.complete);
    }
}
