// SPDX-License-Identifier: GPL-3.0-or-later
//! V1 — structural (AST) diff, and V17 — commit-type invariant assertions.
//!
//! An agent that rewrites a whole file makes the text diff show 100 % changed
//! and makes review physically impossible. This module compares the two
//! versions as token streams and declaration tables instead, so that
//! reformatting, comment edits, identifier renames and code motion are named as
//! noise and the reviewer is left with what actually changed.
//!
//! **Degradation is absolute.** If either side fails to parse, if the language
//! is out of scope, or if a side is too large, the comparison returns
//! [`StructuralOutcome::Degraded`] with a reason and **never a `Finding`**. A
//! wrong "these 2,800 lines are noise" is the worst thing this feature could
//! say, so accuracy is bought with coverage: one ERROR node anywhere and the
//! whole file falls back to the text diff.
//!
//! Everything here is synchronous and CPU-bound. The command layer must call it
//! inside `tokio::task::spawn_blocking`.

pub mod extract;
pub mod invariant;
pub mod lang;
pub mod pair;
pub mod tokens;
pub mod verdict;

use serde::{Deserialize, Serialize};

use crate::verify::rules::context::RuleOutcome;
use crate::verify::types::{Finding, FindingKind, UncheckedReason};

use lang::SyntaxLanguage;
use pair::{ApiChange, SymbolChange};
use verdict::{FileVerdict, LineRange, StructuralSummary};

/// Per-side ceiling. Hand-written source does not reach 2 MiB; anything that
/// does is generated, bundled or minified, and parsing it buys nothing.
pub const MAX_STRUCTURAL_BYTES: usize = 2 * 1024 * 1024;

/// Above this share of changed declarations there is nothing reassuring to
/// say, so V1 stays quiet rather than restating the diff. Below it, naming what
/// a reviewer can skip is worth a line — including the 1-of-2 case, where half
/// the file still drops out of review.
const NOISE_RATIO: f64 = 0.7;

pub const KINDS: &[FindingKind] = &[FindingKind::StructuralDiff];

/// Why a file was not compared. Never a risk signal — an unparsed file is an
/// *unchecked* file (contract §7-⑥).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DegradeReason {
    /// Outside the TS/TSX/JS/JSX/Rust scope.
    UnsupportedLanguage,
    /// An ERROR or MISSING node on either side.
    ParseError,
    /// Over [`MAX_STRUCTURAL_BYTES`].
    TooLarge,
    /// Binary, non-UTF-8, or a side that does not exist (added / deleted file).
    NotComparable,
}

impl DegradeReason {
    /// The report vocabulary this maps onto (design §5.3).
    pub fn unchecked_reason(self) -> UncheckedReason {
        match self {
            DegradeReason::UnsupportedLanguage => UncheckedReason::UnsupportedLanguage,
            DegradeReason::ParseError => UncheckedReason::ParseFailed,
            DegradeReason::TooLarge => UncheckedReason::BudgetExceeded,
            DegradeReason::NotComparable => UncheckedReason::NotApplicable,
        }
    }
}

/// The result of comparing one file. `Degraded` means the frontend keeps the
/// text diff and does not offer a structural toggle — there is no half view.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StructuralOutcome {
    #[serde(rename_all = "camelCase")]
    Compared { diff: Box<StructuralFileDiff> },
    #[serde(rename_all = "camelCase")]
    Degraded {
        reason: DegradeReason,
        /// Untranslated, concrete cause, e.g. `"new side has 3 parse error(s)"`.
        detail: String,
    },
}

impl StructuralOutcome {
    fn degraded(reason: DegradeReason, detail: impl Into<String>) -> Self {
        StructuralOutcome::Degraded {
            reason,
            detail: detail.into(),
        }
    }

