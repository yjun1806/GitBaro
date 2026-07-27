//! Manifest reading for V4.
//!
//! Two different questions are answered here:
//!
//! 1. *What does this repository declare?* — parse `package.json` / `Cargo.toml`
//!    as they exist on disk.
//! 2. *What did the diff newly declare?* — pull candidate keys out of added
//!    diff lines.
//!
//! The two are intersected by [`super`]: a key that a diff added **and** that
//! the on-disk manifest lists in a dependency section is a newly added
//! dependency. Doing it this way avoids having to reconstruct JSON/TOML nesting
//! from hunk fragments, which is where naive diff parsers get it wrong.

use std::collections::BTreeMap;

/// Package ecosystems V4 understands. Everything else is reported as
/// `UnsupportedLanguage` rather than guessed at (contract §0).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Ecosystem {
    Npm,
    Cargo,
}

impl Ecosystem {
    pub fn label(self) -> &'static str {
        match self {
            Ecosystem::Npm => "npm",
            Ecosystem::Cargo => "cargo",
        }
    }
}

/// One dependency a manifest on disk declares.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeclaredDep {
    /// `dependencies`, `devDependencies`, `dev-dependencies`, …
    pub section: String,
    /// The name to look for in the lockfile. Differs from the manifest key for
    /// npm aliases (`"a": "npm:b@^1"`) and Cargo renames (`a = { package = "b" }`).
    pub resolve_name: String,
    /// Local/protocol dependency (`workspace:`, `file:`, `link:`, a Cargo
    /// `path` dep). A lockfile miss proves nothing about these, so they are
    /// never flagged.
    pub is_local: bool,
}

/// npm sections whose *new* entries count as "a dependency was added".
pub const TRACKED_NPM_SECTIONS: [&str; 3] =
    ["dependencies", "devDependencies", "peerDependencies"];

/// Cargo sections whose *new* entries count as "a dependency was added".
pub const TRACKED_CARGO_SECTIONS: [&str; 2] = ["dependencies", "dev-dependencies"];

const NPM_SECTIONS: [&str; 4] = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
];

const CARGO_DEP_SECTIONS: [&str; 3] = ["dependencies", "dev-dependencies", "build-dependencies"];

/// Parse a `package.json`. `None` means the file is not valid JSON — the caller
/// must record `ScanLimit{ParseFailed}` rather than invent findings.
pub fn npm_declared(content: &str) -> Option<BTreeMap<String, DeclaredDep>> {
    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    let object = value.as_object()?;
    let mut out = BTreeMap::new();

    for section in NPM_SECTIONS {
        let Some(entries) = object.get(section).and_then(|v| v.as_object()) else {
            continue;
        };
        for (name, spec) in entries {
            let spec = spec.as_str().unwrap_or_default();
            let (resolve_name, is_local) = npm_spec_facts(name, spec);
            out.insert(
                name.clone(),
                DeclaredDep {
                    section: section.to_string(),
                    resolve_name,
                    is_local,
                },
            );
        }
    }

    Some(out)
}

/// Resolve an npm version spec to (lockfile name, is-local).
fn npm_spec_facts(name: &str, spec: &str) -> (String, bool) {
    let spec = spec.trim();
    if let Some(target) = spec.strip_prefix("npm:") {
        return (strip_version_suffix(target), false);
    }
    let is_local = ["workspace:", "file:", "link:", "portal:", "catalog:"]
        .iter()
        .any(|p| spec.starts_with(p))
        || spec.contains("://")
        || spec.starts_with("git+")
        || spec.starts_with("github:");
    (name.to_string(), is_local)
}

/// `@scope/pkg@^1.0.0` → `@scope/pkg`; `pkg@1` → `pkg`.
fn strip_version_suffix(spec: &str) -> String {
    match spec.rfind('@') {
        Some(index) if index > 0 => spec[..index].to_string(),
        _ => spec.to_string(),
    }
}

