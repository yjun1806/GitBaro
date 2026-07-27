// SPDX-License-Identifier: GPL-3.0-or-later
//! Leaf-token streams — the physical basis of "this change is only noise".
//!
//! tree-sitter never emits a node for whitespace, so indentation, line breaks
//! and brace style vanish before we look. That makes "formatting only"
//! decidable by comparing two `Vec<u32>` in O(tokens) — no tree edit distance
//! required.
//!
//! The design's claim that a reformatter *cannot* change the token stream is
//! not quite true, and this module is where the gap is closed: a trailing comma
//! and a statement semicolon are real leaf tokens that Prettier and rustfmt add
//! and remove freely. They are dropped here — see [`is_optional_punctuation`].
//! Without that, running a formatter would be classified `Semantic`, defeating
//! the one scenario V1 exists for.
//!
//! One walk derives three streams:
//!
//! | stream | contents | decides |
//! |---|---|---|
//! | `raw`  | every leaf, comments included | `FormattingOnly` |
//! | `code` | comments dropped | `CommentsOnly` |
//! | `norm` | comments dropped, identifiers folded to one sentinel | `RenameOnly` |
//!
//! **Deliberate deviation from the design (§4.2).** The design also folds
//! numeric and string literals into `NUM`/`STR` sentinels, because that is the
//! definition of a Type-2 clone. This module keeps literals intact: a literal's
//! *value* is behaviour, only an identifier's *name* is not. Folding them would
//! classify `TIMEOUT = 30` → `TIMEOUT = 3000` as `RenameOnly`, which V17 treats
//! as a passing `docs:` commit — a false "nothing to see here" on a real
//! behaviour change, and the single worst failure mode of this feature. Clone
//! detection (V7) needs the literal-folding variant and owns its own streams.

use std::cmp::Ordering;

use tree_sitter::Node;

const FNV_OFFSET_32: u32 = 0x811c_9dc5;
const FNV_PRIME_32: u32 = 0x0100_0193;
const FNV_OFFSET_64: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME_64: u64 = 0x0000_0100_0000_01b3;

/// Text hash every identifier collapses to in the `norm` stream. The value is
/// arbitrary; it only has to be one no real token text is likely to hash to.
const IDENTIFIER_SENTINEL: u32 = 0xFEED_1DE7;

/// k-gram width for the winnowed fingerprint.
pub const KGRAM: usize = 5;
/// Winnowing window width.
pub const WINDOW: usize = 4;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenStreams {
    pub raw: Vec<u32>,
    pub code: Vec<u32>,
    pub norm: Vec<u32>,
    /// No ERROR and no MISSING node anywhere under the walked root. When this
    /// is false the streams are garbage and **must not** be compared — a tree
    /// with an error node silently drops or invents tokens.
    pub parse_ok: bool,
}

impl Default for TokenStreams {
    fn default() -> Self {
        Self {
            raw: Vec::new(),
            code: Vec::new(),
            norm: Vec::new(),
            parse_ok: true,
        }
    }
}

impl TokenStreams {
    pub fn raw_hash(&self) -> u64 {
        hash_stream(&self.raw)
    }

    pub fn code_hash(&self) -> u64 {
        hash_stream(&self.code)
    }

    pub fn norm_hash(&self) -> u64 {
        hash_stream(&self.norm)
    }

    /// Comment tokens are not code, so they do not count towards size.
    pub fn token_count(&self) -> u32 {
        self.code.len() as u32
    }

    pub fn fingerprint(&self) -> Vec<u32> {
        winnow(&self.norm)
    }
}

