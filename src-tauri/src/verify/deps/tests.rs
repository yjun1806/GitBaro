//! Offline cross-check tests for V4.
//!
//! Hermetic by construction: fixtures are written into a per-test temporary
//! directory and no network is reachable from [`scan_dependencies_offline`].
//! The registry path is deliberately untested here (contract §7).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use super::scan_dependencies_offline;
use crate::git::engine::{DiffHunk, DiffLine, DiffOutput, FileDiff};
use crate::verify::config::RuleConfig;
use crate::verify::registry::registry;
use crate::verify::types::{FindingKind, UncheckedReason, VerificationReport};

// ── Fixtures ──────────────────────────────────────────────────────────────────

/// A throwaway directory. `tempfile` is not a dependency of this crate and the
/// contract budgets zero new crates, so this is the 20 lines that replace it.
struct TempRepo(PathBuf);

impl TempRepo {
    fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "gitbaro-verify-deps-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp repo");
        TempRepo(path)
    }

    fn write(&self, relative: &str, content: &str) -> &Self {
        let path = self.0.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create fixture directory");
        }
        std::fs::write(path, content).expect("write fixture");
        self
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// `(path, added lines, removed lines)` where a line is `(number, text)`.
type FileFixture<'a> = (&'a str, &'a [(u32, &'a str)], &'a [(u32, &'a str)]);

fn diff_of(files: &[FileFixture<'_>]) -> DiffOutput {
    let files = files
        .iter()
        .map(|(path, added, removed)| {
            let mut lines: Vec<DiffLine> = removed
                .iter()
                .map(|(number, text)| DiffLine {
                    origin: '-',
                    content: format!("{}\n", text),
                    old_lineno: Some(*number),
                    new_lineno: None,
                })
                .collect();
            lines.extend(added.iter().map(|(number, text)| DiffLine {
                origin: '+',
                content: format!("{}\n", text),
                old_lineno: None,
                new_lineno: Some(*number),
            }));

            FileDiff {
                old_path: Some((*path).to_string()),
                new_path: Some((*path).to_string()),
                is_binary: false,
                hunks: vec![DiffHunk {
                    header: "@@".to_string(),
                    old_start: 1,
                    old_lines: removed.len() as u32,
                    new_start: 1,
                    new_lines: added.len() as u32,
                    lines,
                }],
            }
        })
        .collect();

    DiffOutput { files }
}

fn added_only(path: &str, added: &[(u32, &str)]) -> DiffOutput {
    diff_of(&[(path, added, &[])])
}

/// V4 ships default-off (contract §7-②), so every test turns it on explicitly.
fn enabled() -> RuleConfig {
    let mut enabled = BTreeMap::new();
    enabled.insert(
        FindingKind::HallucinatedDependency.rule_id().to_string(),
        true,
    );
    enabled.insert(
        FindingKind::SuspiciousNewDependency.rule_id().to_string(),
        true,
    );
    RuleConfig { enabled }
}

fn kinds(report: &VerificationReport) -> Vec<FindingKind> {
    report.findings.iter().map(|f| f.kind).collect()
}

fn limit_reasons(report: &VerificationReport, rule_id: &str) -> Vec<UncheckedReason> {
    report
        .limits
        .iter()
        .filter(|limit| limit.rule_id == rule_id)
        .map(|limit| limit.reason)
        .collect()
}

const PNPM_LOCK: &str = "\
lockfileVersion: '9.0'

packages:

  react@19.0.0:
    resolution: {integrity: sha512-aaa}

  jscodeshift@0.15.0:
    resolution: {integrity: sha512-bbb}
";

const PACKAGE_JSON: &str = r#"{
  "name": "app",
  "dependencies": { "react": "^19.0.0" },
  "devDependencies": { "jscodeshift": "^0.15.0" }
}"#;

// ── Imports vs lockfile ───────────────────────────────────────────────────────

#[test]
fn import_present_in_manifest_and_lockfile_is_not_flagged() {
    let repo = TempRepo::new("clean-import");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = added_only("src/app.ts", &[(1, "import React from \"react\";")]);
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert!(report
        .checked
        .contains(&FindingKind::HallucinatedDependency.rule_id().to_string()));
}