/// Line-scan a `Cargo.toml`. No TOML parser is pulled in (contract §5): the
/// only shapes that matter are section headers and `key = value` lines.
///
/// A malformed file degrades to fewer detected dependencies, never to a wrong
/// one — the caller's fallback is "no finding", which is the safe direction.
pub fn cargo_declared(content: &str) -> BTreeMap<String, DeclaredDep> {
    let mut out = BTreeMap::new();
    let mut section: Option<String> = None;

    for raw in content.lines() {
        let line = raw.trim();
        if line.starts_with('[') {
            section = classify_cargo_header(line, &mut out);
            continue;
        }
        let Some(current) = section.as_ref() else {
            continue;
        };
        let Some((key, value)) = split_toml_assignment(line) else {
            continue;
        };
        let resolve_name = quoted_value_after(&value, "package").unwrap_or_else(|| key.clone());
        let is_local = quoted_value_after(&value, "path").is_some();
        out.insert(
            key,
            DeclaredDep {
                section: current.clone(),
                resolve_name,
                is_local,
            },
        );
    }

    out
}

/// Returns the dependency section a header opens, or `None` if the header
/// starts a table that is not a flat dependency list. `[dependencies.serde]`
/// declares `serde` directly and opens a non-list table, so it inserts and
/// returns `None`.
fn classify_cargo_header(
    line: &str,
    out: &mut BTreeMap<String, DeclaredDep>,
) -> Option<String> {
    let inner = line
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim();
    let segments: Vec<&str> = inner
        .split('.')
        .map(|s| s.trim().trim_matches('"').trim_matches('\''))
        .collect();
    let index = segments
        .iter()
        .position(|s| CARGO_DEP_SECTIONS.contains(s))?;
    let section = segments[index].to_string();

    match segments.get(index + 1) {
        Some(name) if !name.is_empty() => {
            out.insert(
                (*name).to_string(),
                DeclaredDep {
                    section,
                    resolve_name: (*name).to_string(),
                    is_local: false,
                },
            );
            None
        }
        _ => Some(section),
    }
}

/// `serde = { version = "1" }` → `("serde", "{ version = \"1\" }")`.
pub fn split_toml_assignment(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.starts_with('#') || line.starts_with('[') {
        return None;
    }
    let eq = line.find('=')?;
    let key = line[..eq]
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    if key.is_empty() || !key.chars().all(is_toml_key_char) {
        return None;
    }
    let value = line[eq + 1..].trim().to_string();
    if value.is_empty() {
        return None;
    }
    Some((key, value))
}

fn is_toml_key_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+')
}

/// Find `key = "value"` inside an inline table and return the value.
fn quoted_value_after(value: &str, key: &str) -> Option<String> {
    let mut rest = value;
    while let Some(index) = rest.find(key) {
        let before_ok = index == 0
            || !rest[..index]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-');
        let after = rest[index + key.len()..].trim_start();
        if before_ok {
            if let Some(tail) = after.strip_prefix('=') {
                let tail = tail.trim_start();
                let quote = tail.chars().next()?;
                if quote == '"' || quote == '\'' {
                    let body = &tail[quote.len_utf8()..];
                    let end = body.find(quote)?;
                    return Some(body[..end].to_string());
                }
            }
        }
        rest = &rest[index + key.len()..];
    }
    None
}

/// Key of a JSON object member line: `  "react": "^19.0.0",` → `react`.
pub fn json_key_of_line(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix('"')?;
    let end = rest.find('"')?;
    let key = &rest[..end];
    if key.is_empty() || key.contains('\\') {
        return None;
    }
    if !rest[end + 1..].trim_start().starts_with(':') {
        return None;
    }
    Some(key.to_string())
}

