// SPDX-License-Identifier: GPL-3.0-or-later
//! Diff → changed symbols.
//!
//! The three context rules do not read a unified diff; they read *symbols*. So
//! both revisions of every changed file are parsed and their symbol tables are
//! matched on `(container, kind, name)`:
//!
//! - present in the new revision only → **added** (V7 and V8 candidates)
//! - present in both, signature tokens differ → **signature changed** (V9)
//!
//! Files whose language is unsupported, or where either revision fails to
//! parse, are counted and reported as limits. They never become findings —
//! "we could not read it" is not a risk signal (contract §7-⑥).

use std::collections::{BTreeMap, BTreeSet};

use super::extract::extract_source;
use super::lang::{extension_of_path, language_of_path};
use super::model::{SymbolKind, SymbolRecord};

/// One changed file with both sides of the diff. `None` means the file did not
/// exist on that side.
#[derive(Clone, Debug)]
pub struct FileRevision {
    pub path: String,
    pub old_source: Option<String>,
    pub new_source: Option<String>,
}

impl FileRevision {
    pub fn added(path: impl Into<String>, new_source: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            old_source: None,
            new_source: Some(new_source.into()),
        }
    }

    pub fn modified(
        path: impl Into<String>,
        old_source: impl Into<String>,
        new_source: impl Into<String>,
    ) -> Self {
        Self {
            path: path.into(),
            old_source: Some(old_source.into()),
            new_source: Some(new_source.into()),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ChangedSymbol {
    pub path: String,
    pub record: SymbolRecord,
    /// Whether the enclosing file is new in this diff.
    pub in_new_file: bool,
}

#[derive(Clone, Debug, Default)]
pub struct ChangeSet {
    /// Symbols the diff introduces.
    pub added: Vec<ChangedSymbol>,
    /// Symbols that exist on both sides with a different signature.
    pub signature_changed: Vec<ChangedSymbol>,
    /// Every path the diff touches, supported or not — V9 uses it to tell a
    /// caller that was updated from one that was not.
    pub touched_files: BTreeSet<String>,
    /// Extension → count of files outside the language scope.
    pub unsupported: BTreeMap<String, usize>,
    /// Files where at least one revision has an ERROR node.
    pub parse_failed: Vec<String>,
}

impl ChangeSet {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.signature_changed.is_empty()
    }

    pub fn touches(&self, path: &str) -> bool {
        self.touched_files.contains(path)
    }
}

/// Parse both revisions of every file and classify the symbols.
pub fn changed_symbols(revisions: &[FileRevision]) -> ChangeSet {
    let mut set = ChangeSet::default();

    for revision in revisions {
        set.touched_files.insert(revision.path.clone());

        if language_of_path(&revision.path).is_none() {
            *set.unsupported
                .entry(extension_of_path(&revision.path))
                .or_insert(0) += 1;
            continue;
        }

        let Some(new_source) = revision.new_source.as_deref() else {
            continue; // deleted files are V10's business, not this module's
        };
        let Some(new_file) = extract_source(&revision.path, new_source) else {
            set.parse_failed.push(revision.path.clone());
            continue;
        };
        if !new_file.parse_ok {
            set.parse_failed.push(revision.path.clone());
            continue;
        }

        let old_file = revision
            .old_source
            .as_deref()
            .and_then(|source| extract_source(&revision.path, source))
            .filter(|file| file.parse_ok);
        if revision.old_source.is_some() && old_file.is_none() {
            set.parse_failed.push(revision.path.clone());
            continue;
        }

        let in_new_file = revision.old_source.is_none();
        let previous: BTreeMap<SymbolKey, &SymbolRecord> = old_file
            .as_ref()
            .map(|file| {
                file.symbols
                    .iter()
                    .map(|symbol| (key_of(symbol), symbol))
                    .collect()
            })
            .unwrap_or_default();

        for symbol in &new_file.symbols {
            match previous.get(&key_of(symbol)) {
                None => set.added.push(ChangedSymbol {
                    path: revision.path.clone(),
                    record: symbol.clone(),
                    in_new_file,
                }),
                Some(old) if old.signature_hash != symbol.signature_hash => {
                    set.signature_changed.push(ChangedSymbol {
                        path: revision.path.clone(),
                        record: symbol.clone(),
                        in_new_file,
                    })
                }
                Some(_) => {}
            }
        }
    }

    set
}

type SymbolKey = (Option<String>, SymbolKind, String);

fn key_of(symbol: &SymbolRecord) -> SymbolKey {
    (
        symbol.container.clone(),
        symbol.kind,
        symbol.name.clone(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_file_reports_every_symbol_as_added() {
        let set = changed_symbols(&[FileRevision::added(
            "src/a.ts",
            "export function alpha() { return 1; }\nfunction beta() { return 2; }\n",
        )]);
        assert_eq!(set.added.len(), 2);
        assert!(set.added.iter().all(|symbol| symbol.in_new_file));
        assert!(set.signature_changed.is_empty());
    }

    #[test]
    fn a_body_only_edit_is_neither_added_nor_signature_changed() {
        let set = changed_symbols(&[FileRevision::modified(
            "src/a.ts",
            "export function alpha(a: number) { return a; }",
            "export function alpha(a: number) { return a * 2; }",
        )]);
        assert!(set.is_empty());
    }

    #[test]
    fn a_parameter_change_is_a_signature_change() {
        let set = changed_symbols(&[FileRevision::modified(
            "src/a.ts",
            "export function alpha(a: number) { return a; }",
            "export function alpha(a: number, b: string) { return a; }",
        )]);
        assert_eq!(set.signature_changed.len(), 1);
        assert_eq!(set.signature_changed[0].record.name, "alpha");
        assert!(!set.signature_changed[0].in_new_file);
    }

    #[test]
    fn a_new_symbol_in_an_existing_file_is_added() {
        let set = changed_symbols(&[FileRevision::modified(
            "src/a.ts",
            "export function alpha() { return 1; }",
            "export function alpha() { return 1; }\nexport function gamma() { return 3; }",
        )]);
        assert_eq!(set.added.len(), 1);
        assert_eq!(set.added[0].record.name, "gamma");
        assert!(!set.added[0].in_new_file);
    }

    #[test]
    fn unsupported_languages_are_counted_by_extension() {
        let set = changed_symbols(&[
            FileRevision::added("scripts/run.py", "def a(): pass"),
            FileRevision::added("README.md", "# hi"),
            FileRevision::added("docs/other.md", "# hi"),
        ]);
        assert!(set.added.is_empty());
        assert_eq!(set.unsupported.get("py"), Some(&1));
        assert_eq!(set.unsupported.get("md"), Some(&2));
        assert_eq!(set.touched_files.len(), 3);
    }

    #[test]
    fn a_broken_revision_is_recorded_and_produces_no_symbols() {
        let set = changed_symbols(&[FileRevision::added("src/a.ts", "function alpha( { retur\n")]);
        assert!(set.added.is_empty());
        assert_eq!(set.parse_failed, vec!["src/a.ts".to_string()]);
    }

    #[test]
    fn deleted_files_are_touched_but_contribute_no_symbols() {
        let set = changed_symbols(&[FileRevision {
            path: "src/a.ts".into(),
            old_source: Some("export function alpha() {}".into()),
            new_source: None,
        }]);
        assert!(set.is_empty());
        assert!(set.touches("src/a.ts"));
    }

    #[test]
    fn rust_signature_changes_are_detected_too() {
        let set = changed_symbols(&[FileRevision::modified(
            "src/a.rs",
            "pub fn alpha(a: u32) -> u32 { a }",
            "pub fn alpha(a: u32, b: u32) -> u32 { a }",
        )]);
        assert_eq!(set.signature_changed.len(), 1);
    }
}