#[test]
fn import_absent_from_manifest_and_lockfile_is_a_hallucinated_dependency() {
    let repo = TempRepo::new("hallucinated");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK);

    // The real 2026 slopsquatting incident: a blend of `jscodeshift` and
    // `react-codemod` that never existed.
    let diff = added_only(
        "src/codemod.ts",
        &[(7, "import { run } from \"react-codeshift\";")],
    );
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert_eq!(kinds(&report), vec![FindingKind::HallucinatedDependency]);
    let finding = &report.findings[0];
    assert_eq!(finding.file, "src/codemod.ts");
    assert_eq!(finding.line, Some(7));
    assert!(finding.message.contains("react-codeshift"));
    assert_eq!(
        finding.rule_id,
        FindingKind::HallucinatedDependency.rule_id()
    );
}

#[test]
fn import_in_lockfile_but_not_in_the_manifest_is_only_suspicious() {
    let repo = TempRepo::new("phantom");
    repo.write("package.json", r#"{ "dependencies": { "react": "^19.0.0" } }"#)
        .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = added_only("src/a.ts", &[(3, "import j from 'jscodeshift';")]);
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert_eq!(kinds(&report), vec![FindingKind::SuspiciousNewDependency]);
}

#[test]
fn no_lockfile_produces_a_missing_artifact_limit_and_no_findings() {
    let repo = TempRepo::new("no-lock");
    repo.write("package.json", PACKAGE_JSON);

    let diff = added_only("src/a.ts", &[(1, "import x from \"react-codeshift\";")]);
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert!(limit_reasons(
        &report,
        FindingKind::HallucinatedDependency.rule_id()
    )
    .contains(&UncheckedReason::MissingArtifact));
}

#[test]
fn builtins_relative_paths_and_tsconfig_aliases_are_never_flagged() {
    let repo = TempRepo::new("resolvable");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK)
        .write(
            "tsconfig.json",
            r#"{
                // aliases
                "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } },
            }"#,
        )
        .write("src/lib/utils.ts", "export const x = 1;");

    let diff = added_only(
        "src/a.ts",
        &[
            (1, "import fs from \"node:fs\";"),
            (2, "import path from \"path\";"),
            (3, "import { readFile } from \"fs/promises\";"),
            (4, "import { x } from \"@/lib/utils\";"),
            (5, "import { y } from \"./sibling\";"),
            (6, "import { z } from \"../parent/mod\";"),
            (7, "import { w } from \"src/lib/utils\";"),
        ],
    );
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
}

#[test]
fn unreadable_tsconfig_skips_js_imports_instead_of_flagging_them() {
    let repo = TempRepo::new("bad-tsconfig");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK)
        .write("tsconfig.json", "{ this is not json");

    // `@app/*` would be a `paths` alias in a readable tsconfig; unreadable, it
    // is indistinguishable from a package, so V4 must abstain rather than guess.
    let diff = added_only("src/a.ts", &[(1, "import x from \"@app/tokens\";")]);
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert!(limit_reasons(
        &report,
        FindingKind::HallucinatedDependency.rule_id()
    )
    .contains(&UncheckedReason::ParseFailed));
}

// ── Manifest vs lockfile ─────────────────────────────────────────────────────

#[test]
fn dependency_added_to_the_manifest_but_missing_from_the_lockfile_is_suspicious() {
    let repo = TempRepo::new("manifest-add");
    repo.write(
        "package.json",
        r#"{ "dependencies": { "react": "^19.0.0", "react-codeshift": "^1.0.0" } }"#,
    )
    .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = added_only(
        "package.json",
        &[(3, "    \"react-codeshift\": \"^1.0.0\"")],
    );
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert_eq!(kinds(&report), vec![FindingKind::SuspiciousNewDependency]);
    assert_eq!(report.findings[0].file, "package.json");
    assert_eq!(report.findings[0].line, Some(3));
}

#[test]
fn a_version_bump_is_not_a_new_dependency() {
    let repo = TempRepo::new("version-bump");
    repo.write(
        "package.json",
        r#"{ "dependencies": { "react": "^19.1.0" } }"#,
    )
    .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = diff_of(&[(
        "package.json",
        &[(2, "  \"react\": \"^19.1.0\",")],
        &[(2, "  \"react\": \"^19.0.0\",")],
    )]);
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
}

#[test]
fn workspace_protocol_dependencies_are_not_expected_in_the_lockfile() {
    let repo = TempRepo::new("workspace-proto");
    repo.write(
        "package.json",
        r#"{ "dependencies": { "@app/ui": "workspace:*" } }"#,
    )
    .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = added_only("package.json", &[(2, "  \"@app/ui\": \"workspace:*\"")]);
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
}

// ── Rust ──────────────────────────────────────────────────────────────────────

