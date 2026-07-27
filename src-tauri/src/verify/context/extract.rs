// SPDX-License-Identifier: GPL-3.0-or-later
//! Parse tree → [`FileSymbols`].
//!
//! Extraction is a hand-written cursor walk rather than a `.scm` query set.
//! The reason is failure mode: a query that does not compile against a grammar
//! version takes the *whole* feature down, whereas an unrecognised node kind in
//! a cursor walk costs exactly the symbols in that node. Accuracy over coverage
//! is the same trade-off the design makes for parse degradation.
//!
//! Two rules that are easy to get wrong and are pinned by tests below:
//!
//! - A Rust `#[tauri::command]` is a **sibling** `attribute_item`, not a child
//!   of the `function_item` it decorates.
//! - `export const f = () => {}` is a `lexical_declaration`, so the exported
//!   flag lives two levels above the arrow function that owns the body.

use std::collections::BTreeSet;

use tree_sitter::Node;

use super::lang::parser_for;
use super::model::{
    FileStamp, FileSymbols, IdentifierRef, ImportRecord, Span, SymbolKind, SymbolRecord,
    SyntaxLanguage,
};
use super::tokens::{
    fingerprint, fnv1a64_stream, identifier_leaves, signature_stream, streams_for,
};
use super::{MAX_CALLS_PER_SYMBOL, MAX_REFERENCES_PER_FILE, MAX_SYMBOLS_PER_FILE};

/// Everything a caller must supply that cannot be derived from the source.
pub struct FileIdentity {
    pub path: String,
    pub content_id: String,
    pub stamp: FileStamp,
}

impl FileIdentity {
    /// Identity for sources that never touch disk (tests, diff revisions).
    pub fn transient(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            content_id: String::new(),
            stamp: FileStamp {
                size: 0,
                mtime_ms: 0,
            },
        }
    }
}

/// Parse and extract. Returns `None` only when the grammar itself refuses to
/// load or tree-sitter declines the source — both are "not checked", never an
/// error the user sees.
pub fn extract_file(
    identity: FileIdentity,
    source: &str,
    language: SyntaxLanguage,
) -> Option<FileSymbols> {
    let mut parser = parser_for(language)?;
    let tree = parser.parse(source, None)?;
    let root = tree.root_node();

    let mut state = Extraction {
        source,
        symbols: Vec::new(),
        imports: Vec::new(),
        definition_bytes: BTreeSet::new(),
        import_ranges: Vec::new(),
    };

    match language {
        SyntaxLanguage::Rust => state.visit_rust(root, None, &mut Vec::new()),
        _ => state.visit_js(root, None, false, &mut Vec::new()),
    }

    let references = state.collect_references(root);
    Some(FileSymbols {
        path: identity.path,
        language,
        content_id: identity.content_id,
        stamp: identity.stamp,
        symbols: state.symbols,
        references,
        imports: state.imports,
        parse_ok: !root.has_error(),
    })
}

struct Extraction<'a> {
    source: &'a str,
    symbols: Vec<SymbolRecord>,
    imports: Vec<ImportRecord>,
    /// Start bytes of definition-name nodes, so they are not counted as
    /// references to themselves.
    definition_bytes: BTreeSet<usize>,
    /// Byte ranges of import/use statements. An import names a symbol but does
    /// not *call* it, and counting it would double every V9 caller list.
    import_ranges: Vec<(usize, usize)>,
}

/// The arguments of [`Extraction::push_symbol`], built with `..self.draft(..)`.
struct SymbolDraft<'a> {
    node: Node<'a>,
    name_node: Option<Node<'a>>,
    name: String,
    kind: SymbolKind,
    exported: bool,
    container: Option<String>,
    body: Option<Node<'a>>,
    attributes: Vec<String>,
}

impl<'a> Extraction<'a> {
    fn text(&self, node: Node<'a>) -> String {
        node.utf8_text(self.source.as_bytes())
            .unwrap_or_default()
            .to_string()
    }

