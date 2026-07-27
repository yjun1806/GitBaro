// SPDX-License-Identifier: GPL-3.0-or-later
//! The classifications V1 exists to produce, and the per-file summary the UI
//! uses to collapse noise.
//!
//! Both ladders are decided top-down and stop at the first match, so each
//! verdict means "this and nothing weaker".

use serde::{Deserialize, Serialize};

use super::extract::StructuralSymbol;
use super::tokens::TokenStreams;

/// What changed about a whole file. Everything except `Semantic` is noise a
/// reviewer can skip — that claim is the entire value of this rule, which is
/// why a parse failure degrades instead of guessing (see `mod.rs`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileVerdict {
    /// Byte-identical; only reachable when the diff was about line endings.
    Identical,
    /// Identical raw token stream — whitespace, indentation, line breaks,
    /// trailing commas, brace style. A reformatter cannot produce anything else.
    FormattingOnly,
    /// Identical code stream: only comments moved or changed.
    CommentsOnly,
    /// Identical normalized stream: only identifier names changed.
    RenameOnly,
    /// Every declaration survived unchanged; some were reordered.
    Moved,
    /// Something actually changed. The symbol table says what.
    Semantic,
}

impl FileVerdict {
    /// Whether a reviewer can skip the file. `Semantic` is the only verdict
    /// that demands attention.
    pub fn is_noise(self) -> bool {
        !matches!(self, FileVerdict::Semantic)
    }

    /// Untranslated factual phrase for a `Finding::message` (contract §2).
    pub fn describe(self) -> &'static str {
        match self {
            FileVerdict::Identical => "identical",
            FileVerdict::FormattingOnly => "formatting only",
            FileVerdict::CommentsOnly => "comments only",
            FileVerdict::RenameOnly => "identifier renames only",
            FileVerdict::Moved => "code motion only",
            FileVerdict::Semantic => "semantic",
        }
    }
}

/// The token-stream ladder. `identical_bytes` is passed in because two byte
/// sequences that differ only in line endings still produce equal streams, and
/// the distinction is worth keeping.
pub fn file_verdict(old: &TokenStreams, new: &TokenStreams, identical_bytes: bool) -> FileVerdict {
    if identical_bytes {
        FileVerdict::Identical
    } else if old.raw == new.raw {
        FileVerdict::FormattingOnly
    } else if old.code == new.code {
        FileVerdict::CommentsOnly
    } else if old.norm == new.norm {
        FileVerdict::RenameOnly
    } else {
        FileVerdict::Semantic
    }
}

/// What changed about one matched declaration.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SymbolVerdict {
    Unchanged,
    /// Same tokens, different position among the file's declarations.
    Moved,
    CommentsOnly,
    RenameOnly,
    /// Body tokens identical, signature tokens not — the case that tells a
    /// reviewer to go look at the call sites.
    SignatureOnly,
    Changed,
    Added,
    Removed,
}

impl SymbolVerdict {
    /// Whether this symbol is one a reviewer must actually read.
    pub fn is_semantic(self) -> bool {
        matches!(
            self,
            SymbolVerdict::SignatureOnly
                | SymbolVerdict::Changed
                | SymbolVerdict::Added
                | SymbolVerdict::Removed
        )
    }
}

pub fn symbol_verdict(old: &StructuralSymbol, new: &StructuralSymbol) -> SymbolVerdict {
    if old.raw_hash == new.raw_hash {
        return if old.ordinal == new.ordinal {
            SymbolVerdict::Unchanged
        } else {
            SymbolVerdict::Moved
        };
    }
    if old.code_hash == new.code_hash {
        return SymbolVerdict::CommentsOnly;
    }
    if old.norm_hash == new.norm_hash {
        return SymbolVerdict::RenameOnly;
    }
    match (old.body_raw_hash, new.body_raw_hash) {
        (Some(a), Some(b)) if a == b => SymbolVerdict::SignatureOnly,
        _ => SymbolVerdict::Changed,
    }
}

/// A contiguous 1-based inclusive line range in the new file.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start_line: u32,
    pub end_line: u32,
}

impl LineRange {
    pub fn line_count(self) -> u32 {
        self.end_line.saturating_sub(self.start_line) + 1
    }
}

/// Sort and coalesce overlapping or adjacent ranges, so the UI receives the
/// smallest set of regions it has to keep expanded.
pub fn merge_ranges(mut ranges: Vec<LineRange>) -> Vec<LineRange> {
    ranges.sort_by_key(|range| (range.start_line, range.end_line));
    let mut merged: Vec<LineRange> = Vec::with_capacity(ranges.len());
    for range in ranges {
        match merged.last_mut() {
            // `+ 1` so two ranges that merely touch become one region.
            Some(last) if range.start_line <= last.end_line.saturating_add(1) => {
                last.end_line = last.end_line.max(range.end_line);
            }
            _ => merged.push(range),
        }
    }
    merged
}

