// SPDX-License-Identifier: GPL-3.0-or-later
//! Named-declaration extraction — the unit V1 reports change in.
//!
//! A recursive descent over declaration nodes, not a tree-sitter query, because
//! the set of kinds is small, the mapping is the interesting part, and a plain
//! `match` on `node.kind()` is the version of this code a reviewer can check
//! against the grammar by eye.
//!
//! What is deliberately *not* extracted: `impl` blocks (their span covers every
//! method, so emitting them would double-count every change), class fields,
//! interface members, and anonymous callbacks. V1 answers "which declarations
//! changed"; anything finer is the text diff's job.

use tree_sitter::{Node, Tree};

use super::lang::{LanguageFamily, Span, SymbolKind, SyntaxLanguage};
use super::tokens;

/// One extracted declaration, with everything the matcher and the verdicts need.
#[derive(Clone, Debug)]
pub struct StructuralSymbol {
    pub name: String,
    pub kind: SymbolKind,
    /// TS/JS `export`, Rust `pub` / `pub(crate)`.
    pub exported: bool,
    /// Enclosing class / impl / trait / module name; `None` at the top level.
    pub container: Option<String>,
    pub span: Span,
    /// Declared parameter count. `None` when the symbol declares no parameters.
    pub arity: Option<u32>,
    /// Position in source order. `Moved` is defined against this rather than
    /// against a line number, so inserting 50 lines above a function does not
    /// report every function below it as moved.
    pub ordinal: usize,
    pub token_count: u32,
    pub raw_hash: u64,
    pub code_hash: u64,
    pub norm_hash: u64,
    /// Hash of the body's raw stream. `None` for bodyless declarations. Equal
    /// bodies with unequal wholes is exactly a signature-only change.
    pub body_raw_hash: Option<u64>,
    pub fingerprint: Vec<u32>,
}

/// The exact-match key: two declarations are "the same declaration" when the
/// container, the kind and the name all agree.
pub type SymbolKey<'a> = (Option<&'a str>, SymbolKind, &'a str);

impl StructuralSymbol {
    pub fn key(&self) -> SymbolKey<'_> {
        (self.container.as_deref(), self.kind, self.name.as_str())
    }

    pub fn qualified_name(&self) -> String {
        match &self.container {
            Some(container) => format!("{container}::{}", self.name),
            None => self.name.clone(),
        }
    }
}

pub fn extract(language: SyntaxLanguage, tree: &Tree, source: &[u8]) -> Vec<StructuralSymbol> {
    let mut symbols = Vec::new();
    let root = tree.root_node();
    match language.family() {
        LanguageFamily::JsFamily => visit_js(root, None, false, source, &mut symbols),
        LanguageFamily::Rust => visit_rust(root, None, source, &mut symbols),
    }
    for (ordinal, symbol) in symbols.iter_mut().enumerate() {
        symbol.ordinal = ordinal;
    }
    symbols
}

/// Everything `push` needs that is not inherited from the enclosing scope.
struct Decl<'a> {
    node: Node<'a>,
    name: String,
    kind: SymbolKind,
    exported: bool,
    body: Option<Node<'a>>,
    arity: Option<u32>,
}

fn push(decl: Decl, container: Option<&str>, source: &[u8], out: &mut Vec<StructuralSymbol>) {
    let streams = tokens::collect(decl.node, source);
    let body_raw_hash = decl
        .body
        .map(|body| tokens::collect(body, source).raw_hash());
    out.push(StructuralSymbol {
        name: decl.name,
        kind: decl.kind,
        exported: decl.exported,
        container: container.map(str::to_string),
        span: Span::of(decl.node),
        arity: decl.arity,
        ordinal: 0,
        token_count: streams.token_count(),
        raw_hash: streams.raw_hash(),
        code_hash: streams.code_hash(),
        norm_hash: streams.norm_hash(),
        body_raw_hash,
        fingerprint: streams.fingerprint(),
    });
}

fn field_text(node: Node, field: &str, source: &[u8]) -> Option<String> {
    let child = node.child_by_field_name(field)?;
    let bytes = source.get(child.byte_range())?;
    Some(String::from_utf8_lossy(bytes).into_owned())
}