    fn span(&self, node: Node<'a>) -> Span {
        Span {
            start_line: node.start_position().row as u32 + 1,
            end_line: node.end_position().row as u32 + 1,
            start_byte: node.start_byte() as u32,
            end_byte: node.end_byte() as u32,
        }
    }

    fn push_symbol(&mut self, draft: SymbolDraft<'a>) {
        let SymbolDraft {
            node,
            name_node,
            name,
            kind,
            exported,
            container,
            body,
            attributes,
        } = draft;
        if self.symbols.len() >= MAX_SYMBOLS_PER_FILE || name.is_empty() {
            return;
        }
        if let Some(name_node) = name_node {
            self.definition_bytes.insert(name_node.start_byte());
        }

        let streams = streams_for(node, self.source);
        let signature = signature_stream(node, self.source, body);
        let calls = self.calls_in(body.unwrap_or(node), name_node);

        self.symbols.push(SymbolRecord {
            name,
            kind,
            exported,
            container,
            span: self.span(node),
            body_span: body.map(|body| self.span(body)),
            token_count: streams.token_count(),
            fingerprint: fingerprint(&streams.norm),
            raw_token_hash: fnv1a64_stream(&streams.raw),
            norm_token_hash: fnv1a64_stream(&streams.norm),
            signature_hash: fnv1a64_stream(&signature),
            calls,
            attributes,
        });
    }