/// Collect the three streams from every leaf under `root`.
///
/// The walk is iterative, not recursive: a 2 MiB file of chained expressions
/// produces an AST thousands of levels deep, and a recursive descent over it
/// would overflow the stack of a GUI process.
pub fn collect(root: Node, source: &[u8]) -> TokenStreams {
    let mut streams = TokenStreams::default();
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        if node.is_error() || node.is_missing() {
            streams.parse_ok = false;
        }
        // A comment is one token, never its parts. Rust `///` comments are not
        // leaves — the grammar splits them into a marker and a body — so
        // descending into them would leak comment text into the code stream and
        // make "comments only" undetectable.
        let comment = is_comment_kind(node.kind());
        let descend = !comment && node.child_count() > 0;
        if !descend {
            push_leaf(&mut streams, node, source, comment);
        }
        if descend && cursor.goto_first_child() {
            continue;
        }
        // Climb until a sibling appears; failing to climb means we are back at
        // `root` and the subtree is exhausted.
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                return streams;
            }
        }
    }
}

fn push_leaf(streams: &mut TokenStreams, node: Node, source: &[u8], comment: bool) {
    // A MISSING node is zero-width and was never written by the author.
    if node.is_missing() {
        return;
    }
    let text = source.get(node.byte_range()).unwrap_or(&[]);
    if is_optional_punctuation(node, text) {
        return;
    }
    let token = mix(node.kind_id(), fnv1a32(text));

    streams.raw.push(token);
    if comment {
        return;
    }
    streams.code.push(token);
    streams.norm.push(if is_identifier_kind(node.kind()) {
        mix(node.kind_id(), IDENTIFIER_SENTINEL)
    } else {
        token
    });
}

/// Punctuation a reformatter is free to add or remove, and therefore the one
/// place the "a reformat cannot change the token stream" claim would otherwise
/// be false. Prettier's `trailingComma` and `semi` options and rustfmt's
/// trailing commas all land here; without this, running a formatter would be
/// reported as a semantic change, which is the exact scenario V1 exists for.
///
/// Known cost: in Rust, `{ g() }` and `{ g(); }` become indistinguishable. They
/// differ in the block's value, but a program where that difference matters
/// does not compile both ways, so among compiling programs the pair really is
/// equivalent.
fn is_optional_punctuation(node: Node, text: &[u8]) -> bool {
    match text {
        // A statement terminator is always its statement's last child.
        b";" => node.next_sibling().is_none(),
        // A trailing comma is last, or sits immediately before the closer.
        b"," => match node.next_sibling() {
            None => true,
            Some(next) => matches!(next.kind(), ")" | "]" | "}" | ">"),
        },
        _ => false,
    }
}

/// `comment`, `line_comment`, `block_comment`, `doc_comment`, `html_comment` …
fn is_comment_kind(kind: &str) -> bool {
    kind.ends_with("comment")
}

/// TS `identifier` / `type_identifier` / `property_identifier` /
/// `shorthand_property_identifier_pattern`, Rust `identifier` /
/// `field_identifier` … `primitive_type` is deliberately *not* an identifier:
/// changing `u32` to `u64` is behaviour, not a rename.
fn is_identifier_kind(kind: &str) -> bool {
    kind.contains("identifier")
}

/// Fold the grammar's node-kind id together with the token text so that the
/// same text in a different syntactic role is a different token.
fn mix(kind_id: u16, text_hash: u32) -> u32 {
    let mut hash = FNV_OFFSET_32;
    for byte in kind_id.to_le_bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME_32);
    }
    for byte in text_hash.to_le_bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME_32);
    }
    hash
}

pub fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut hash = FNV_OFFSET_32;
    for byte in bytes {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME_32);
    }
    hash
}

fn hash_stream(stream: &[u32]) -> u64 {
    let mut hash = FNV_OFFSET_64;
    for value in stream {
        for byte in value.to_le_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(FNV_PRIME_64);
        }
    }
    hash
}

