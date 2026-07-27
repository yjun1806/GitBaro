// SPDX-License-Identifier: GPL-3.0-or-later
//! Matching the declarations of two file versions — three passes, no tree edit
//! distance.
//!
//! 1. **Exact key** — `(container, kind, name)`. Catches everything a normal
//!    edit does.
//! 2. **Normalized-stream equality** — same kind, identical identifier-folded
//!    token stream. This is a pure rename, and it is exact, not a heuristic.
//! 3. **Fingerprint similarity ≥ `RENAME_SIMILARITY`** — same kind, greedy
//!    best-first. The fallback for a declaration that was renamed *and* edited.
//!
//! Whatever survives all three is `Added` or `Removed`. A general tree diff
//! would classify more, but the promise V1 makes — "of these 31 declarations,
//! 2 changed" — needs nothing beyond declaration identity, and a matcher a
//! reviewer cannot re-derive by hand is a matcher they will not trust.

use std::collections::HashMap;
use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use super::extract::StructuralSymbol;
use super::lang::{Span, SymbolKind};
use super::tokens::jaccard;
use super::verdict::{symbol_verdict, SymbolVerdict};

/// Fingerprint overlap at which two differently-named declarations are called
/// the same declaration renamed. Deliberately high: a wrong pairing reports a
/// real addition as a small edit, which is the failure mode that loses trust.
pub const RENAME_SIMILARITY: f32 = 0.8;

/// One declaration's fate, in the shape the diff view consumes.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SymbolChange {
    pub verdict: SymbolVerdict,
    /// New name, or the old name when the declaration was removed.
    pub name: String,
    /// Set only when the declaration was matched under a different name.
    pub old_name: Option<String>,
    pub kind: SymbolKind,
    pub container: Option<String>,
    pub exported: bool,
    /// New-file location. `None` for `Removed`.
    pub span: Option<Span>,
    /// Old-file location. `None` for `Added`.
    pub old_span: Option<Span>,
}

/// A change to the *public* surface — what a `refactor:` or `perf:` commit
/// promises not to touch (V17).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiChange {
    pub name: String,
    pub kind: SymbolKind,
    pub change: ApiChangeKind,
    /// Untranslated evidence, e.g. `"arity 2 → 3"`.
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApiChangeKind {
    Added,
    Removed,
    Renamed,
    ArityChanged,
    VisibilityChanged,
}

#[derive(Clone, Debug, Default)]
pub struct Matching {
    pub changes: Vec<SymbolChange>,
    pub api: Vec<ApiChange>,
}

impl Matching {
    /// True when every matched declaration kept its tokens and at least one
    /// changed position — the file-level `Moved` precondition.
    pub fn is_pure_motion(&self) -> bool {
        let mut moved = 0usize;
        for change in &self.changes {
            match change.verdict {
                SymbolVerdict::Unchanged => {}
                SymbolVerdict::Moved => moved += 1,
                _ => return false,
            }
        }
        moved > 0
    }
}

pub fn match_symbols(old: &[StructuralSymbol], new: &[StructuralSymbol]) -> Matching {
    let mut old_taken = vec![false; old.len()];
    let mut new_taken = vec![false; new.len()];
    let mut pairs: Vec<(usize, usize)> = Vec::new();

    match_by_key(old, new, &mut old_taken, &mut new_taken, &mut pairs);
    match_by_normalized_stream(old, new, &mut old_taken, &mut new_taken, &mut pairs);
    match_by_similarity(old, new, &mut old_taken, &mut new_taken, &mut pairs);

    build(old, new, &old_taken, &new_taken, &pairs)
}

