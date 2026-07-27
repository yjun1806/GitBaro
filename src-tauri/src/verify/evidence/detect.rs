//! Test-command detection (V11).
//!
//! GitBaro must never *guess and run*. Detection only proposes a string; the UI
//! shows it and the user confirms or overrides it, and only that confirmed
//! string is ever executed. Nothing agent-generated (session logs, commit
//! messages, diffs) may reach [`super::run_and_record`].
//!
//! Probe order — first hit wins:
//!
//! 1. `package.json` with a `scripts.test` entry -> package-manager-specific
//!    invocation, chosen from the `packageManager` field, else the lockfile.
//! 2. `Cargo.toml` -> `cargo test`
//! 3. a pytest marker (`pytest.ini`, `conftest.py`, `[tool.pytest` in
//!    `pyproject.toml`, `[tool:pytest]` in `setup.cfg`) -> `pytest`
//!
//! Only the repository root is probed. A nested manifest (`src-tauri/Cargo.toml`)
//! is deliberately not searched: a wrong guess that runs a 10-minute process is
//! worse than no guess.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl PackageManager {
    /// `bun test` runs bun's own runner instead of the `test` script, so bun
    /// gets the explicit `run` form.
    fn test_command(self) -> &'static str {
        match self {
            PackageManager::Npm => "npm test",
            PackageManager::Pnpm => "pnpm test",
            PackageManager::Yarn => "yarn test",
            PackageManager::Bun => "bun run test",
        }
    }
}

/// Only the two fields we need; everything else in `package.json` is ignored.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageJson {
    #[serde(default)]
    scripts: BTreeMap<String, String>,
    #[serde(default)]
    package_manager: Option<String>,
}

/// The command an explicit override selects, or the detected one when there is
/// no override. `None` means "we could not tell" — the UI must then ask.
pub fn resolve_test_command(repo_path: &Path, override_command: Option<&str>) -> Option<String> {
    match override_command.map(str::trim).filter(|c| !c.is_empty()) {
        Some(explicit) => Some(explicit.to_string()),
        None => detect_test_command(repo_path),
    }
}

/// Infers a test command from the manifests at the repository root.
pub fn detect_test_command(repo_path: &Path) -> Option<String> {
    if let Some(command) = detect_node(repo_path) {
        return Some(command);
    }
    if repo_path.join("Cargo.toml").is_file() {
        return Some("cargo test".to_string());
    }
    if has_pytest(repo_path) {
        return Some("pytest".to_string());
    }
    None
}

fn detect_node(root: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(root.join("package.json")).ok()?;
    let manifest: PackageJson = serde_json::from_str(&raw).ok()?;
    if !manifest.scripts.contains_key("test") {
        return None;
    }
    let manager = manifest
        .package_manager
        .as_deref()
        .and_then(parse_package_manager_field)
        .or_else(|| package_manager_from_lockfile(root))
        .unwrap_or(PackageManager::Npm);
    Some(manager.test_command().to_string())
}

/// `"pnpm@9.1.0+sha512.abc"` -> `Pnpm`. An unknown name yields `None` so the
/// lockfile probe can still decide.
fn parse_package_manager_field(field: &str) -> Option<PackageManager> {
    let name = field.trim().split('@').next().unwrap_or("").trim();
    match name {
        "npm" => Some(PackageManager::Npm),
        "pnpm" => Some(PackageManager::Pnpm),
        "yarn" => Some(PackageManager::Yarn),
        "bun" => Some(PackageManager::Bun),
        _ => None,
    }
}

fn package_manager_from_lockfile(root: &Path) -> Option<PackageManager> {
    if root.join("pnpm-lock.yaml").is_file() {
        return Some(PackageManager::Pnpm);
    }
    if root.join("yarn.lock").is_file() {
        return Some(PackageManager::Yarn);
    }
    if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
        return Some(PackageManager::Bun);
    }
    if root.join("package-lock.json").is_file() {
        return Some(PackageManager::Npm);
    }
    None
}

fn has_pytest(root: &Path) -> bool {
    if root.join("pytest.ini").is_file() || root.join("conftest.py").is_file() {
        return true;
    }
    file_contains(&root.join("pyproject.toml"), "[tool.pytest")
        || file_contains(&root.join("setup.cfg"), "[tool:pytest]")
}