    pub fn diff(&self) -> Option<&StructuralFileDiff> {
        match self {
            StructuralOutcome::Compared { diff } => Some(diff),
            StructuralOutcome::Degraded { .. } => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StructuralFileDiff {
    pub path: String,
    pub language: SyntaxLanguage,
    pub verdict: FileVerdict,
    pub summary: StructuralSummary,
    /// Every declaration's fate, in new-file reading order.
    pub symbols: Vec<SymbolChange>,
    /// Public-surface delta — the input to V17's `refactor:` / `perf:` check.
    pub api: Vec<ApiChange>,
}

/// One file's comparison, as the command layer collects them for a scan.
#[derive(Clone, Debug)]
pub struct FileComparison {
    pub path: String,
    pub outcome: StructuralOutcome,
}

/// Compare the two versions of a file that exists on both sides.
///
/// CPU-bound and synchronous — call inside `tokio::task::spawn_blocking`.
pub fn compare(path: &str, old_source: &[u8], new_source: &[u8]) -> StructuralOutcome {
    let Some(language) = lang::language_of_path(path) else {
        return StructuralOutcome::degraded(
            DegradeReason::UnsupportedLanguage,
            format!("{path} is outside the TS/JS/Rust scope"),
        );
    };
    if old_source.len() > MAX_STRUCTURAL_BYTES || new_source.len() > MAX_STRUCTURAL_BYTES {
        return StructuralOutcome::degraded(
            DegradeReason::TooLarge,
            format!(
                "{} / {} bytes, over the {} byte limit",
                old_source.len(),
                new_source.len(),
                MAX_STRUCTURAL_BYTES
            ),
        );
    }
    let (Ok(old_text), Ok(new_text)) = (
        std::str::from_utf8(old_source),
        std::str::from_utf8(new_source),
    ) else {
        return StructuralOutcome::degraded(
            DegradeReason::NotComparable,
            "not valid UTF-8".to_string(),
        );
    };

    let Some(mut parser) = lang::parser_for(language) else {
        return StructuralOutcome::degraded(
            DegradeReason::ParseError,
            format!("no usable grammar for {language:?}"),
        );
    };
    let (Some(old_tree), Some(new_tree)) =
        (parser.parse(old_text, None), parser.parse(new_text, None))
    else {
        return StructuralOutcome::degraded(
            DegradeReason::ParseError,
            "the parser returned no tree".to_string(),
        );
    };

    let old_streams = tokens::collect(old_tree.root_node(), old_source);
    let new_streams = tokens::collect(new_tree.root_node(), new_source);
    // Strict: one ERROR or MISSING node anywhere and the token streams are
    // untrustworthy, so we say nothing rather than something wrong.
    if !old_streams.parse_ok || !new_streams.parse_ok {
        let side = match (old_streams.parse_ok, new_streams.parse_ok) {
            (false, false) => "both sides",
            (false, true) => "the old side",
            _ => "the new side",
        };
        return StructuralOutcome::degraded(
            DegradeReason::ParseError,
            format!("{side} contain(s) a syntax error"),
        );
    }

    let mut file_verdict =
        verdict::file_verdict(&old_streams, &new_streams, old_source == new_source);

    let old_symbols = extract::extract(language, &old_tree, old_source);
    let new_symbols = extract::extract(language, &new_tree, new_source);
    let matching = pair::match_symbols(&old_symbols, &new_symbols);

    // A file whose declarations were only reordered is motion, not semantics.
    // The multiset check catches an edit hiding in top-level code between the
    // declarations, which the symbol table alone would not see.
    if file_verdict == FileVerdict::Semantic
        && matching.is_pure_motion()
        && is_token_permutation(&old_streams.raw, &new_streams.raw)
    {
        file_verdict = FileVerdict::Moved;
    }

    let summary = summarize(&matching.changes, new_symbols.len());

    StructuralOutcome::Compared {
        diff: Box::new(StructuralFileDiff {
            path: path.to_string(),
            language,
            verdict: file_verdict,
            summary,
            symbols: matching.changes,
            api: matching.api,
        }),
    }
}

/// Compare two optional sides. A missing side (added or deleted file) is not
/// comparable: there is no "before" to call the change noise against.
pub fn compare_versions(
    path: &str,
    old_source: Option<&[u8]>,
    new_source: Option<&[u8]>,
) -> StructuralOutcome {
    match (old_source, new_source) {
        (Some(old), Some(new)) => compare(path, old, new),
        (None, Some(_)) => StructuralOutcome::degraded(
            DegradeReason::NotComparable,
            "the file is new; there is no previous version to compare".to_string(),
        ),
        (Some(_), None) => StructuralOutcome::degraded(
            DegradeReason::NotComparable,
            "the file was deleted; there is no new version to compare".to_string(),
        ),
        (None, None) => StructuralOutcome::degraded(
            DegradeReason::NotComparable,
            "neither version is available".to_string(),
        ),
    }
}

/// Whether two token streams contain the same tokens in a different order.
fn is_token_permutation(old: &[u32], new: &[u32]) -> bool {
    if old.len() != new.len() {
        return false;
    }
    let mut a = old.to_vec();
    let mut b = new.to_vec();
    a.sort_unstable();
    b.sort_unstable();
    a == b
}

fn summarize(changes: &[SymbolChange], new_symbol_count: usize) -> StructuralSummary {
    let mut summary = StructuralSummary {
        total_symbols: new_symbol_count,
        ..StructuralSummary::default()
    };
    let mut ranges: Vec<LineRange> = Vec::new();
    for change in changes {
        summary.tally(change.verdict);
        if change.verdict.is_semantic() {
            if let Some(span) = change.span {
                ranges.push(LineRange {
                    start_line: span.start_line,
                    end_line: span.end_line,
                });
            }
        }
    }
    summary.semantic_ranges = verdict::merge_ranges(ranges);
    summary.semantic_lines = summary
        .semantic_ranges
        .iter()
        .map(|range| range.line_count())
        .sum();
    summary
}

// ── V1 findings ──────────────────────────────────────────────────────────────

/// V1 is the one rule whose finding is *good news*: it exists to shrink the
/// review surface by proving which parts do not need reading. It never rises
/// above the registry's `Info`.
pub fn collect(files: &[FileComparison]) -> RuleOutcome {
    let mut outcome = RuleOutcome::new();
    if files.is_empty() {
        outcome.limit(
            FindingKind::StructuralDiff,
            UncheckedReason::NotApplicable,
            Some("no file in this diff could be compared structurally".to_string()),
        );
        return outcome;
    }

    let mut compared = 0usize;
    for file in files {
        match &file.outcome {
            StructuralOutcome::Compared { diff } => {
                compared += 1;
                if let Some(finding) = reassurance(diff) {
                    outcome.push(finding);
                }
            }
            StructuralOutcome::Degraded { reason, detail } => {
                outcome.limit(
                    FindingKind::StructuralDiff,
                    reason.unchecked_reason(),
                    Some(format!("{}: {}", file.path, detail)),
                );
            }
        }
    }
    if compared > 0 {
        outcome.check(FindingKind::StructuralDiff);
    }
    outcome
}

/// The message is only worth emitting when it lets a reviewer skip something.
fn reassurance(diff: &StructuralFileDiff) -> Option<Finding> {
    let summary = &diff.summary;
    let message = if diff.verdict.is_noise() {
        format!(
            "{} — none of {} declaration(s) changed",
            diff.verdict.describe(),
            summary.total_symbols
        )
    } else if summary.semantic_ratio() < NOISE_RATIO {
        format!(
            "{} of {} declaration(s) changed; {} moved, {} unchanged",
            summary.semantic_symbols, summary.total_symbols, summary.moved, summary.unchanged
        )
    } else {
        // Most of the file really did change. Nothing reassuring to say, and
        // repeating the diff would be noise — but the rule still ran.
        return None;
    };

    let finding = Finding::new(FindingKind::StructuralDiff, &diff.path, message)
        .with_detail(summary.describe(diff.verdict));
    Some(match summary.semantic_ranges.first() {
        Some(range) => finding.at_line(range.start_line),
        None => finding,
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    pub fn comparison(path: &str, before: &str, after: &str) -> FileComparison {
        FileComparison {
            path: path.to_string(),
            outcome: compare(path, before.as_bytes(), after.as_bytes()),
        }
    }

    pub fn verdict_of(path: &str, before: &str, after: &str) -> FileVerdict {
        match compare(path, before.as_bytes(), after.as_bytes()) {
            StructuralOutcome::Compared { diff } => diff.verdict,
            StructuralOutcome::Degraded { reason, detail } => {
                panic!("expected a comparison, got {reason:?}: {detail}")
            }
        }
    }
}

#[cfg(test)]
mod tests;
