// SPDX-License-Identifier: GPL-3.0-or-later
//! Token streams, hashing and winnowed fingerprints (design §4.2 / §4.3).
//!
//! tree-sitter never turns whitespace into a node, so walking the leaves of a
//! parse tree already discards indentation, line breaks and blank lines. That
//! is the whole basis for "reformatting preserves the token stream".
//!
//! Three streams come out of one walk:
//!
//! | stream | rule | consumer |
//! |---|---|---|
//! | `raw`  | every leaf, comments included | "did anything at all change" |
//! | `code` | comments dropped | "comments only" |
//! | `norm` | comments dropped, identifiers → `ID`, numbers → `NUM`, strings → `STR` | rename detection, V7 fingerprints |
//!
//! `norm` is exactly the Type-2 clone definition. Type-3 (small insertions and
//! deletions) is absorbed by the Jaccard similarity of the fingerprints below.

use tree_sitter::Node;

/// k-gram width. 5 is the clone-detection literature's usual choice: short
/// enough to survive small edits, long enough that common bigrams do not match.
pub const KGRAM: usize = 5;
/// Winnowing window. Guarantees at least one shared gram for any common
/// substring of length `KGRAM + WINDOW - 1`.
pub const WINDOW: usize = 4;

const NORM_IDENT: u32 = 0x1D1D_1D1D;
const NORM_NUMBER: u32 = 0x0E0E_0E0E;
const NORM_STRING: u32 = 0x57_57_57_57;

/// The three derived streams, each a plain `Vec<u32>` so comparison is O(n).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TokenStreams {
    pub raw: Vec<u32>,
    pub code: Vec<u32>,
    pub norm: Vec<u32>,
}

impl TokenStreams {
    pub fn token_count(&self) -> u32 {
        self.code.len() as u32
    }
}

/// Collect the three streams for `node`'s subtree. `source` must be the exact
/// bytes the tree was parsed from.
pub fn streams_for(node: Node<'_>, source: &str) -> TokenStreams {
    let mut streams = TokenStreams::default();
    let bytes = source.as_bytes();
    walk_leaves(node, &mut |leaf| {
        let Ok(text) = leaf.utf8_text(bytes) else {
            return;
        };
        let value = fnv1a32(text.as_bytes());
        streams.raw.push(value);
        if is_comment(leaf.kind()) {
            return;
        }
        streams.code.push(value);
        streams.norm.push(normalize(leaf.kind(), value));
    });
    streams
}

/// The code tokens of `node` that lie **outside** `body` — a symbol's
/// signature. V9 asks "did the signature change", not "did the body change".
pub fn signature_stream(node: Node<'_>, source: &str, body: Option<Node<'_>>) -> Vec<u32> {
    let exclude = body.map(|body| body.byte_range());
    let bytes = source.as_bytes();
    let mut stream = Vec::new();
    walk_leaves(node, &mut |leaf| {
        if let Some(range) = &exclude {
            if leaf.start_byte() >= range.start && leaf.start_byte() < range.end {
                return;
            }
        }
        if is_comment(leaf.kind()) {
            return;
        }
        if let Ok(text) = leaf.utf8_text(bytes) {
            stream.push(fnv1a32(text.as_bytes()));
        }
    });
    stream
}

/// The same walk restricted to identifier leaves — used for reference and call
/// collection, where the text matters and the stream does not.
pub fn identifier_leaves<F: FnMut(&str, u32, usize)>(node: Node<'_>, source: &str, visit: &mut F) {
    let bytes = source.as_bytes();
    walk_named(node, &mut |child| {
        if child.child_count() != 0 || !is_identifier(child.kind()) {
            return;
        }
        if let Ok(text) = child.utf8_text(bytes) {
            let line = child.start_position().row as u32 + 1;
            visit(text, line, child.start_byte());
        }
    });
}

fn walk_leaves<'a, F: FnMut(Node<'a>)>(node: Node<'a>, visit: &mut F) {
    if node.child_count() == 0 {
        visit(node);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_leaves(child, visit);
    }
}

fn walk_named<'a, F: FnMut(Node<'a>)>(node: Node<'a>, visit: &mut F) {
    visit(node);
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_named(child, visit);
    }
}