/// Standard winnowing: hash every k-gram, then keep the minimum of each sliding
/// window (rightmost on a tie). Deterministic, and roughly 0.4 × the token
/// count in size.
///
/// Streams shorter than `KGRAM` cannot produce a k-gram, so they fall back to
/// the sorted token set — short symbols still compare against each other rather
/// than matching everything with an empty fingerprint.
pub fn winnow(stream: &[u32]) -> Vec<u32> {
    let mut picked = if stream.len() < KGRAM {
        stream.to_vec()
    } else {
        let grams: Vec<u32> = stream.windows(KGRAM).map(hash_stream_u32).collect();
        if grams.len() < WINDOW {
            grams
        } else {
            grams
                .windows(WINDOW)
                .map(|window| {
                    let mut best = 0;
                    for index in 1..window.len() {
                        if window[index] <= window[best] {
                            best = index;
                        }
                    }
                    window[best]
                })
                .collect()
        }
    };
    picked.sort_unstable();
    picked.dedup();
    picked
}

fn hash_stream_u32(gram: &[u32]) -> u32 {
    let mut hash = FNV_OFFSET_32;
    for value in gram {
        for byte in value.to_le_bytes() {
            hash ^= u32::from(byte);
            hash = hash.wrapping_mul(FNV_PRIME_32);
        }
    }
    hash
}

/// `|A ∩ B| / |A ∪ B|` over two sorted, deduplicated fingerprints.
pub fn jaccard(a: &[u32], b: &[u32]) -> f32 {
    if a.is_empty() || b.is_empty() {
        // An empty fingerprint carries no evidence; claiming similarity would
        // match every trivial symbol against every other.
        return 0.0;
    }
    let (mut i, mut j, mut intersection) = (0usize, 0usize, 0usize);
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            Ordering::Less => i += 1,
            Ordering::Greater => j += 1,
            Ordering::Equal => {
                intersection += 1;
                i += 1;
                j += 1;
            }
        }
    }
    let union = a.len() + b.len() - intersection;
    if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    }
}

#[cfg(test)]
mod tests {
    use super::super::lang::{parser_for, SyntaxLanguage};
    use super::*;

    fn streams(language: SyntaxLanguage, source: &str) -> TokenStreams {
        let mut parser = parser_for(language).expect("grammar loads");
        let tree = parser.parse(source, None).expect("parse succeeds");
        collect(tree.root_node(), source.as_bytes())
    }

    fn ts(source: &str) -> TokenStreams {
        streams(SyntaxLanguage::TypeScript, source)
    }

    fn rust(source: &str) -> TokenStreams {
        streams(SyntaxLanguage::Rust, source)
    }

    #[test]
    fn whitespace_and_indentation_leave_every_stream_untouched() {
        let a = ts("function f(a: number) { return a + 1; }");
        let b = ts("function f(\n    a: number,\n) {\n  return a + 1;\n}\n");
        assert_eq!(a.raw, b.raw);
        assert_eq!(a.code, b.code);
        assert_eq!(a.norm, b.norm);
    }

    /// Prettier's `trailingComma` option. Without the punctuation rule this is
    /// a `Semantic` change, which would make the feature useless on the exact
    /// diff it was built for.
    #[test]
    fn adding_a_trailing_comma_leaves_the_stream_untouched() {
        let a = ts("call(alpha, beta)");
        let b = ts("call(\n  alpha,\n  beta,\n)");
        assert_eq!(a.raw, b.raw);

        let a = ts("const xs = [1, 2];");
        let b = ts("const xs = [\n  1,\n  2,\n];");
        assert_eq!(a.raw, b.raw);
    }

    /// Prettier's `semi: false`.
    #[test]
    fn dropping_statement_semicolons_leaves_the_stream_untouched() {
        let a = ts("const a = 1;\nconst b = 2;\n");
        let b = ts("const a = 1\nconst b = 2\n");
        assert_eq!(a.raw, b.raw);
    }

    /// A separating comma is *not* optional — losing one is a real change.
    #[test]
    fn an_interior_comma_still_counts() {
        let a = ts("call(alpha, beta)");
        let b = ts("call(alpha)");
        assert_ne!(a.raw, b.raw);
    }