/// The per-file result the diff view uses to collapse noise.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StructuralSummary {
    /// Declarations in the new file.
    pub total_symbols: usize,
    pub unchanged: usize,
    pub moved: usize,
    pub comments_only: usize,
    pub renamed: usize,
    pub signature_only: usize,
    pub changed: usize,
    pub added: usize,
    pub removed: usize,
    /// Declarations a reviewer must read: changed + signatureOnly + added + removed.
    pub semantic_symbols: usize,
    /// New-file line ranges those declarations occupy, sorted and coalesced.
    /// Empty when nothing semantic changed, or when the only semantic change
    /// was a removal (which has no new-file location).
    pub semantic_ranges: Vec<LineRange>,
    pub semantic_lines: u32,
}

impl StructuralSummary {
    /// Declarations in the old file, reconstructed from the new-side count.
    fn old_symbol_count(&self) -> usize {
        (self.total_symbols + self.removed).saturating_sub(self.added)
    }

    /// Share of declarations that genuinely changed, measured against the
    /// larger of the two sides so that deleting most of a file is never
    /// reported as a small change.
    pub fn semantic_ratio(&self) -> f64 {
        let total = self.total_symbols.max(self.old_symbol_count());
        if total == 0 {
            return if self.semantic_symbols == 0 { 0.0 } else { 1.0 };
        }
        // A file that both adds and removes a lot can exceed 1.0 otherwise.
        (self.semantic_symbols as f64 / total as f64).min(1.0)
    }

    pub fn tally(&mut self, verdict: SymbolVerdict) {
        match verdict {
            SymbolVerdict::Unchanged => self.unchanged += 1,
            SymbolVerdict::Moved => self.moved += 1,
            SymbolVerdict::CommentsOnly => self.comments_only += 1,
            SymbolVerdict::RenameOnly => self.renamed += 1,
            SymbolVerdict::SignatureOnly => self.signature_only += 1,
            SymbolVerdict::Changed => self.changed += 1,
            SymbolVerdict::Added => self.added += 1,
            SymbolVerdict::Removed => self.removed += 1,
        }
        if verdict.is_semantic() {
            self.semantic_symbols += 1;
        }
    }

    /// Untranslated evidence line for `Finding::detail`.
    pub fn describe(&self, verdict: FileVerdict) -> String {
        format!(
            "verdict={} · changed={} signature={} renamed={} moved={} unchanged={} added={} removed={}",
            verdict.describe().replace(' ', "-"),
            self.changed,
            self.signature_only,
            self.renamed,
            self.moved,
            self.unchanged,
            self.added,
            self.removed,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(start_line: u32, end_line: u32) -> LineRange {
        LineRange {
            start_line,
            end_line,
        }
    }

    #[test]
    fn merge_ranges_coalesces_overlapping_and_touching_regions() {
        let merged = merge_ranges(vec![
            range(10, 12),
            range(1, 3),
            range(4, 6),
            range(11, 20),
            range(40, 41),
        ]);
        assert_eq!(merged, vec![range(1, 6), range(10, 20), range(40, 41)]);
    }

    #[test]
    fn merge_ranges_on_an_empty_input_stays_empty() {
        assert!(merge_ranges(Vec::new()).is_empty());
    }

    #[test]
    fn line_range_length_counts_both_ends() {
        assert_eq!(range(7, 7).line_count(), 1);
        assert_eq!(range(7, 9).line_count(), 3);
    }

    #[test]
    fn only_real_changes_count_as_semantic() {
        assert!(!SymbolVerdict::Unchanged.is_semantic());
        assert!(!SymbolVerdict::Moved.is_semantic());
        assert!(!SymbolVerdict::CommentsOnly.is_semantic());
        assert!(!SymbolVerdict::RenameOnly.is_semantic());
        assert!(SymbolVerdict::SignatureOnly.is_semantic());
        assert!(SymbolVerdict::Changed.is_semantic());
        assert!(SymbolVerdict::Added.is_semantic());
        assert!(SymbolVerdict::Removed.is_semantic());
    }

    #[test]
    fn every_verdict_but_semantic_is_noise() {
        for verdict in [
            FileVerdict::Identical,
            FileVerdict::FormattingOnly,
            FileVerdict::CommentsOnly,
            FileVerdict::RenameOnly,
            FileVerdict::Moved,
        ] {
            assert!(verdict.is_noise(), "{verdict:?}");
        }
        assert!(!FileVerdict::Semantic.is_noise());
    }

    #[test]
    fn tally_counts_each_verdict_once() {
        let mut summary = StructuralSummary::default();
        summary.tally(SymbolVerdict::Unchanged);
        summary.tally(SymbolVerdict::Moved);
        summary.tally(SymbolVerdict::Changed);
        summary.tally(SymbolVerdict::Added);
        assert_eq!(summary.unchanged, 1);
        assert_eq!(summary.moved, 1);
        assert_eq!(summary.changed, 1);
        assert_eq!(summary.added, 1);
        assert_eq!(summary.semantic_symbols, 2);
    }
}
