// SPDX-License-Identifier: GPL-3.0-or-later
//! V7 — reinvented function (design §7).
//!
//! For every function the diff *adds*, look for an existing function elsewhere
//! in the repository that does the same thing under different names. Duplication
//! between two pre-existing functions is not this commit's fault, so only added
//! symbols are candidates.
//!
//! Scope: **Type-2 and Type-3 clones only** — identifier/literal renaming plus
//! small insertions and deletions, measured on the identifier-normalized token
//! stream. Type-4 (same behaviour, different algorithm) needs embeddings, which
//! needs a model call, which the contract's second invariant forbids outright.
//! Type-4 is permanently out of scope, not "later".
//!
//! Search cost: the fingerprints form an inverted index (gram → symbols), so a
//! candidate lookup touches only the symbols that share a gram. The naive
//! alternative is 50 000² pairwise comparisons, which is the real performance
//! cliff spec §7-④ warns about.
//!
//! Every threshold below is a clone-literature convention, **not** a value tuned
//! on this repository. That is why the rule ships off by default: the first
//! release exists to find out what the threshold should be.

use std::collections::HashMap;

use crate::verify::rules::RuleOutcome;
use crate::verify::types::{Finding, FindingKind, UncheckedReason};

use super::changes::ChangeSet;
use super::index::RepoIndex;
use super::model::{is_test_path, LanguageFamily, SymbolRecord};
use super::tokens::{containment, jaccard};
use super::MIN_CLONE_TOKENS;

/// Two functions are near-duplicates at this Jaccard similarity …
const JACCARD_THRESHOLD: f32 = 0.70;
/// … or when this much of the new function is contained in the existing one.
const CONTAINMENT_THRESHOLD: f32 = 0.85;
/// Length ratio outside this band cannot be a clone, whatever the grams say.
const MIN_LENGTH_RATIO: f32 = 0.5;
const MAX_LENGTH_RATIO: f32 = 2.0;
/// Candidates kept after the inverted-index probe, ranked by shared grams.
const MAX_CANDIDATES: usize = 20;
/// A gram present in more than this share of all symbols is language
/// boilerplate and only inflates the candidate set.
const COMMON_GRAM_RATIO: f32 = 0.01;
/// Below this many symbols the ratio above is meaningless, so no gram is common.
const COMMON_GRAM_MIN_SYMBOLS: usize = 100;

const MAX_FINDINGS_PER_FILE: usize = 3;
const MAX_FINDINGS: usize = 20;

pub fn run(changes: &ChangeSet, index: &RepoIndex) -> RuleOutcome {
    let mut outcome = RuleOutcome::new();
    let kind = FindingKind::ReinventedFunction;

    let candidates: Vec<&super::changes::ChangedSymbol> = changes
        .added
        .iter()
        .filter(|added| is_clone_candidate(&added.record))
        .collect();

    if candidates.is_empty() {
        outcome.limit(
            kind,
            UncheckedReason::NotApplicable,
            Some(format!(
                "no added function of at least {MIN_CLONE_TOKENS} tokens in this change"
            )),
        );
        return outcome;
    }
    outcome.check(kind);

    let corpus = Corpus::build(index);
    let mut per_file: HashMap<&str, usize> = HashMap::new();
    let mut suppressed = 0_usize;

    for added in candidates {
        let Some(best) = corpus.best_match(&added.path, &added.record) else {
            continue;
        };
        if outcome.findings.len() >= MAX_FINDINGS {
            suppressed += 1;
            continue;
        }
        let count = per_file.entry(added.path.as_str()).or_insert(0);
        if *count >= MAX_FINDINGS_PER_FILE {
            suppressed += 1;
            continue;
        }
        *count += 1;

        let finding = Finding::new(
            kind,
            added.path.clone(),
            format!(
                "`{}` is {:.2} similar to `{}`",
                added.record.name, best.jaccard, best.name
            ),
        )
        .at_line(added.record.span.start_line)
        .with_detail(format!(
            "{}:{} · {} vs {} tokens · jaccard {:.2} · containment {:.2} · token similarity only (type-2/3)",
            best.path,
            best.line,
            added.record.token_count,
            best.token_count,
            best.jaccard,
            best.containment
        ));
        outcome.push(finding);
    }

    if suppressed > 0 {
        outcome.limit(
            kind,
            UncheckedReason::BudgetExceeded,
            Some(format!("+{suppressed} more similar symbol(s) not reported")),
        );
    }
    outcome
}

fn is_clone_candidate(symbol: &SymbolRecord) -> bool {
    symbol.kind.is_callable()
        && symbol.token_count >= MIN_CLONE_TOKENS
        && !symbol.fingerprint.is_empty()
}