pub fn is_comment(kind: &str) -> bool {
    matches!(
        kind,
        "comment" | "line_comment" | "block_comment" | "html_comment" | "doc_comment"
    )
}

pub fn is_identifier(kind: &str) -> bool {
    kind.ends_with("identifier")
}

fn is_number(kind: &str) -> bool {
    matches!(kind, "number" | "integer_literal" | "float_literal")
}

fn is_string(kind: &str) -> bool {
    matches!(
        kind,
        "string"
            | "string_fragment"
            | "string_literal"
            | "raw_string_literal"
            | "char_literal"
            | "template_string"
            | "regex"
            | "regex_pattern"
    )
}

fn normalize(kind: &str, value: u32) -> u32 {
    if is_identifier(kind) {
        NORM_IDENT
    } else if is_number(kind) {
        NORM_NUMBER
    } else if is_string(kind) {
        NORM_STRING
    } else {
        // Keywords, operators and punctuation keep their text, which is what
        // makes the normalized stream a structural skeleton.
        value
    }
}

pub fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in bytes {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

pub fn fnv1a64_stream(values: &[u32]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for value in values {
        for byte in value.to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    hash
}

/// Winnowed k-gram fingerprint: sorted, deduplicated, and roughly 40 % the size
/// of the token stream. Storing this instead of the stream is what turns V7's
/// candidate search from O(n²) pairwise comparison into an inverted-index probe.
pub fn fingerprint(norm: &[u32]) -> Vec<u32> {
    if norm.is_empty() {
        return Vec::new();
    }
    // A stream shorter than one k-gram still deserves an identity, otherwise two
    // tiny symbols would look infinitely similar (empty ∩ empty).
    if norm.len() < KGRAM {
        return vec![(fnv1a64_stream(norm) >> 32) as u32];
    }

    let grams: Vec<u32> = norm
        .windows(KGRAM)
        .map(|window| (fnv1a64_stream(window) >> 32) as u32)
        .collect();

    let mut picked: Vec<u32> = Vec::new();
    if grams.len() <= WINDOW {
        picked.push(*grams.iter().min().expect("non-empty"));
    } else {
        let mut last_index = usize::MAX;
        for (offset, window) in grams.windows(WINDOW).enumerate() {
            // Rightmost minimum — the standard winnowing tie-break, which keeps
            // consecutive windows selecting the same gram instead of two.
            let (local, _) = window
                .iter()
                .enumerate()
                .min_by_key(|(index, value)| (**value, std::cmp::Reverse(*index)))
                .expect("non-empty window");
            let index = offset + local;
            if index != last_index {
                picked.push(grams[index]);
                last_index = index;
            }
        }
    }

    picked.sort_unstable();
    picked.dedup();
    picked
}

/// `|A ∩ B| / |A ∪ B|` over sorted, deduplicated fingerprints.
pub fn jaccard(a: &[u32], b: &[u32]) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let shared = intersection_size(a, b);
    let union = a.len() + b.len() - shared;
    if union == 0 {
        return 0.0;
    }
    shared as f32 / union as f32
}

/// `|A ∩ B| / |A|` — "how much of A is inside B". Catches the case where a new
/// function is a copy of a *part* of an existing one.
pub fn containment(a: &[u32], b: &[u32]) -> f32 {
    if a.is_empty() {
        return 0.0;
    }
    intersection_size(a, b) as f32 / a.len() as f32
}

pub fn intersection_size(a: &[u32], b: &[u32]) -> usize {
    let (mut i, mut j, mut shared) = (0, 0, 0);
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                shared += 1;
                i += 1;
                j += 1;
            }
        }
    }
    shared
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::lang::parser_for;
    use crate::verify::context::model::SyntaxLanguage;

    fn streams(language: SyntaxLanguage, source: &str) -> TokenStreams {
        let mut parser = parser_for(language).expect("grammar");
        let tree = parser.parse(source, None).expect("parse");
        streams_for(tree.root_node(), source)
    }

    fn ts(source: &str) -> TokenStreams {
        streams(SyntaxLanguage::TypeScript, source)
    }

    #[test]
    fn reformatting_preserves_every_stream() {
        let dense = "function a(b:number){return b+1;}";
        let spread = "function a(b: number) {\n\n    return b + 1;\n}\n";
        assert_eq!(ts(dense).raw, ts(spread).raw);
    }

    #[test]
    fn comments_change_raw_but_not_code() {
        let plain = "function a() { return 1; }";
        let commented = "// explains a\nfunction a() { /* inner */ return 1; }";
        assert_ne!(ts(plain).raw, ts(commented).raw);
        assert_eq!(ts(plain).code, ts(commented).code);
    }

    #[test]
    fn renaming_changes_code_but_not_norm() {
        let before = "function first(alpha) { return alpha * 2; }";
        let after = "function second(beta) { return beta * 2; }";
        assert_ne!(ts(before).code, ts(after).code);
        assert_eq!(ts(before).norm, ts(after).norm);
    }

    #[test]
    fn literal_values_are_normalized_away() {
        let before = "function a() { return \"x\" + 1; }";
        let after = "function a() { return \"totally different\" + 4321; }";
        assert_ne!(ts(before).code, ts(after).code);
        assert_eq!(ts(before).norm, ts(after).norm);
    }

    #[test]
    fn a_body_change_changes_the_normalized_stream() {
        let before = "function a(b) { return b * 2; }";
        let after = "function a(b) { if (b) { return b; } return 0; }";
        assert_ne!(ts(before).norm, ts(after).norm);
    }

    #[test]
    fn fingerprints_are_deterministic_and_sorted() {
        let source = "function a(b) { let c = 0; for (const d of b) { c += d; } return c; }";
        let first = fingerprint(&ts(source).norm);
        let second = fingerprint(&ts(source).norm);
        assert_eq!(first, second);
        assert!(!first.is_empty());
        assert!(first.windows(2).all(|w| w[0] < w[1]), "sorted and unique");
    }

    #[test]
    fn a_type_two_clone_scores_one_and_unrelated_code_scores_low() {
        let original = "function sumAll(items) { let total = 0; for (const item of items) { total += item.value; } return total; }";
        let renamed = "function addEverything(rows) { let acc = 0; for (const row of rows) { acc += row.value; } return acc; }";
        let unrelated = "function connect(url, retries) { const socket = open(url); while (retries > 0) { socket.ping(); retries -= 1; } socket.close(); return socket; }";

        let a = fingerprint(&ts(original).norm);
        let b = fingerprint(&ts(renamed).norm);
        let c = fingerprint(&ts(unrelated).norm);

        assert_eq!(jaccard(&a, &b), 1.0, "identifier renaming is a Type-2 clone");
        assert!(jaccard(&a, &c) < 0.4, "unrelated code must score low");
        assert_eq!(containment(&a, &b), 1.0);
    }

    #[test]
    fn a_type_three_clone_stays_similar_but_not_identical() {
        let original = "function run(items) { let total = 0; for (const item of items) { total += item.value; } return total; }";
        let with_extra = "function run(items) { let total = 0; for (const item of items) { if (!item) { continue; } total += item.value; } return total; }";
        let a = fingerprint(&ts(original).norm);
        let b = fingerprint(&ts(with_extra).norm);
        let score = jaccard(&a, &b);
        assert!(score < 1.0 && score > 0.4, "type-3 similarity was {score}");
    }

    #[test]
    fn empty_and_short_streams_are_handled() {
        assert!(fingerprint(&[]).is_empty());
        assert_eq!(fingerprint(&[1, 2]).len(), 1);
        assert_eq!(jaccard(&[], &[1]), 0.0);
        assert_eq!(containment(&[], &[1]), 0.0);
    }

    #[test]
    fn rust_streams_follow_the_same_rules() {
        let before = streams(SyntaxLanguage::Rust, "pub fn alpha(x: u32) -> u32 { x + 1 }");
        let after = streams(SyntaxLanguage::Rust, "pub fn beta(y: u32) -> u32 { y + 1 }");
        assert_ne!(before.code, after.code);
        assert_eq!(before.norm, after.norm);
    }
}
