//! Extract bare package specifiers from newly added source lines, and the
//! resolution facts needed to *not* flag things that are not packages
//! (node builtins, `tsconfig` path aliases, `baseUrl`-relative modules).
//!
//! Line-oriented on purpose: an import split across lines still puts
//! `from "pkg"` on one line, and the alternative (a real parser) is V1's job,
//! not V4's. Missing an import costs a finding; inventing one costs the user's
//! trust in every badge (spec §7-②).

use std::path::{Path, PathBuf};

use super::jsonc::strip_jsonc;

const JS_EXTENSIONS: [&str; 8] = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];

/// Checked against the *first* path segment, so `fs/promises` resolves via `fs`.
const NODE_BUILTINS: [&str; 42] = [
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "sea",
    "stream",
    "string_decoder",
    "sys",
    "test",
    "timers",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "worker_threads",
];

/// A bare specifier a diff newly introduced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportRef {
    /// Repo-relative path of the importing file.
    pub file: String,
    pub line: u32,
    /// The literal as written, e.g. `@scope/pkg/sub`.
    pub specifier: String,
    /// Package root of the specifier, e.g. `@scope/pkg`.
    pub package: String,
}

pub fn is_js_extension(extension: &str) -> bool {
    JS_EXTENSIONS.contains(&extension)
}

/// Module specifiers appearing on one JS/TS line.
pub fn js_specifiers(line: &str) -> Vec<String> {
    let line = line.trim();
    if line.starts_with("//") || line.starts_with('*') || line.starts_with("/*") {
        return Vec::new();
    }

    let mut out = Vec::new();
    let bytes = line.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        let quote = bytes[index];
        if quote != b'"' && quote != b'\'' {
            index += 1;
            continue;
        }
        let Some(offset) = line[index + 1..].find(quote as char) else {
            break;
        };
        let end = index + 1 + offset;
        if is_specifier_position(&line[..index]) {
            out.push(line[index + 1..end].to_string());
        }
        index = end + 1;
    }

    out
}

/// Is the text preceding a string literal one of the module-loading forms?
fn is_specifier_position(before: &str) -> bool {
    let before = before.trim_end();
    if ends_with_keyword(before, "from") || ends_with_keyword(before, "import") {
        return true;
    }
    if let Some(head) = before.strip_suffix('(') {
        let head = head.trim_end();
        return ends_with_keyword(head, "require") || ends_with_keyword(head, "import");
    }
    false
}

fn ends_with_keyword(text: &str, keyword: &str) -> bool {
    let Some(head) = text.strip_suffix(keyword) else {
        return false;
    };
    head.chars()
        .next_back()
        .is_none_or(|c| !(c.is_alphanumeric() || matches!(c, '_' | '$' | '.')))
}

/// Package root of a specifier, or `None` when it is not a bare package
/// reference (relative, absolute, URL, `node:`, `#` subpath import).
pub fn npm_package_of_specifier(specifier: &str) -> Option<String> {
    let specifier = specifier.trim();
    if specifier.is_empty()
        || specifier.starts_with('.')
        || specifier.starts_with('/')
        || specifier.starts_with('#')
        || specifier.starts_with('~')
        || specifier.starts_with("node:")
        || specifier.contains("://")
    {
        return None;
    }

    let mut segments = specifier.split('/');
    let first = segments.next()?;
    let package = if let Some(scope) = first.strip_prefix('@') {
        let name = segments.next()?;
        if scope.is_empty() || name.is_empty() {
            return None;
        }
        format!("{}/{}", first, name)
    } else {
        first.to_string()
    };

    if is_valid_npm_name(&package) {
        Some(package)
    } else {
        None
    }
}

fn is_valid_npm_name(name: &str) -> bool {
    let body = name.strip_prefix('@').unwrap_or(name);
    !body.is_empty()
        && !body.starts_with('.')
        && !body.starts_with('_')
        && body
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
}

pub fn is_node_builtin(package: &str) -> bool {
    let root = package.split('/').next().unwrap_or(package);
    NODE_BUILTINS.contains(&root)
}