    /// `node` plus the pieces that cannot be derived from it. Named fields
    /// instead of eight positional arguments — the `exported` / `container`
    /// pair in particular is trivial to swap by accident.
    fn draft(&self, node: Node<'a>, kind: SymbolKind) -> SymbolDraft<'a> {
        let name_node = node.child_by_field_name("name");
        SymbolDraft {
            node,
            name_node,
            name: name_node.map(|node| self.text(node)).unwrap_or_default(),
            kind,
            exported: false,
            container: None,
            body: node.child_by_field_name("body"),
            attributes: Vec::new(),
        }
    }

    /// Identifiers used inside a symbol, minus its own name.
    fn calls_in(&self, body: Node<'a>, name_node: Option<Node<'a>>) -> Vec<String> {
        let skip = name_node.map(|node| node.start_byte());
        let mut names: BTreeSet<String> = BTreeSet::new();
        identifier_leaves(body, self.source, &mut |name, _line, start| {
            if Some(start) == skip || names.len() >= MAX_CALLS_PER_SYMBOL {
                return;
            }
            names.insert(name.to_string());
        });
        names.into_iter().collect()
    }

    fn collect_references(&self, root: Node<'a>) -> Vec<IdentifierRef> {
        let mut references: Vec<IdentifierRef> = Vec::new();
        let mut seen: BTreeSet<(String, u32)> = BTreeSet::new();
        identifier_leaves(root, self.source, &mut |name, line, start| {
            if self.definition_bytes.contains(&start) || references.len() >= MAX_REFERENCES_PER_FILE
            {
                return;
            }
            if self
                .import_ranges
                .iter()
                .any(|(from, to)| start >= *from && start < *to)
            {
                return;
            }
            if seen.insert((name.to_string(), line)) {
                references.push(IdentifierRef {
                    name: name.to_string(),
                    line,
                });
            }
        });
        references
    }

    fn children(&self, node: Node<'a>) -> Vec<Node<'a>> {
        let mut cursor = node.walk();
        node.children(&mut cursor).collect()
    }

    // ── TypeScript / TSX / JavaScript / JSX ──────────────────────────────

    fn visit_js(
        &mut self,
        node: Node<'a>,
        container: Option<&str>,
        exported: bool,
        decorators: &mut Vec<String>,
    ) {
        for child in self.children(node) {
            match child.kind() {
                "decorator" => decorators.push(self.text(child).trim_start_matches('@').to_string()),
                "export_statement" => {
                    let mut inherited = std::mem::take(decorators);
                    self.visit_js(child, container, true, &mut inherited);
                    decorators.clear();
                }
                "import_statement" => self.push_import_js(child),
                "class_declaration" | "abstract_class_declaration" | "class" => {
                    self.visit_js_class(child, exported, std::mem::take(decorators));
                }
                "function_declaration" | "generator_function_declaration" | "function_signature" => {
                    let draft = SymbolDraft {
                        exported,
                        container: container.map(str::to_string),
                        attributes: std::mem::take(decorators),
                        ..self.draft(child, SymbolKind::Function)
                    };
                    self.push_symbol(draft);
                }
                "interface_declaration" => {
                    self.push_named_js(child, SymbolKind::Interface, exported, container)
                }
                "type_alias_declaration" => {
                    self.push_named_js(child, SymbolKind::TypeAlias, exported, container)
                }
                "enum_declaration" => {
                    self.push_named_js(child, SymbolKind::Enum, exported, container)
                }
                "lexical_declaration" | "variable_declaration" => {
                    self.visit_js_declaration(child, exported, container)
                }
                // `export default function () {}` / `export default expr`
                "function_expression" | "arrow_function" if exported => {
                    let draft = SymbolDraft {
                        name_node: None,
                        name: "default".to_string(),
                        exported: true,
                        container: container.map(str::to_string),
                        attributes: std::mem::take(decorators),
                        ..self.draft(child, SymbolKind::Function)
                    };
                    self.push_symbol(draft);
                }
                kind if is_js_container(kind) => {
                    self.visit_js(child, container, exported, decorators)
                }
                // Everything else is a statement or an expression: recursing
                // into it would turn every local `const` into a symbol.
                _ => {}
            }
        }
    }

    fn push_named_js(
        &mut self,
        node: Node<'a>,
        kind: SymbolKind,
        exported: bool,
        container: Option<&str>,
    ) {
        let draft = SymbolDraft {
            exported,
            container: container.map(str::to_string),
            ..self.draft(node, kind)
        };
        self.push_symbol(draft);
    }

    fn visit_js_class(&mut self, node: Node<'a>, exported: bool, decorators: Vec<String>) {
        let draft = SymbolDraft {
            exported,
            attributes: decorators,
            ..self.draft(node, SymbolKind::Class)
        };
        let name = draft.name.clone();
        self.push_symbol(draft);

        let Some(body) = node.child_by_field_name("body") else {
            return;
        };
        let mut pending: Vec<String> = Vec::new();
        for member in self.children(body) {
            match member.kind() {
                "decorator" => pending.push(self.text(member).trim_start_matches('@').to_string()),
                "method_definition" => {
                    let draft = SymbolDraft {
                        exported,
                        container: Some(name.clone()),
                        attributes: std::mem::take(&mut pending),
                        ..self.draft(member, SymbolKind::Method)
                    };
                    self.push_symbol(draft);
                }
                "public_field_definition" | "field_definition" => {
                    let value = member.child_by_field_name("value");
                    if !matches!(
                        value.map(|node| node.kind()),
                        Some("arrow_function") | Some("function_expression")
                    ) {
                        pending.clear();
                        continue;
                    }
                    let draft = SymbolDraft {
                        exported,
                        container: Some(name.clone()),
                        body: value.and_then(|node| node.child_by_field_name("body")),
                        attributes: std::mem::take(&mut pending),
                        ..self.draft(member, SymbolKind::Method)
                    };
                    self.push_symbol(draft);
                }
                _ => pending.clear(),
            }
        }
    }

    fn visit_js_declaration(&mut self, node: Node<'a>, exported: bool, container: Option<&str>) {
        for declarator in self.children(node) {
            if declarator.kind() != "variable_declarator" {
                continue;
            }
            let name_node = declarator.child_by_field_name("name");
            let name = name_node.map(|node| self.text(node)).unwrap_or_default();
            let value = declarator.child_by_field_name("value");
            let is_function = matches!(
                value.map(|node| node.kind()),
                Some("arrow_function") | Some("function_expression") | Some("function")
            );
            let kind = if is_function {
                SymbolKind::Function
            } else {
                SymbolKind::Const
            };
            let body = if is_function {
                value.and_then(|node| node.child_by_field_name("body"))
            } else {
                value
            };
            self.push_symbol(SymbolDraft {
                node,
                name_node,
                name,
                kind,
                exported,
                container: container.map(str::to_string),
                body,
                attributes: Vec::new(),
            });
        }
    }

    fn push_import_js(&mut self, node: Node<'a>) {
        let module = node
            .child_by_field_name("source")
            .map(|node| self.text(node).trim_matches(['"', '\''].as_ref()).to_string())
            .unwrap_or_default();
        let mut names = Vec::new();
        identifier_leaves(node, self.source, &mut |name, _line, _start| {
            names.push(name.to_string());
        });
        self.import_ranges.push((node.start_byte(), node.end_byte()));
        self.imports.push(ImportRecord {
            module,
            names,
            line: node.start_position().row as u32 + 1,
        });
    }

    // ── Rust ─────────────────────────────────────────────────────────────

    fn visit_rust(&mut self, node: Node<'a>, container: Option<&str>, attributes: &mut Vec<String>) {
        for child in self.children(node) {
            match child.kind() {
                "attribute_item" | "inner_attribute_item" => {
                    attributes.push(self.rust_attribute_name(child));
                }
                "function_item" | "function_signature_item" => {
                    let kind = if container.is_some() {
                        SymbolKind::Method
                    } else {
                        SymbolKind::Function
                    };
                    let own = self.rust_own_attributes(child);
                    let mut all = std::mem::take(attributes);
                    all.extend(own);
                    let draft = SymbolDraft {
                        exported: self.is_rust_public(child),
                        container: container.map(str::to_string),
                        attributes: all,
                        ..self.draft(child, kind)
                    };
                    self.push_symbol(draft);
                }
                "struct_item" | "union_item" => {
                    self.push_rust_named(child, SymbolKind::Struct, attributes)
                }
                "enum_item" => self.push_rust_named(child, SymbolKind::Enum, attributes),
                "trait_item" => self.push_rust_named(child, SymbolKind::Trait, attributes),
                "type_item" => self.push_rust_named(child, SymbolKind::TypeAlias, attributes),
                "const_item" | "static_item" => {
                    self.push_rust_named(child, SymbolKind::Const, attributes)
                }
                "macro_definition" => self.push_rust_named(child, SymbolKind::Macro, attributes),
                "impl_item" => {
                    attributes.clear();
                    let target = child
                        .child_by_field_name("type")
                        .map(|node| self.text(node))
                        .unwrap_or_default();
                    if let Some(body) = child.child_by_field_name("body") {
                        self.visit_rust(body, Some(&target), &mut Vec::new());
                    }
                }
                "mod_item" => {
                    attributes.clear();
                    if let Some(body) = child.child_by_field_name("body") {
                        self.visit_rust(body, container, &mut Vec::new());
                    }
                }
                "use_declaration" => {
                    attributes.clear();
                    self.push_import_rust(child);
                }
                // A doc comment between an attribute and its item is legal;
                // clearing here would lose `#[tauri::command]`.
                "line_comment" | "block_comment" => {}
                _ => attributes.clear(),
            }
        }
    }

    fn push_rust_named(&mut self, node: Node<'a>, kind: SymbolKind, attributes: &mut Vec<String>) {
        let own = self.rust_own_attributes(node);
        let mut all = std::mem::take(attributes);
        all.extend(own);
        let draft = SymbolDraft {
            exported: self.is_rust_public(node),
            attributes: all,
            ..self.draft(node, kind)
        };
        self.push_symbol(draft);
    }

    /// Some grammar versions nest the attribute inside the item instead of
    /// before it; collecting both keeps `tauri::command` detection stable.
    fn rust_own_attributes(&self, node: Node<'a>) -> Vec<String> {
        self.children(node)
            .into_iter()
            .filter(|child| child.kind() == "attribute_item")
            .map(|child| self.rust_attribute_name(child))
            .collect()
    }

    fn rust_attribute_name(&self, node: Node<'a>) -> String {
        let inner = self
            .children(node)
            .into_iter()
            .find(|child| child.kind() == "attribute")
            .unwrap_or(node);
        self.text(inner).trim().to_string()
    }

    fn is_rust_public(&self, node: Node<'a>) -> bool {
        self.children(node)
            .into_iter()
            .any(|child| child.kind() == "visibility_modifier")
    }

    fn push_import_rust(&mut self, node: Node<'a>) {
        let module = self
            .text(node)
            .trim_start_matches("pub ")
            .trim_start_matches("use ")
            .trim_end_matches(';')
            .trim()
            .to_string();
        let mut names = Vec::new();
        identifier_leaves(node, self.source, &mut |name, _line, _start| {
            names.push(name.to_string());
        });
        self.import_ranges.push((node.start_byte(), node.end_byte()));
        self.imports.push(ImportRecord {
            module,
            names,
            line: node.start_position().row as u32 + 1,
        });
    }
}

/// Node kinds that may *contain* a top-level declaration. Anything else is a
/// statement, and walking into it would invent symbols for local bindings.
fn is_js_container(kind: &str) -> bool {
    matches!(
        kind,
        "program" | "statement_block" | "module" | "internal_module" | "ambient_declaration"
    )
}

/// The language the extractor should use for a path, if any.
pub fn extract_source(path: &str, source: &str) -> Option<FileSymbols> {
    let language = super::lang::language_of_path(path)?;
    extract_file(FileIdentity::transient(path), source, language)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(source: &str) -> FileSymbols {
        extract_source("src/a.ts", source).expect("extract")
    }

    fn rust(source: &str) -> FileSymbols {
        extract_source("src/a.rs", source).expect("extract")
    }

    fn find<'a>(file: &'a FileSymbols, name: &str) -> &'a SymbolRecord {
        file.symbols
            .iter()
            .find(|symbol| symbol.name == name)
            .unwrap_or_else(|| panic!("{name} not extracted from {:?}", names(file)))
    }