/// Key of a TOML assignment line: `serde = "1"` → `serde`.
pub fn toml_key_of_line(line: &str) -> Option<String> {
    split_toml_assignment(line).map(|(key, _)| key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npm_declared_reads_every_dependency_section() {
        let manifest = r#"{
            "name": "app",
            "dependencies": { "react": "^19.0.0" },
            "devDependencies": { "vitest": "^2.0.0" },
            "peerDependencies": { "typescript": "^5" },
            "optionalDependencies": { "fsevents": "^2" }
        }"#;
        let deps = npm_declared(manifest).expect("valid json");
        assert_eq!(deps["react"].section, "dependencies");
        assert_eq!(deps["vitest"].section, "devDependencies");
        assert_eq!(deps["typescript"].section, "peerDependencies");
        assert_eq!(deps["fsevents"].section, "optionalDependencies");
    }

    #[test]
    fn npm_declared_resolves_aliases_and_local_protocols() {
        let manifest = r#"{
            "dependencies": {
                "left-pad": "npm:@scoped/left-pad@^1.0.0",
                "ui": "workspace:*",
                "local": "file:../local"
            }
        }"#;
        let deps = npm_declared(manifest).expect("valid json");
        assert_eq!(deps["left-pad"].resolve_name, "@scoped/left-pad");
        assert!(!deps["left-pad"].is_local);
        assert!(deps["ui"].is_local);
        assert!(deps["local"].is_local);
    }

    #[test]
    fn npm_declared_returns_none_for_invalid_json() {
        assert!(npm_declared("{ not json").is_none());
    }

    #[test]
    fn cargo_declared_handles_plain_target_and_workspace_sections() {
        let manifest = r#"
[package]
name = "gitbaro"
version = "0.1.0"

[dependencies]
serde = { version = "1", features = ["derive"] }
git2 = "0.19"

[dev-dependencies]
pretty_assertions = "1"

[target.'cfg(unix)'.dependencies]
nix = "0.29"

[workspace.dependencies]
shared = "2"
"#;
        let deps = cargo_declared(manifest);
        assert_eq!(deps["serde"].section, "dependencies");
        assert_eq!(deps["git2"].section, "dependencies");
        assert_eq!(deps["pretty_assertions"].section, "dev-dependencies");
        assert_eq!(deps["nix"].section, "dependencies");
        assert_eq!(deps["shared"].section, "dependencies");
        // `[package]` keys must never be mistaken for dependencies.
        assert!(!deps.contains_key("name"));
        assert!(!deps.contains_key("version"));
    }

    #[test]
    fn cargo_declared_handles_renames_and_path_deps() {
        let manifest = r#"
[dependencies]
myserde = { package = "serde", version = "1" }
local = { path = "../local" }

[dependencies.tokio]
version = "1"
features = ["full"]
"#;
        let deps = cargo_declared(manifest);
        assert_eq!(deps["myserde"].resolve_name, "serde");
        assert!(deps["local"].is_local);
        assert_eq!(deps["tokio"].section, "dependencies");
        // The body of `[dependencies.tokio]` is config, not more dependencies.
        assert!(!deps.contains_key("features"));
        assert!(!deps.contains_key("version"));
    }

    #[test]
    fn json_key_of_line_accepts_members_and_rejects_values() {
        assert_eq!(json_key_of_line("  \"react\": \"^19\","), Some("react".into()));
        assert_eq!(
            json_key_of_line("    \"@scope/pkg\": \"1.0.0\""),
            Some("@scope/pkg".into())
        );
        assert_eq!(json_key_of_line("  \"just-a-string\","), None);
        assert_eq!(json_key_of_line("  {"), None);
    }

    #[test]
    fn toml_key_of_line_ignores_headers_and_comments() {
        assert_eq!(toml_key_of_line("serde = \"1\""), Some("serde".into()));
        assert_eq!(toml_key_of_line("# serde = \"1\""), None);
        assert_eq!(toml_key_of_line("[dependencies]"), None);
        assert_eq!(toml_key_of_line("no-equals-here"), None);
    }

    #[test]
    fn quoted_value_after_ignores_similarly_named_keys() {
        let value = r#"{ subpackage = "wrong", package = "right" }"#;
        assert_eq!(quoted_value_after(value, "package"), Some("right".into()));
        assert_eq!(quoted_value_after(r#"{ version = "1" }"#, "package"), None);
    }
}