struct Entry<'a> {
    path: &'a str,
    symbol: &'a SymbolRecord,
    family: LanguageFamily,
    is_test: bool,
}

struct Match<'a> {
    path: &'a str,
    name: &'a str,
    line: u32,
    token_count: u32,
    jaccard: f32,
    containment: f32,
}

struct Corpus<'a> {
    entries: Vec<Entry<'a>>,
    /// gram → entry positions. Common grams are dropped before this is built.
    postings: HashMap<u32, Vec<u32>>,
}

impl<'a> Corpus<'a> {
    fn build(index: &'a RepoIndex) -> Self {
        let mut entries: Vec<Entry<'a>> = Vec::new();
        for file in index.files() {
            // A file with an ERROR node has a garbage token stream; using it as
            // a clone candidate would produce confident nonsense.
            if !file.parse_ok {
                continue;
            }
            let family = file.language.family();
            let is_test = is_test_path(&file.path);
            for symbol in file.symbols.iter().filter(|s| is_clone_candidate(s)) {
                entries.push(Entry {
                    path: file.path.as_str(),
                    symbol,
                    family,
                    is_test,
                });
            }
        }

        let mut postings: HashMap<u32, Vec<u32>> = HashMap::new();
        for (position, entry) in entries.iter().enumerate() {
            for gram in &entry.symbol.fingerprint {
                postings.entry(*gram).or_default().push(position as u32);
            }
        }
        if entries.len() >= COMMON_GRAM_MIN_SYMBOLS {
            let ceiling = (entries.len() as f32 * COMMON_GRAM_RATIO).ceil() as usize;
            postings.retain(|_, holders| holders.len() <= ceiling);
        }

        Self { entries, postings }
    }

    fn best_match(&self, path: &str, needle: &SymbolRecord) -> Option<Match<'a>> {
        let needle_is_test = is_test_path(path);
        let mut shared: HashMap<u32, u32> = HashMap::new();
        for gram in &needle.fingerprint {
            for position in self.postings.get(gram).into_iter().flatten() {
                *shared.entry(*position).or_insert(0) += 1;
            }
        }

        let mut ranked: Vec<(u32, u32)> = shared.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        ranked.truncate(MAX_CANDIDATES);

        let needle_family = family_of_path(path)?;
        let mut best: Option<Match<'a>> = None;
        for (position, _) in ranked {
            let entry = &self.entries[position as usize];
            if entry.path == path
                || entry.symbol.kind != needle.kind
                || entry.family != needle_family
                // Tests are supposed to look like each other; only compare a
                // test against a test and production code against production.
                || entry.is_test != needle_is_test
            {
                continue;
            }
            let ratio = needle.token_count as f32 / entry.symbol.token_count.max(1) as f32;
            if !(MIN_LENGTH_RATIO..=MAX_LENGTH_RATIO).contains(&ratio) {
                continue;
            }

            let similarity = jaccard(&needle.fingerprint, &entry.symbol.fingerprint);
            let inclusion = containment(&needle.fingerprint, &entry.symbol.fingerprint);
            if similarity < JACCARD_THRESHOLD && inclusion < CONTAINMENT_THRESHOLD {
                continue;
            }
            if best
                .as_ref()
                .is_some_and(|current| current.jaccard >= similarity)
            {
                continue;
            }
            best = Some(Match {
                path: entry.path,
                name: entry.symbol.name.as_str(),
                line: entry.symbol.span.start_line,
                token_count: entry.symbol.token_count,
                jaccard: similarity,
                containment: inclusion,
            });
        }
        best
    }
}

