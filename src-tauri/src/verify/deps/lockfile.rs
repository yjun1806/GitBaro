//! Lockfile indexes for V4.
//!
//! The offline cross-check asks a lockfile exactly one question: *does it
//! mention this package?* That framing matters — it lets us skip writing a YAML
//! parser (contract §5 forbids new crates) and stay robust across the five
//! incompatible lockfile layouts npm/pnpm/yarn have shipped.
//!
//! JSON and `Cargo.lock` are parsed exactly. `pnpm-lock.yaml` and `yarn.lock`
//! are probed as text with boundary checks. Probing can only ever produce a
//! *false "present"*, which suppresses a finding — the safe direction, per the
//! contract's "미검사 > 오탐" rule.

use std::collections::BTreeSet;

use serde_json::Value;

/// Searched in this order; every one found contributes to the index.
pub const NPM_LOCKFILES: [&str; 3] = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];
pub const CARGO_LOCKFILE: &str = "Cargo.lock";

/// Guard against pathological `package-lock.json` v1 nesting.
const MAX_JSON_DEPTH: u32 = 32;

pub enum NameIndex {
    /// Exact package-name set, from a structured parse.
    Exact(BTreeSet<String>),
    /// Raw lockfile text, matched with boundary checks.
    Text(String),
}

impl NameIndex {
    pub fn contains(&self, name: &str) -> bool {
        match self {
            NameIndex::Exact(names) => names.contains(name),
            NameIndex::Text(text) => text_mentions_name(text, name),
        }
    }
}

/// Build an index for one npm lockfile. `None` means the file exists but could
/// not be understood — the caller records `ScanLimit{ParseFailed}`.
pub fn npm_lock_index(file_name: &str, content: String) -> Option<NameIndex> {
    match file_name {
        "package-lock.json" => npm_json_names(&content).map(NameIndex::Exact),
        "pnpm-lock.yaml" | "yarn.lock" => Some(NameIndex::Text(content)),
        _ => None,
    }
}

/// `Cargo.lock` is a flat list of `[[package]]` tables; every `name = "..."`
/// line in the file is a package name.
pub fn cargo_lock_index(content: &str) -> NameIndex {
    let mut names = BTreeSet::new();
    for line in content.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("name") else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(body) = rest.strip_prefix('"') else {
            continue;
        };
        let Some(end) = body.find('"') else {
            continue;
        };
        if end > 0 {
            names.insert(normalize_crate(&body[..end]));
        }
    }
    NameIndex::Exact(names)
}

/// Cargo treats `-` and `_` as interchangeable between the manifest name and
/// the Rust identifier (`tauri-plugin-shell` is used as `tauri_plugin_shell`).
pub fn normalize_crate(name: &str) -> String {
    name.replace('-', "_")
}

fn npm_json_names(content: &str) -> Option<BTreeSet<String>> {
    let value: Value = serde_json::from_str(content).ok()?;
    let mut names = BTreeSet::new();

    // lockfileVersion 2/3: `packages` keyed by install path.
    if let Some(packages) = value.get("packages").and_then(|p| p.as_object()) {
        for (key, entry) in packages {
            if let Some(index) = key.rfind("node_modules/") {
                let name = &key[index + "node_modules/".len()..];
                if !name.is_empty() {
                    names.insert(name.to_string());
                }
            }
            if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                names.insert(name.to_string());
            }
        }
    }

    // lockfileVersion 1: nested `dependencies` trees.
    collect_v1_dependencies(value.get("dependencies"), &mut names, 0);

    Some(names)
}

fn collect_v1_dependencies(node: Option<&Value>, names: &mut BTreeSet<String>, depth: u32) {
    if depth >= MAX_JSON_DEPTH {
        return;
    }
    let Some(entries) = node.and_then(|n| n.as_object()) else {
        return;
    };
    for (name, entry) in entries {
        names.insert(name.clone());
        collect_v1_dependencies(entry.get("dependencies"), names, depth + 1);
    }
}

/// Does `text` mention `name` as a package name rather than as a substring of
/// some longer name?
///
/// Lockfile keys look like `/react@18.0.0:`, `'@scope/pkg@1.0.0':`,
/// `react@^18.0.0, react@^18.2.0:` — so a name is bounded by a quote, comma,
/// whitespace, `(`, or (for unscoped names) a `/` that itself follows a
/// boundary. The trailing `/` rule is what stops `pkg` from matching inside
/// `@scope/pkg`.
fn text_mentions_name(text: &str, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let scoped = name.starts_with('@');
    for (index, _) in text.match_indices(name) {
        if boundary_before(text, index, scoped) && boundary_after(text, index + name.len()) {
            return true;
        }
    }
    false
}