fn match_by_key(
    old: &[StructuralSymbol],
    new: &[StructuralSymbol],
    old_taken: &mut [bool],
    new_taken: &mut [bool],
    pairs: &mut Vec<(usize, usize)>,
) {
    let mut buckets: HashMap<_, VecDeque<usize>> = HashMap::new();
    for (index, symbol) in old.iter().enumerate() {
        buckets.entry(symbol.key()).or_default().push_back(index);
    }
    for (new_index, symbol) in new.iter().enumerate() {
        // Overloads share a key; taking them in source order keeps the pairing
        // deterministic.
        if let Some(old_index) = buckets.get_mut(&symbol.key()).and_then(VecDeque::pop_front) {
            old_taken[old_index] = true;
            new_taken[new_index] = true;
            pairs.push((old_index, new_index));
        }
    }
}

fn match_by_normalized_stream(
    old: &[StructuralSymbol],
    new: &[StructuralSymbol],
    old_taken: &mut [bool],
    new_taken: &mut [bool],
    pairs: &mut Vec<(usize, usize)>,
) {
    for (new_index, candidate) in new.iter().enumerate() {
        if new_taken[new_index] {
            continue;
        }
        let found = old.iter().enumerate().find_map(|(old_index, symbol)| {
            let matches = !old_taken[old_index]
                && symbol.kind == candidate.kind
                && symbol.norm_hash == candidate.norm_hash;
            matches.then_some(old_index)
        });
        if let Some(old_index) = found {
            old_taken[old_index] = true;
            new_taken[new_index] = true;
            pairs.push((old_index, new_index));
        }
    }
}

fn match_by_similarity(
    old: &[StructuralSymbol],
    new: &[StructuralSymbol],
    old_taken: &mut [bool],
    new_taken: &mut [bool],
    pairs: &mut Vec<(usize, usize)>,
) {
    let mut scored: Vec<(f32, usize, usize)> = Vec::new();
    for (old_index, left) in old.iter().enumerate() {
        if old_taken[old_index] {
            continue;
        }
        for (new_index, right) in new.iter().enumerate() {
            if new_taken[new_index] || left.kind != right.kind {
                continue;
            }
            let score = jaccard(&left.fingerprint, &right.fingerprint);
            if score >= RENAME_SIMILARITY {
                scored.push((score, old_index, new_index));
            }
        }
    }
    // Best first; index order breaks ties so the result never depends on hash
    // iteration order.
    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.1.cmp(&b.1))
            .then(a.2.cmp(&b.2))
    });
    for (_, old_index, new_index) in scored {
        if old_taken[old_index] || new_taken[new_index] {
            continue;
        }
        old_taken[old_index] = true;
        new_taken[new_index] = true;
        pairs.push((old_index, new_index));
    }
}

fn build(
    old: &[StructuralSymbol],
    new: &[StructuralSymbol],
    old_taken: &[bool],
    new_taken: &[bool],
    pairs: &[(usize, usize)],
) -> Matching {
    let mut matching = Matching::default();

    for &(old_index, new_index) in pairs {
        let (before, after) = (&old[old_index], &new[new_index]);
        let verdict = symbol_verdict(before, after);
        let renamed = before.name != after.name;
        matching.changes.push(SymbolChange {
            verdict,
            name: after.name.clone(),
            old_name: renamed.then(|| before.name.clone()),
            kind: after.kind,
            container: after.container.clone(),
            exported: after.exported,
            span: Some(after.span),
            old_span: Some(before.span),
        });
        collect_api_delta(before, after, renamed, &mut matching.api);
    }

    for (new_index, symbol) in new.iter().enumerate() {
        if new_taken[new_index] {
            continue;
        }
        matching.changes.push(SymbolChange {
            verdict: SymbolVerdict::Added,
            name: symbol.name.clone(),
            old_name: None,
            kind: symbol.kind,
            container: symbol.container.clone(),
            exported: symbol.exported,
            span: Some(symbol.span),
            old_span: None,
        });
        if symbol.exported {
            matching.api.push(ApiChange {
                name: symbol.qualified_name(),
                kind: symbol.kind,
                change: ApiChangeKind::Added,
                detail: "new export".to_string(),
            });
        }
    }

    for (old_index, symbol) in old.iter().enumerate() {
        if old_taken[old_index] {
            continue;
        }
        matching.changes.push(SymbolChange {
            verdict: SymbolVerdict::Removed,
            name: symbol.name.clone(),
            old_name: None,
            kind: symbol.kind,
            container: symbol.container.clone(),
            exported: symbol.exported,
            span: None,
            old_span: Some(symbol.span),
        });
        if symbol.exported {
            matching.api.push(ApiChange {
                name: symbol.qualified_name(),
                kind: symbol.kind,
                change: ApiChangeKind::Removed,
                detail: "export deleted".to_string(),
            });
        }
    }

    // New-file reading order, with removals — which have no new-file location —
    // last.
    matching.changes.sort_by_key(|change| {
        (
            change.span.map(|span| span.start_line).unwrap_or(u32::MAX),
            change.old_span.map(|span| span.start_line).unwrap_or(0),
        )
    });
    matching.api.sort_by(|a, b| a.name.cmp(&b.name));
    matching
}