fn family_of_path(path: &str) -> Option<LanguageFamily> {
    super::lang::language_of_path(path).map(|language| language.family())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::changes::{changed_symbols, FileRevision};
    use crate::verify::context::index::fixture::index_from_sources;

    /// Long enough to clear `MIN_CLONE_TOKENS`.
    const ORIGINAL: &str = "export function totalOfRows(rows) {\n  let total = 0;\n  for (const row of rows) {\n    if (!row) { continue; }\n    total += row.value * row.count;\n  }\n  return total;\n}\n";
    const RENAMED: &str = "export function sumEntries(entries) {\n  let acc = 0;\n  for (const entry of entries) {\n    if (!entry) { continue; }\n    acc += entry.amount * entry.quantity;\n  }\n  return acc;\n}\n";
    const UNRELATED: &str = "export function connectSocket(url, retries) {\n  const socket = open(url);\n  while (retries > 0) {\n    socket.ping();\n    retries -= 1;\n  }\n  socket.close();\n  return socket;\n}\n";

    fn added(path: &str, source: &str) -> ChangeSet {
        changed_symbols(&[FileRevision::added(path, source)])
    }

    #[test]
    fn a_renamed_near_duplicate_is_reported_with_its_location() {
        let index = index_from_sources(&[("src/lib/totals.ts", ORIGINAL)]);
        let outcome = run(&added("src/feature/sum.ts", RENAMED), &index);

        assert_eq!(outcome.findings.len(), 1, "one finding per added symbol");
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, "v7.reinventedFunction");
        assert_eq!(finding.file, "src/feature/sum.ts");
        assert!(finding.message.contains("sumEntries"));
        assert!(finding.message.contains("totalOfRows"));
        let detail = finding.detail.clone().expect("detail");
        assert!(detail.contains("src/lib/totals.ts:1"), "detail was {detail}");
        assert!(outcome
            .checked
            .contains(&"v7.reinventedFunction".to_string()));
    }

    #[test]
    fn two_genuinely_different_functions_are_not_flagged() {
        let index = index_from_sources(&[("src/lib/totals.ts", ORIGINAL)]);
        let outcome = run(&added("src/net/socket.ts", UNRELATED), &index);
        assert!(
            outcome.findings.is_empty(),
            "unrelated code was flagged: {:?}",
            outcome.findings
        );
    }

    #[test]
    fn short_symbols_are_never_candidates() {
        let index = index_from_sources(&[("src/a.ts", "export function id(x) { return x; }")]);
        let outcome = run(&added("src/b.ts", "export function same(y) { return y; }"), &index);
        assert!(outcome.findings.is_empty());
        assert!(outcome
            .limits
            .iter()
            .any(|limit| limit.reason == UncheckedReason::NotApplicable));
        assert!(outcome.checked.is_empty(), "nothing was actually checked");
    }

    #[test]
    fn a_duplicate_inside_the_same_file_is_not_reported() {
        let index = index_from_sources(&[("src/lib/totals.ts", ORIGINAL)]);
        let outcome = run(&added("src/lib/totals.ts", RENAMED), &index);
        assert!(outcome.findings.is_empty(), "same-file pairs are excluded");
    }

    #[test]
    fn tests_are_never_compared_against_production_code() {
        let index = index_from_sources(&[("src/lib/totals.ts", ORIGINAL)]);
        let outcome = run(&added("src/lib/totals.test.ts", RENAMED), &index);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn a_rust_clone_is_never_matched_against_a_typescript_one() {
        let index = index_from_sources(&[("src/lib/totals.ts", ORIGINAL)]);
        let rust = "pub fn total_of_rows(rows: &[Row]) -> u32 {\n    let mut total = 0;\n    for row in rows {\n        if row.skip { continue; }\n        total += row.value * row.count;\n    }\n    total\n}\n";
        let outcome = run(&added("src/lib/totals.rs", rust), &index);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn only_the_single_best_match_is_reported_per_symbol() {
        let index = index_from_sources(&[
            ("src/lib/totals.ts", ORIGINAL),
            ("src/lib/copy.ts", ORIGINAL),
            ("src/lib/copy2.ts", ORIGINAL),
        ]);
        let outcome = run(&added("src/feature/sum.ts", RENAMED), &index);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn a_clone_of_a_rust_function_is_found() {
        let rust_original = "pub fn total_of_rows(rows: &[Row]) -> u32 {\n    let mut total = 0;\n    for row in rows {\n        if row.skip { continue; }\n        total += row.value * row.count;\n    }\n    total\n}\n";
        let rust_clone = "pub fn sum_entries(entries: &[Entry]) -> u32 {\n    let mut acc = 0;\n    for entry in entries {\n        if entry.hidden { continue; }\n        acc += entry.amount * entry.quantity;\n    }\n    acc\n}\n";
        let index = index_from_sources(&[("src/totals.rs", rust_original)]);
        let outcome = run(&added("src/sum.rs", rust_clone), &index);
        assert_eq!(outcome.findings.len(), 1, "{:?}", outcome.findings);
    }

    #[test]
    fn a_file_never_produces_more_than_three_findings() {
        let mut sources: Vec<(String, String)> = Vec::new();
        let mut new_file = String::new();
        for i in 0..6 {
            sources.push((
                format!("src/lib/o{i}.ts"),
                ORIGINAL.replace("totalOfRows", &format!("totalOfRows{i}")),
            ));
            new_file.push_str(&RENAMED.replace("sumEntries", &format!("sumEntries{i}")));
        }
        let borrowed: Vec<(&str, &str)> = sources
            .iter()
            .map(|(path, source)| (path.as_str(), source.as_str()))
            .collect();
        let index = index_from_sources(&borrowed);

        let outcome = run(&added("src/feature/all.ts", &new_file), &index);
        assert_eq!(outcome.findings.len(), MAX_FINDINGS_PER_FILE);
        assert!(outcome
            .limits
            .iter()
            .any(|limit| limit.reason == UncheckedReason::BudgetExceeded));
    }
}