/// Parameters of `node`, counted from whichever field the grammar uses.
fn arity_of(node: Node) -> Option<u32> {
    // `arrow_function` uses the singular `parameter` field for `x => x`.
    if node.child_by_field_name("parameter").is_some() {
        return Some(1);
    }
    let list = node.child_by_field_name("parameters")?;
    let mut cursor = list.walk();
    let count = list
        .named_children(&mut cursor)
        .filter(|child| !child.kind().ends_with("comment"))
        .count();
    Some(count as u32)
}

// ── TypeScript / TSX / JavaScript / JSX ──────────────────────────────────────

/// Value kinds that make `const f = …` a function rather than a constant.
fn is_js_function_value(kind: &str) -> bool {
    matches!(
        kind,
        "arrow_function" | "function" | "function_expression" | "generator_function"
    )
}

fn visit_js(
    node: Node,
    container: Option<&str>,
    exported: bool,
    source: &[u8],
    out: &mut Vec<StructuralSymbol>,
) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        match child.kind() {
            // `export …` / `declare …` only change the flag; the declaration is
            // the child underneath.
            "export_statement" => visit_js(child, container, true, source, out),
            "ambient_declaration" => visit_js(child, container, exported, source, out),

            "function_declaration" | "generator_function_declaration" | "function_signature" => {
                push(
                    Decl {
                        node: child,
                        // `export default function () {}` has no name.
                        name: field_text(child, "name", source).unwrap_or_else(|| "default".into()),
                        kind: SymbolKind::Function,
                        exported,
                        body: child.child_by_field_name("body"),
                        arity: arity_of(child),
                    },
                    container,
                    source,
                    out,
                );
            }

            "method_definition" | "method_signature" | "abstract_method_signature" => {
                push(
                    Decl {
                        node: child,
                        name: field_text(child, "name", source).unwrap_or_else(|| "?".into()),
                        kind: SymbolKind::Method,
                        exported,
                        body: child.child_by_field_name("body"),
                        arity: arity_of(child),
                    },
                    container,
                    source,
                    out,
                );
            }

            "class_declaration" | "abstract_class_declaration" => {
                let name = field_text(child, "name", source).unwrap_or_else(|| "default".into());
                push(
                    Decl {
                        node: child,
                        name: name.clone(),
                        kind: SymbolKind::Class,
                        exported,
                        body: None,
                        arity: None,
                    },
                    container,
                    source,
                    out,
                );
                if let Some(body) = child.child_by_field_name("body") {
                    // Methods are not exported in their own right; the class is.
                    visit_js(body, Some(&name), false, source, out);
                }
            }

            "interface_declaration" | "enum_declaration" | "type_alias_declaration" => {
                let kind = match child.kind() {
                    "interface_declaration" => SymbolKind::Interface,
                    "enum_declaration" => SymbolKind::Enum,
                    _ => SymbolKind::TypeAlias,
                };
                push(
                    Decl {
                        node: child,
                        name: field_text(child, "name", source).unwrap_or_else(|| "?".into()),
                        kind,
                        exported,
                        body: None,
                        arity: None,
                    },
                    container,
                    source,
                    out,
                );
            }

            "lexical_declaration" | "variable_declaration" => {
                visit_js_declarators(child, container, exported, source, out);
            }

            _ => {}
        }
    }
}

fn visit_js_declarators(
    declaration: Node,
    container: Option<&str>,
    exported: bool,
    source: &[u8],
    out: &mut Vec<StructuralSymbol>,
) {
    let mut cursor = declaration.walk();
    for declarator in declaration.named_children(&mut cursor) {
        if declarator.kind() != "variable_declarator" {
            continue;
        }
        let Some(name) = field_text(declarator, "name", source) else {
            continue;
        };
        let value = declarator.child_by_field_name("value");
        let is_function = value.is_some_and(|v| is_js_function_value(v.kind()));
        push(
            Decl {
                node: declarator,
                name,
                kind: if is_function {
                    SymbolKind::Function
                } else {
                    SymbolKind::Const
                },
                exported,
                body: value.and_then(|v| v.child_by_field_name("body")),
                arity: value.filter(|_| is_function).and_then(|v| arity_of(v)),
            },
            container,
            source,
            out,
        );
    }
}