    #[test]
    fn rustfmt_trailing_commas_leave_the_stream_untouched() {
        let a = rust("fn f(a: u32, b: u32) -> u32 { a + b }");
        let b = rust("fn f(\n    a: u32,\n    b: u32,\n) -> u32 {\n    a + b\n}\n");
        assert_eq!(a.raw, b.raw);
    }

    #[test]
    fn a_comment_changes_raw_but_not_code_or_norm() {
        let a = ts("function f() { return 1; }");
        let b = ts("// explains f\nfunction f() { return 1; }");
        assert_ne!(a.raw, b.raw);
        assert_eq!(a.code, b.code);
        assert_eq!(a.norm, b.norm);
    }

    #[test]
    fn renaming_an_identifier_changes_code_but_not_norm() {
        let a = ts("function f(alpha: number) { return alpha + 1; }");
        let b = ts("function f(beta: number) { return beta + 1; }");
        assert_ne!(a.code, b.code);
        assert_eq!(a.norm, b.norm);
    }

    /// The deviation documented at the top of this file: a literal is value, not
    /// name, so it must survive normalization.
    #[test]
    fn changing_a_literal_changes_norm() {
        let a = ts("const TIMEOUT = 30;");
        let b = ts("const TIMEOUT = 3000;");
        assert_ne!(a.norm, b.norm);

        let a = rust("const TIMEOUT: u32 = 30;");
        let b = rust("const TIMEOUT: u32 = 3000;");
        assert_ne!(a.norm, b.norm);
    }

    /// `u32` → `u64` is a behaviour change, not a rename.
    #[test]
    fn changing_a_primitive_type_changes_norm() {
        let a = rust("fn f(a: u32) -> u32 { a }");
        let b = rust("fn f(a: u64) -> u64 { a }");
        assert_ne!(a.norm, b.norm);
    }

    #[test]
    fn rust_comments_are_dropped_from_the_code_stream() {
        let a = rust("fn f() -> u32 { 1 }");
        let b = rust("/// doc\nfn f() -> u32 {\n    // inner\n    1\n}");
        assert_ne!(a.raw, b.raw);
        assert_eq!(a.code, b.code);
    }

    #[test]
    fn a_broken_source_is_reported_as_not_parse_ok() {
        let broken = ts("function f( {");
        assert!(!broken.parse_ok);
        let sound = ts("function f() {}");
        assert!(sound.parse_ok);
    }

    #[test]
    fn winnowing_is_deterministic_and_order_independent_in_output() {
        let stream: Vec<u32> = (0..40).map(|i| i * 7 % 13).collect();
        let first = winnow(&stream);
        assert_eq!(first, winnow(&stream));
        assert!(first.windows(2).all(|w| w[0] < w[1]), "sorted and deduped");
        assert!(!first.is_empty());
    }

    #[test]
    fn a_short_stream_falls_back_to_its_token_set() {
        let fingerprint = winnow(&[9, 3, 9]);
        assert_eq!(fingerprint, vec![3, 9]);
    }

    #[test]
    fn jaccard_is_one_for_a_pure_rename_and_low_for_unrelated_code() {
        let a =
            ts("function alpha(x: number) { let y = x * 2; if (y > 3) { return y; } return 0; }");
        let b =
            ts("function beta(p: number) { let q = p * 2; if (q > 3) { return q; } return 0; }");
        assert_eq!(jaccard(&a.fingerprint(), &b.fingerprint()), 1.0);

        let c = ts(
            "class Store { private items: string[] = []; add(v: string) { this.items.push(v); } }",
        );
        assert!(jaccard(&a.fingerprint(), &c.fingerprint()) < 0.2);
    }

    #[test]
    fn an_empty_fingerprint_never_claims_similarity() {
        assert_eq!(jaccard(&[], &[1, 2, 3]), 0.0);
        assert_eq!(jaccard(&[], &[]), 0.0);
    }
}