/// Crate referenced by a `use` / `extern crate` line, or `None`.
pub fn rust_crate_of_line(line: &str) -> Option<String> {
    let mut line = line.trim();
    if line.starts_with("//") || line.starts_with('#') {
        return None;
    }
    for visibility in ["pub(crate) ", "pub(super) ", "pub(in ", "pub "] {
        if let Some(rest) = line.strip_prefix(visibility) {
            line = rest.trim_start();
            break;
        }
    }

    let rest = if let Some(rest) = line.strip_prefix("extern crate ") {
        rest
    } else if let Some(rest) = line.strip_prefix("use ") {
        rest
    } else {
        return None;
    };
    let rest = rest.trim_start().trim_start_matches("::");

    let end = rest
        .char_indices()
        .find(|(_, c)| !(c.is_alphanumeric() || *c == '_'))
        .map_or(rest.len(), |(index, _)| index);
    let root = &rest[..end];

    if root.is_empty() || matches!(root, "crate" | "self" | "super" | "std" | "core" | "alloc") {
        return None;
    }
    Some(root.to_string())
}

/// `compilerOptions.paths` keys and `baseUrl` roots collected from the
/// `tsconfig.json` files that apply to a file.
#[derive(Clone, Debug, Default)]
pub struct TsResolution {
    exact_aliases: Vec<String>,
    prefix_aliases: Vec<String>,
    base_urls: Vec<PathBuf>,
    /// A `tsconfig.json` existed but could not be read as JSONC.
    pub parse_failed: bool,
}

impl TsResolution {
    /// Does a `paths` entry claim this specifier?
    pub fn matches_alias(&self, specifier: &str) -> bool {
        self.exact_aliases.iter().any(|a| a == specifier)
            || self
                .prefix_aliases
                .iter()
                .any(|prefix| specifier.starts_with(prefix.as_str()))
    }

    /// Does the specifier resolve to a real file under a configured `baseUrl`?
    /// This is the other half of the alias story — with `baseUrl` set, plain
    /// `components/Button` is a local module, not a package.
    pub fn resolves_under_base_url(&self, specifier: &str) -> bool {
        self.base_urls
            .iter()
            .any(|base| module_exists(&base.join(specifier)))
    }
}

fn module_exists(candidate: &Path) -> bool {
    if candidate.is_dir() {
        return true;
    }
    if candidate.is_file() {
        return true;
    }
    JS_EXTENSIONS.iter().any(|extension| {
        candidate
            .with_extension(extension)
            .is_file()
    })
}