fn file_contains(path: &Path, needle: &str) -> bool {
    std::fs::read_to_string(path)
        .map(|text| text.contains(needle))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::testutil::TempDir;

    const WITH_TEST_SCRIPT: &str = r#"{ "name": "x", "scripts": { "test": "vitest run" } }"#;

    #[test]
    fn package_manager_field_wins_over_the_lockfile() {
        let dir = TempDir::new("detect-pm-field");
        dir.write(
            "package.json",
            r#"{ "scripts": { "test": "vitest run" }, "packageManager": "pnpm@9.1.0+sha512.ab" }"#,
        );
        dir.write("package-lock.json", "{}");
        assert_eq!(
            detect_test_command(dir.path()),
            Some("pnpm test".to_string())
        );
    }

    #[test]
    fn falls_back_to_the_lockfile_then_to_npm() {
        let with_lock = TempDir::new("detect-lock");
        with_lock.write("package.json", WITH_TEST_SCRIPT);
        with_lock.write("yarn.lock", "");
        assert_eq!(
            detect_test_command(with_lock.path()),
            Some("yarn test".to_string())
        );

        let bare = TempDir::new("detect-bare");
        bare.write("package.json", WITH_TEST_SCRIPT);
        assert_eq!(detect_test_command(bare.path()), Some("npm test".to_string()));
    }

    #[test]
    fn bun_uses_the_explicit_run_form() {
        let dir = TempDir::new("detect-bun");
        dir.write("package.json", WITH_TEST_SCRIPT);
        dir.write("bun.lockb", "");
        assert_eq!(
            detect_test_command(dir.path()),
            Some("bun run test".to_string())
        );
    }

    #[test]
    fn package_json_without_a_test_script_falls_through_to_cargo() {
        let dir = TempDir::new("detect-cargo");
        dir.write("package.json", r#"{ "scripts": { "build": "vite build" } }"#);
        dir.write("Cargo.toml", "[package]\nname = \"x\"\n");
        assert_eq!(
            detect_test_command(dir.path()),
            Some("cargo test".to_string())
        );
    }

    #[test]
    fn malformed_package_json_does_not_abort_detection() {
        let dir = TempDir::new("detect-broken-json");
        dir.write("package.json", "{ this is not json");
        dir.write("Cargo.toml", "[package]\n");
        assert_eq!(
            detect_test_command(dir.path()),
            Some("cargo test".to_string())
        );
    }

    #[test]
    fn detects_pytest_from_markers() {
        let ini = TempDir::new("detect-pytest-ini");
        ini.write("pytest.ini", "[pytest]\n");
        assert_eq!(detect_test_command(ini.path()), Some("pytest".to_string()));

        let pyproject = TempDir::new("detect-pytest-pyproject");
        pyproject.write("pyproject.toml", "[tool.pytest.ini_options]\naddopts = \"-q\"\n");
        assert_eq!(
            detect_test_command(pyproject.path()),
            Some("pytest".to_string())
        );

        let cfg = TempDir::new("detect-pytest-setupcfg");
        cfg.write("setup.cfg", "[tool:pytest]\n");
        assert_eq!(detect_test_command(cfg.path()), Some("pytest".to_string()));
    }

    #[test]
    fn an_unrecognised_project_yields_no_command() {
        let dir = TempDir::new("detect-none");
        dir.write("README.md", "# nothing to run");
        assert_eq!(detect_test_command(dir.path()), None);
    }

    #[test]
    fn an_explicit_override_bypasses_detection() {
        let dir = TempDir::new("detect-override");
        dir.write("Cargo.toml", "[package]\n");
        assert_eq!(
            resolve_test_command(dir.path(), Some("  cargo test --workspace  ")),
            Some("cargo test --workspace".to_string())
        );
        // A blank override is not an override.
        assert_eq!(
            resolve_test_command(dir.path(), Some("   ")),
            Some("cargo test".to_string())
        );
    }

    #[test]
    fn parses_package_manager_field_variants() {
        assert_eq!(
            parse_package_manager_field("pnpm@9.1.0"),
            Some(PackageManager::Pnpm)
        );
        assert_eq!(parse_package_manager_field("npm"), Some(PackageManager::Npm));
        assert_eq!(parse_package_manager_field("deno@2"), None);
        assert_eq!(parse_package_manager_field(""), None);
    }
}