fn boundary_before(text: &str, index: usize, scoped: bool) -> bool {
    if index == 0 {
        return true;
    }
    let Some(previous) = text[..index].chars().next_back() else {
        return true;
    };
    if is_boundary_char(previous) {
        return true;
    }
    if previous == '/' && !scoped {
        // `/react@…` is a pnpm v6 key; `@scope/react@…` is a different package.
        let head = &text[..index - previous.len_utf8()];
        return head.chars().next_back().is_none_or(is_boundary_char);
    }
    false
}

fn boundary_after(text: &str, index: usize) -> bool {
    match text[index..].chars().next() {
        None => true,
        Some(c) => matches!(c, '@' | ':' | '/') || is_boundary_char(c),
    }
}

fn is_boundary_char(c: char) -> bool {
    matches!(c, '"' | '\'' | ' ' | '\t' | '\n' | '\r' | ',' | '(')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_lock_v3_names_come_from_install_paths() {
        let lock = r#"{
            "lockfileVersion": 3,
            "packages": {
                "": { "name": "app" },
                "node_modules/react": { "version": "19.0.0" },
                "node_modules/@scope/pkg": { "version": "1.0.0" },
                "node_modules/a/node_modules/b": { "version": "2.0.0" }
            }
        }"#;
        let index = npm_lock_index("package-lock.json", lock.to_string()).expect("parsed");
        assert!(index.contains("react"));
        assert!(index.contains("@scope/pkg"));
        assert!(index.contains("b"));
        assert!(!index.contains("react-codeshift"));
    }

    #[test]
    fn package_lock_v1_names_come_from_nested_dependencies() {
        let lock = r#"{
            "lockfileVersion": 1,
            "dependencies": {
                "react": { "version": "18.0.0", "dependencies": { "loose-envify": {} } }
            }
        }"#;
        let index = npm_lock_index("package-lock.json", lock.to_string()).expect("parsed");
        assert!(index.contains("react"));
        assert!(index.contains("loose-envify"));
    }

    #[test]
    fn invalid_package_lock_json_yields_none() {
        assert!(npm_lock_index("package-lock.json", "{ broken".to_string()).is_none());
    }

    #[test]
    fn pnpm_lock_text_probe_matches_v6_and_v9_keys() {
        let lock = "\
lockfileVersion: '9.0'

packages:

  react@19.0.0:
    resolution: {integrity: sha512-aaa}

  '@scope/pkg@1.0.0':
    resolution: {integrity: sha512-bbb}

  /legacy-style@2.0.0:
    resolution: {integrity: sha512-ccc}
";
        let index = npm_lock_index("pnpm-lock.yaml", lock.to_string()).expect("text index");
        assert!(index.contains("react"));
        assert!(index.contains("@scope/pkg"));
        assert!(index.contains("legacy-style"));
        assert!(!index.contains("react-codeshift"));
    }

    #[test]
    fn text_probe_does_not_match_a_scoped_package_as_unscoped() {
        let lock = "packages:\n  '@scope/pkg@1.0.0':\n    resolution: {}\n";
        let index = npm_lock_index("pnpm-lock.yaml", lock.to_string()).expect("text index");
        assert!(index.contains("@scope/pkg"));
        assert!(!index.contains("pkg"));
    }

    #[test]
    fn yarn_classic_and_berry_keys_are_matched() {
        let lock = "\
react@^18.0.0, react@^18.2.0:
  version \"18.2.0\"

\"@scope/pkg@npm:^1.0.0\":
  version: 1.0.0
";
        let index = npm_lock_index("yarn.lock", lock.to_string()).expect("text index");
        assert!(index.contains("react"));
        assert!(index.contains("@scope/pkg"));
        assert!(!index.contains("preact"));
    }

    #[test]
    fn cargo_lock_names_are_normalized() {
        let lock = r#"
[[package]]
name = "tauri-plugin-shell"
version = "2.0.0"

[[package]]
name = "serde"
version = "1.0.0"
"#;
        let index = cargo_lock_index(lock);
        assert!(index.contains(&normalize_crate("tauri_plugin_shell")));
        assert!(index.contains(&normalize_crate("tauri-plugin-shell")));
        assert!(index.contains("serde"));
        assert!(!index.contains("serde_hallucinated"));
    }
}