/// Fold `(tsconfig directory, file contents)` pairs into one resolution view.
pub fn parse_ts_resolution(configs: &[(PathBuf, String)]) -> TsResolution {
    let mut resolution = TsResolution::default();

    for (directory, content) in configs {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&strip_jsonc(content)) else {
            resolution.parse_failed = true;
            continue;
        };
        let Some(options) = value.get("compilerOptions") else {
            continue;
        };
        if let Some(base) = options.get("baseUrl").and_then(|b| b.as_str()) {
            resolution.base_urls.push(directory.join(base));
        }
        let Some(paths) = options.get("paths").and_then(|p| p.as_object()) else {
            continue;
        };
        for key in paths.keys() {
            match key.strip_suffix('*') {
                Some(prefix) if !prefix.is_empty() => {
                    resolution.prefix_aliases.push(prefix.to_string())
                }
                _ => resolution.exact_aliases.push(key.clone()),
            }
        }
    }

    resolution
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_specifiers_cover_every_import_form() {
        assert_eq!(js_specifiers("import React from \"react\";"), ["react"]);
        assert_eq!(js_specifiers("import 'side-effect';"), ["side-effect"]);
        assert_eq!(
            js_specifiers("export { a } from '@scope/pkg';"),
            ["@scope/pkg"]
        );
        assert_eq!(js_specifiers("const x = require(\"lodash\");"), ["lodash"]);
        assert_eq!(js_specifiers("const y = await import('chalk');"), ["chalk"]);
        assert_eq!(
            js_specifiers("import type { A } from \"zod\";"),
            ["zod"]
        );
    }

    #[test]
    fn js_specifiers_ignore_non_module_strings() {
        assert!(js_specifiers("const label = \"react\";").is_empty());
        assert!(js_specifiers("// import x from \"react\"").is_empty());
        assert!(js_specifiers("foo.import(\"react\")").is_empty());
        assert!(js_specifiers("t(\"error.failed\")").is_empty());
    }

    #[test]
    fn bare_specifiers_are_distinguished_from_paths() {
        assert_eq!(npm_package_of_specifier("react"), Some("react".into()));
        assert_eq!(
            npm_package_of_specifier("@scope/pkg/sub/path"),
            Some("@scope/pkg".into())
        );
        assert_eq!(npm_package_of_specifier("./local"), None);
        assert_eq!(npm_package_of_specifier("../../local"), None);
        assert_eq!(npm_package_of_specifier("/abs"), None);
        assert_eq!(npm_package_of_specifier("#internal"), None);
        assert_eq!(npm_package_of_specifier("node:fs"), None);
        assert_eq!(npm_package_of_specifier("https://esm.sh/react"), None);
    }

    #[test]
    fn node_builtins_are_recognized_with_and_without_subpaths() {
        assert!(is_node_builtin("fs"));
        assert!(is_node_builtin("fs/promises"));
        assert!(is_node_builtin("path"));
        assert!(!is_node_builtin("react"));
        assert!(!is_node_builtin("react-codeshift"));
    }

    #[test]
    fn rust_use_lines_yield_external_crate_roots() {
        assert_eq!(rust_crate_of_line("use serde::Serialize;"), Some("serde".into()));
        assert_eq!(
            rust_crate_of_line("pub use tokio::task::spawn_blocking;"),
            Some("tokio".into())
        );
        assert_eq!(
            rust_crate_of_line("pub(crate) use git2::Repository;"),
            Some("git2".into())
        );
        assert_eq!(rust_crate_of_line("extern crate libc;"), Some("libc".into()));
        assert_eq!(rust_crate_of_line("use ::anyhow::Result;"), Some("anyhow".into()));
    }

    #[test]
    fn rust_internal_and_std_paths_are_not_crates() {
        assert_eq!(rust_crate_of_line("use crate::error::AppError;"), None);
        assert_eq!(rust_crate_of_line("use super::manifest;"), None);
        assert_eq!(rust_crate_of_line("use self::inner;"), None);
        assert_eq!(rust_crate_of_line("use std::path::Path;"), None);
        assert_eq!(rust_crate_of_line("use core::fmt;"), None);
        assert_eq!(rust_crate_of_line("// use serde::Serialize;"), None);
        assert_eq!(rust_crate_of_line("let x = 1;"), None);
    }

    #[test]
    fn ts_paths_aliases_match_exact_and_wildcard_keys() {
        let config = r#"{
            // project config
            "compilerOptions": {
                "baseUrl": ".",
                "paths": {
                    "@/*": ["./src/*"],
                    "shared": ["./shared/index.ts"],
                },
            }
        }"#;
        let resolution =
            parse_ts_resolution(&[(PathBuf::from("/repo"), config.to_string())]);
        assert!(!resolution.parse_failed);
        assert!(resolution.matches_alias("@/lib/utils"));
        assert!(resolution.matches_alias("shared"));
        assert!(!resolution.matches_alias("react"));
        assert_eq!(resolution.base_urls, vec![PathBuf::from("/repo/.")]);
    }

    #[test]
    fn unreadable_tsconfig_sets_parse_failed_rather_than_guessing() {
        let resolution =
            parse_ts_resolution(&[(PathBuf::from("/repo"), "{ broken".to_string())]);
        assert!(resolution.parse_failed);
        assert!(!resolution.matches_alias("@/lib/utils"));
        assert!(!resolution.resolves_under_base_url("lib/utils"));
    }
}