    fn names(file: &FileSymbols) -> Vec<&str> {
        file.symbols
            .iter()
            .map(|symbol| symbol.name.as_str())
            .collect()
    }

    #[test]
    fn typescript_functions_carry_name_kind_and_export() {
        let file = ts("export function alpha(x: number) { return x; }\nfunction beta() {}\n");
        assert!(file.parse_ok);
        let alpha = find(&file, "alpha");
        assert_eq!(alpha.kind, SymbolKind::Function);
        assert!(alpha.exported);
        assert_eq!(alpha.span.start_line, 1);
        assert!(alpha.body_span.is_some());
        assert!(!find(&file, "beta").exported);
    }

    #[test]
    fn exported_arrow_constants_are_functions_not_constants() {
        let file = ts("export const handler = (a: string) => a.trim();\nexport const LIMIT = 5;\n");
        assert_eq!(find(&file, "handler").kind, SymbolKind::Function);
        assert!(find(&file, "handler").exported);
        assert_eq!(find(&file, "LIMIT").kind, SymbolKind::Const);
    }

    #[test]
    fn class_methods_record_their_container() {
        let file = ts("export class Engine {\n  run(a: number) { return a; }\n}\n");
        let run = find(&file, "run");
        assert_eq!(run.kind, SymbolKind::Method);
        assert_eq!(run.container.as_deref(), Some("Engine"));
        assert_eq!(find(&file, "Engine").kind, SymbolKind::Class);
    }