// ── Rust ─────────────────────────────────────────────────────────────────────

fn is_public(node: Node) -> bool {
    let mut cursor = node.walk();
    let public = node
        .children(&mut cursor)
        .any(|child| child.kind() == "visibility_modifier");
    public
}

fn visit_rust(node: Node, container: Option<&str>, source: &[u8], out: &mut Vec<StructuralSymbol>) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        match child.kind() {
            "function_item" | "function_signature_item" => {
                push(
                    Decl {
                        node: child,
                        name: field_text(child, "name", source).unwrap_or_else(|| "?".into()),
                        kind: if container.is_some() {
                            SymbolKind::Method
                        } else {
                            SymbolKind::Function
                        },
                        exported: is_public(child),
                        body: child.child_by_field_name("body"),
                        arity: arity_of(child),
                    },
                    container,
                    source,
                    out,
                );
            }

            "struct_item" | "union_item" | "enum_item" | "type_item" | "const_item"
            | "static_item" | "macro_definition" => {
                let kind = match child.kind() {
                    "struct_item" | "union_item" => SymbolKind::Struct,
                    "enum_item" => SymbolKind::Enum,
                    "type_item" => SymbolKind::TypeAlias,
                    "macro_definition" => SymbolKind::Macro,
                    _ => SymbolKind::Const,
                };
                push(
                    Decl {
                        node: child,
                        name: field_text(child, "name", source).unwrap_or_else(|| "?".into()),
                        kind,
                        exported: is_public(child),
                        body: None,
                        arity: None,
                    },
                    container,
                    source,
                    out,
                );
            }

            "trait_item" => {
                let name = field_text(child, "name", source).unwrap_or_else(|| "?".into());
                push(
                    Decl {
                        node: child,
                        name: name.clone(),
                        kind: SymbolKind::Trait,
                        exported: is_public(child),
                        body: None,
                        arity: None,
                    },
                    container,
                    source,
                    out,
                );
                if let Some(body) = child.child_by_field_name("body") {
                    visit_rust(body, Some(&name), source, out);
                }
            }

            // The impl block itself is not a symbol: its span covers every
            // method, so emitting it would count every change twice.
            "impl_item" => {
                let name = field_text(child, "type", source).unwrap_or_else(|| "?".into());
                if let Some(body) = child.child_by_field_name("body") {
                    visit_rust(body, Some(&name), source, out);
                }
            }

            // A module is a namespace, not a declaration worth diffing on its
            // own — but its contents are.
            "mod_item" => {
                let name = field_text(child, "name", source).unwrap_or_else(|| "?".into());
                if let Some(body) = child.child_by_field_name("body") {
                    visit_rust(body, Some(&name), source, out);
                }
            }

            "declaration_list" => visit_rust(child, container, source, out),

            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::lang::parser_for;
    use super::*;

    fn symbols(language: SyntaxLanguage, source: &str) -> Vec<StructuralSymbol> {
        let mut parser = parser_for(language).expect("grammar loads");
        let tree = parser.parse(source, None).expect("parse succeeds");
        assert!(!tree.root_node().has_error(), "fixture must parse cleanly");
        extract(language, &tree, source.as_bytes())
    }

    fn find<'a>(all: &'a [StructuralSymbol], name: &str) -> &'a StructuralSymbol {
        all.iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("{name} was not extracted"))
    }

    #[test]
    fn typescript_declarations_carry_kind_export_and_arity() {
        let all = symbols(
            SyntaxLanguage::TypeScript,
            "\
export function fetchUser(id: string, force: boolean) { return id; }
function helper() {}
export const format = (value: number) => String(value);
const LIMIT = 10;
export interface Options { a: number }
export type Alias = string;
export enum Mode { A, B }
",
        );

        let fetch = find(&all, "fetchUser");
        assert_eq!(fetch.kind, SymbolKind::Function);
        assert!(fetch.exported);
        assert_eq!(fetch.arity, Some(2));

        assert!(!find(&all, "helper").exported);

        let format = find(&all, "format");
        assert_eq!(format.kind, SymbolKind::Function);
        assert!(format.exported);
        assert_eq!(format.arity, Some(1));

        assert_eq!(find(&all, "LIMIT").kind, SymbolKind::Const);
        assert_eq!(find(&all, "Options").kind, SymbolKind::Interface);
        assert_eq!(find(&all, "Alias").kind, SymbolKind::TypeAlias);
        assert_eq!(find(&all, "Mode").kind, SymbolKind::Enum);
    }

    #[test]
    fn class_methods_are_nested_under_their_class() {
        let all = symbols(
            SyntaxLanguage::TypeScript,
            "export class Store { add(item: string) {} remove() {} }",
        );
        assert_eq!(find(&all, "Store").kind, SymbolKind::Class);
        let add = find(&all, "add");
        assert_eq!(add.kind, SymbolKind::Method);
        assert_eq!(add.container.as_deref(), Some("Store"));
        assert_eq!(add.arity, Some(1));
        assert_eq!(add.qualified_name(), "Store::add");
    }

    #[test]
    fn tsx_components_are_extracted() {
        let all = symbols(
            SyntaxLanguage::Tsx,
            "export const Badge = ({ label }: Props) => <span>{label}</span>;",
        );
        let badge = find(&all, "Badge");
        assert_eq!(badge.kind, SymbolKind::Function);
        assert!(badge.exported);
    }

    #[test]
    fn rust_items_carry_visibility_and_impl_container() {
        let all = symbols(
            SyntaxLanguage::Rust,
            "\
pub fn run(a: u32, b: u32) -> u32 { a + b }
fn private_helper() {}
pub struct Engine { field: u32 }
impl Engine {
    pub fn start(&self, name: &str) {}
}
pub trait Runner { fn go(&self); }
pub const LIMIT: u32 = 4;
",
        );

        let run = find(&all, "run");
        assert_eq!(run.kind, SymbolKind::Function);
        assert!(run.exported);
        assert_eq!(run.arity, Some(2));

        assert!(!find(&all, "private_helper").exported);
        assert_eq!(find(&all, "Engine").kind, SymbolKind::Struct);

        let start = find(&all, "start");
        assert_eq!(start.kind, SymbolKind::Method);
        assert_eq!(start.container.as_deref(), Some("Engine"));
        // `&self` counts: it is part of the declared parameter list.
        assert_eq!(start.arity, Some(2));

        assert_eq!(find(&all, "Runner").kind, SymbolKind::Trait);
        assert_eq!(find(&all, "LIMIT").kind, SymbolKind::Const);
    }

    /// The impl block must not appear as a symbol of its own, or every method
    /// change would also be reported as an impl change.
    #[test]
    fn an_impl_block_is_not_itself_a_symbol() {
        let all = symbols(
            SyntaxLanguage::Rust,
            "pub struct A; impl A { pub fn f(&self) {} }",
        );
        assert!(all.iter().all(|s| s.kind != SymbolKind::Impl));
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn rust_module_contents_are_extracted_under_the_module_name() {
        let all = symbols(
            SyntaxLanguage::Rust,
            "#[cfg(test)]\nmod tests {\n    #[test]\n    fn works() {}\n}",
        );
        let works = find(&all, "works");
        assert_eq!(works.container.as_deref(), Some("tests"));
    }

    #[test]
    fn ordinals_follow_source_order() {
        let all = symbols(SyntaxLanguage::Rust, "fn a() {} fn b() {} fn c() {}");
        assert_eq!(
            all.iter().map(|s| s.ordinal).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(find(&all, "c").ordinal, 2);
    }

    #[test]
    fn a_body_hash_exists_only_where_a_body_does() {
        let all = symbols(
            SyntaxLanguage::TypeScript,
            "export function f() { return 1; }\nexport type T = string;",
        );
        assert!(find(&all, "f").body_raw_hash.is_some());
        assert!(find(&all, "T").body_raw_hash.is_none());
    }

    #[test]
    fn extraction_is_stable_under_reformatting() {
        let compact = symbols(
            SyntaxLanguage::TypeScript,
            "export function f(a:number){return a;}",
        );
        let pretty = symbols(
            SyntaxLanguage::TypeScript,
            "export function f(\n  a: number,\n) {\n  return a;\n}\n",
        );
        assert_eq!(compact[0].raw_hash, pretty[0].raw_hash);
        assert_eq!(compact[0].token_count, pretty[0].token_count);
    }
}