fn collect_api_delta(
    before: &StructuralSymbol,
    after: &StructuralSymbol,
    renamed: bool,
    api: &mut Vec<ApiChange>,
) {
    if before.exported != after.exported {
        api.push(ApiChange {
            name: after.qualified_name(),
            kind: after.kind,
            change: ApiChangeKind::VisibilityChanged,
            detail: format!(
                "{} → {}",
                if before.exported {
                    "exported"
                } else {
                    "private"
                },
                if after.exported {
                    "exported"
                } else {
                    "private"
                }
            ),
        });
        return;
    }
    // A private symbol is not part of the surface a refactor promises to keep.
    if !after.exported {
        return;
    }
    if renamed {
        api.push(ApiChange {
            name: after.qualified_name(),
            kind: after.kind,
            change: ApiChangeKind::Renamed,
            detail: format!("`{}` → `{}`", before.name, after.name),
        });
    }
    if before.arity != after.arity {
        api.push(ApiChange {
            name: after.qualified_name(),
            kind: after.kind,
            change: ApiChangeKind::ArityChanged,
            detail: format!(
                "arity {} → {}",
                before.arity.map_or("none".to_string(), |a| a.to_string()),
                after.arity.map_or("none".to_string(), |a| a.to_string()),
            ),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::super::extract::extract;
    use super::super::lang::{parser_for, SyntaxLanguage};
    use super::*;

    fn symbols(source: &str) -> Vec<StructuralSymbol> {
        let language = SyntaxLanguage::TypeScript;
        let mut parser = parser_for(language).expect("grammar loads");
        let tree = parser.parse(source, None).expect("parse succeeds");
        assert!(!tree.root_node().has_error(), "fixture must parse cleanly");
        extract(language, &tree, source.as_bytes())
    }

    fn matched(before: &str, after: &str) -> Matching {
        match_symbols(&symbols(before), &symbols(after))
    }

    fn verdict_of(matching: &Matching, name: &str) -> SymbolVerdict {
        matching
            .changes
            .iter()
            .find(|change| change.name == name)
            .unwrap_or_else(|| panic!("{name} is not in the matching"))
            .verdict
    }

    #[test]
    fn the_exact_key_matches_untouched_declarations() {
        let matching = matched(
            "export function a() { return 1; }\nexport function b() { return 2; }",
            "export function a() { return 1; }\nexport function b() { return 3; }",
        );
        assert_eq!(verdict_of(&matching, "a"), SymbolVerdict::Unchanged);
        assert_eq!(verdict_of(&matching, "b"), SymbolVerdict::Changed);
        assert!(matching.api.is_empty(), "no surface change");
    }

    #[test]
    fn an_identical_body_under_a_new_name_is_matched_by_the_normalized_stream() {
        let matching = matched(
            "export function fetchUser(id: string) { const u = load(id); return u; }",
            "export function loadUser(key: string) { const u = load(key); return u; }",
        );
        let change = &matching.changes[0];
        assert_eq!(change.verdict, SymbolVerdict::RenameOnly);
        assert_eq!(change.old_name.as_deref(), Some("fetchUser"));
        assert_eq!(matching.api.len(), 1);
        assert_eq!(matching.api[0].change, ApiChangeKind::Renamed);
    }

    #[test]
    fn a_renamed_and_edited_declaration_falls_back_to_similarity() {
        let matching = matched(
            "export function compute(a: number) { let t = a * 2; let u = t + 1; let v = u * 3; return v - 4; }",
            "export function calculate(a: number) { let t = a * 2; let u = t + 1; let v = u * 3; return v - 5; }",
        );
        assert_eq!(matching.changes.len(), 1, "one pairing, not add + remove");
        assert_eq!(matching.changes[0].verdict, SymbolVerdict::Changed);
        assert_eq!(matching.changes[0].old_name.as_deref(), Some("compute"));
    }

    #[test]
    fn unrelated_declarations_are_reported_as_added_and_removed() {
        let matching = matched(
            "export function alpha(x: number) { return x + 1; }",
            "export class Registry { private items: string[] = []; }",
        );
        assert_eq!(verdict_of(&matching, "Registry"), SymbolVerdict::Added);
        assert_eq!(verdict_of(&matching, "alpha"), SymbolVerdict::Removed);
        let kinds: Vec<ApiChangeKind> = matching.api.iter().map(|a| a.change).collect();
        assert!(kinds.contains(&ApiChangeKind::Added));
        assert!(kinds.contains(&ApiChangeKind::Removed));
    }

    #[test]
    fn a_different_kind_is_never_matched_by_similarity() {
        let matching = matched(
            "export function a() { const x = 1; const y = 2; const z = 3; return x + y + z; }",
            "export interface a { x: number }",
        );
        assert_eq!(matching.changes.len(), 2, "no cross-kind pairing");
    }

    #[test]
    fn reordering_declarations_is_pure_motion() {
        let matching = matched(
            "export function a() { return 1; }\nexport function b() { return 2; }",
            "export function b() { return 2; }\nexport function a() { return 1; }",
        );
        assert!(matching.is_pure_motion());
        assert_eq!(verdict_of(&matching, "a"), SymbolVerdict::Moved);
        assert_eq!(verdict_of(&matching, "b"), SymbolVerdict::Moved);
    }

    #[test]
    fn an_edit_is_not_pure_motion() {
        let matching = matched(
            "export function a() { return 1; }",
            "export function a() { return 2; }",
        );
        assert!(!matching.is_pure_motion());
    }

    #[test]
    fn changing_a_signature_is_an_arity_change_on_the_public_surface() {
        let matching = matched(
            "export function fetchUser(id: string) { return id; }",
            "export function fetchUser(id: string, force: boolean) { return id; }",
        );
        assert_eq!(matching.changes[0].verdict, SymbolVerdict::SignatureOnly);
        assert_eq!(matching.api.len(), 1);
        assert_eq!(matching.api[0].change, ApiChangeKind::ArityChanged);
        assert_eq!(matching.api[0].detail, "arity 1 → 2");
    }

    #[test]
    fn losing_the_export_keyword_is_a_visibility_change() {
        let matching = matched(
            "export function a() { return 1; }",
            "function a() { return 1; }",
        );
        assert_eq!(matching.api.len(), 1);
        assert_eq!(matching.api[0].change, ApiChangeKind::VisibilityChanged);
        assert_eq!(matching.api[0].detail, "exported → private");
    }

    #[test]
    fn a_private_declaration_never_reaches_the_public_surface() {
        let matching = matched(
            "function helper(a: number) { return a; }",
            "function helper(a: number, b: number) { return a + b; }",
        );
        assert!(matching.api.is_empty());
    }

    #[test]
    fn matching_two_empty_sides_produces_nothing() {
        let matching = match_symbols(&[], &[]);
        assert!(matching.changes.is_empty());
        assert!(matching.api.is_empty());
        assert!(!matching.is_pure_motion(), "no motion without symbols");
    }
}