    #[test]
    fn interfaces_type_aliases_and_imports_are_recorded() {
        let file = ts(
            "import { cn } from \"@/lib/utils\";\nexport interface Props { a: number }\nexport type Id = string;\n",
        );
        assert_eq!(find(&file, "Props").kind, SymbolKind::Interface);
        assert_eq!(find(&file, "Id").kind, SymbolKind::TypeAlias);
        assert_eq!(file.imports.len(), 1);
        assert_eq!(file.imports[0].module, "@/lib/utils");
        assert!(file.imports[0].names.iter().any(|name| name == "cn"));
    }

    #[test]
    fn tsx_components_and_their_jsx_references_are_extracted() {
        let file = extract_source(
            "src/App.tsx",
            "import { Row } from \"./Row\";\nexport function App() { return <Row value={1} />; }\n",
        )
        .expect("extract");
        assert!(file.parse_ok);
        assert!(find(&file, "App").exported);
        assert!(
            file.references.iter().any(|r| r.name == "Row"),
            "JSX element names must count as references"
        );
    }

    #[test]
    fn rust_visibility_and_sibling_attributes_are_attached() {
        let file = rust(
            "#[tauri::command]\npub async fn open_repo(path: String) -> Result<(), Error> { Ok(()) }\n\nfn helper() {}\n",
        );
        let command = find(&file, "open_repo");
        assert!(command.exported);
        assert!(
            command.has_attribute("tauri::command"),
            "attributes were {:?} — `#[tauri::command]` is a sibling attribute_item",
            command.attributes
        );
        let helper = find(&file, "helper");
        assert!(!helper.exported);
        assert!(
            helper.attributes.is_empty(),
            "an attribute must not leak onto the next item"
        );
    }