#[test]
fn rust_use_of_an_undeclared_crate_is_a_hallucinated_dependency() {
    let repo = TempRepo::new("rust-hallucinated");
    repo.write(
        "Cargo.toml",
        "[dependencies]\nserde = \"1\"\ntauri-plugin-shell = \"2\"\n",
    )
    .write(
        "Cargo.lock",
        "[[package]]\nname = \"serde\"\nversion = \"1.0.0\"\n\n[[package]]\nname = \"tauri-plugin-shell\"\nversion = \"2.0.0\"\n",
    );

    let diff = added_only(
        "src/main.rs",
        &[
            (1, "use serde::Serialize;"),
            (2, "use tauri_plugin_shell::ShellExt;"),
            (3, "use std::path::Path;"),
            (4, "use crate::error::AppError;"),
            (5, "use serde_hallucinated::Magic;"),
        ],
    );
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert_eq!(kinds(&report), vec![FindingKind::HallucinatedDependency]);
    assert!(report.findings[0].message.contains("serde_hallucinated"));
}

// ── Scope and accounting ─────────────────────────────────────────────────────

#[test]
fn monorepo_manifests_are_found_by_walking_up_from_the_changed_file() {
    let repo = TempRepo::new("monorepo");
    repo.write("package.json", r#"{ "dependencies": {} }"#)
        .write("pnpm-lock.yaml", PNPM_LOCK)
        .write("packages/web/package.json", PACKAGE_JSON);

    let diff = added_only(
        "packages/web/src/a.ts",
        &[(1, "import React from \"react\";")],
    );
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
}

#[test]
fn vendored_directories_are_not_scanned() {
    let repo = TempRepo::new("vendored");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = added_only(
        "node_modules/whatever/index.js",
        &[(1, "require(\"react-codeshift\");")],
    );
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert!(limit_reasons(
        &report,
        FindingKind::HallucinatedDependency.rule_id()
    )
    .contains(&UncheckedReason::NotApplicable));
}

#[test]
fn other_languages_are_recorded_as_unchecked_rather_than_guessed_at() {
    let repo = TempRepo::new("other-language");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = added_only("scripts/tool.py", &[(1, "import requests")]);
    let report = scan_dependencies_offline(repo.path(), &diff, &enabled());

    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert!(limit_reasons(
        &report,
        FindingKind::HallucinatedDependency.rule_id()
    )
    .contains(&UncheckedReason::UnsupportedLanguage));
}

#[test]
fn disabled_rules_are_reported_as_unchecked_not_as_silence() {
    let repo = TempRepo::new("disabled");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK);

    let diff = added_only("src/a.ts", &[(1, "import x from \"react-codeshift\";")]);
    let report = scan_dependencies_offline(repo.path(), &diff, &RuleConfig::default());

    assert!(report.findings.is_empty());
    assert_eq!(
        limit_reasons(&report, FindingKind::HallucinatedDependency.rule_id()),
        vec![UncheckedReason::Disabled]
    );
}

/// Contract §2.3 / spec §7-①: an empty finding list must never read as "safe".
/// Every registry rule has to appear in `checked` or `unchecked`.
#[test]
fn every_registry_rule_appears_in_checked_or_unchecked() {
    let repo = TempRepo::new("coverage");
    repo.write("package.json", PACKAGE_JSON)
        .write("pnpm-lock.yaml", PNPM_LOCK);

    for (label, diff) in [
        (
            "finding",
            added_only("src/a.ts", &[(1, "import x from \"react-codeshift\";")]),
        ),
        (
            "no finding",
            added_only("src/a.ts", &[(1, "import React from \"react\";")]),
        ),
        ("empty diff", DiffOutput { files: Vec::new() }),
    ] {
        let report = scan_dependencies_offline(repo.path(), &diff, &enabled());
        let covered: BTreeSet<&str> = report
            .checked
            .iter()
            .chain(report.unchecked.iter())
            .map(String::as_str)
            .collect();

        for entry in registry() {
            assert!(
                covered.contains(entry.id),
                "{}: rule {} is in neither checked nor unchecked",
                label,
                entry.id
            );
        }

        let derived: BTreeSet<&str> = report
            .limits
            .iter()
            .map(|limit| limit.rule_id.as_str())
            .collect();
        let unchecked: BTreeSet<&str> = report.unchecked.iter().map(String::as_str).collect();
        assert_eq!(unchecked, derived, "{}: unchecked must derive from limits", label);
    }
}