    #[test]
    fn rust_impl_methods_take_the_type_as_container() {
        let file = rust(
            "pub struct Engine;\nimpl Engine {\n  pub fn run(&self, n: u32) -> u32 { n + 1 }\n}\n",
        );
        assert_eq!(find(&file, "Engine").kind, SymbolKind::Struct);
        let run = find(&file, "run");
        assert_eq!(run.kind, SymbolKind::Method);
        assert_eq!(run.container.as_deref(), Some("Engine"));
        assert_eq!(run.qualified_name(), "Engine::run");
    }

    #[test]
    fn rust_items_inside_a_module_stay_visible() {
        let file = rust("mod inner {\n  pub fn nested() {}\n}\n");
        assert!(find(&file, "nested").exported);
    }

    #[test]
    fn references_exclude_the_definition_name_itself() {
        let file = ts("function alpha() { return beta(); }\n");
        assert!(file.references.iter().any(|r| r.name == "beta"));
        assert!(
            !file.references.iter().any(|r| r.name == "alpha"),
            "a definition is not a reference to itself"
        );
    }

    #[test]
    fn calls_list_the_identifiers_used_in_the_body() {
        let file = ts("function alpha(input) { return normalize(input) + LIMIT; }\n");
        let alpha = find(&file, "alpha");
        assert!(alpha.calls.iter().any(|name| name == "normalize"));
        assert!(alpha.calls.iter().any(|name| name == "LIMIT"));
    }

    #[test]
    fn broken_source_still_returns_a_record_but_marks_parse_failure() {
        let file = ts("function alpha( { return\n");
        assert!(!file.parse_ok);
    }

    #[test]
    fn signature_hash_ignores_body_edits_but_not_parameter_edits() {
        let before = ts("export function f(a: number) { return a; }");
        let body_changed = ts("export function f(a: number) { return a * 2; }");
        let signature_changed = ts("export function f(a: number, b: number) { return a; }");
        assert_eq!(
            find(&before, "f").signature_hash,
            find(&body_changed, "f").signature_hash
        );
        assert_ne!(
            find(&before, "f").signature_hash,
            find(&signature_changed, "f").signature_hash
        );
    }
}
