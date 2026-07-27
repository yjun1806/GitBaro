//! The two offline V4 checks.
//!
//! 1. A dependency the diff **added to a manifest** that the lockfile has never
//!    heard of. Usually it just means the lockfile was not regenerated — hence
//!    `SuspiciousNewDependency`, not `HallucinatedDependency`.
//! 2. A package the diff **imports in code** that is in neither a manifest nor
//!    a lockfile. This is the slopsquatting signature: the agent invented a
//!    plausible name and wrote code against it (spec §V4).
//!
//! Every branch that cannot decide records a `ScanLimit` and produces no
//! finding. Contract §5: 미검사 > 오탐 — an unchecked item is honest, a false
//! positive burns the badge for every other rule (spec §7-②).

use std::collections::BTreeSet;
use std::path::Path;

use crate::verify::config::RuleConfig;
use crate::verify::types::{FindingKind, UncheckedReason};

use super::imports::{self, ImportRef, TsResolution};
use super::index::{candidate_directories, load_ts_resolution, EcosystemIndex};
use super::manifest::{self, Ecosystem, TRACKED_CARGO_SECTIONS, TRACKED_NPM_SECTIONS};
use super::scan::{Candidate, EnabledRules, OfflineScan};
use super::target::{self, Targets};
use crate::git::engine::DiffOutput;

pub(super) fn scan_offline(
    repo_path: &Path,
    diff: &DiffOutput,
    config: &RuleConfig,
) -> OfflineScan {
    let rules = EnabledRules::from_config(config);
    let mut scan = OfflineScan::new(rules);

    if !rules.hallucinated {
        scan.limit(
            FindingKind::HallucinatedDependency.rule_id(),
            UncheckedReason::Disabled,
            "rule turned off in settings",
        );
    }
    if !rules.suspicious {
        scan.limit(
            FindingKind::SuspiciousNewDependency.rule_id(),
            UncheckedReason::Disabled,
            "rule turned off in settings",
        );
    }
    if rules.active_ids().is_empty() {
        return scan;
    }

    let targets = target::classify_diff(diff);
    if targets.unsupported > 0 {
        scan.limit_all(
            UncheckedReason::UnsupportedLanguage,
            format!(
                "{} source files outside TypeScript/JavaScript/Rust",
                targets.unsupported
            ),
        );
    }
    if targets.is_empty() {
        scan.limit_all(
            UncheckedReason::NotApplicable,
            "no manifest or TypeScript/JavaScript/Rust source in this diff",
        );
        return scan;
    }

    let directories = candidate_directories(repo_path, &targets.paths);
    let npm = EcosystemIndex::load(repo_path, &directories, Ecosystem::Npm);
    let cargo = EcosystemIndex::load(repo_path, &directories, Ecosystem::Cargo);
    let ts = load_ts_resolution(&directories);

    check_manifest_additions(&mut scan, &targets, &npm, &cargo);
    check_added_imports(&mut scan, &targets, &npm, &cargo, &ts);

    tracing::debug!(
        "[verify] V4 offline scan: {} npm lookup candidates",
        scan.npm_candidates.len()
    );

    scan
}

// ── Check 1: newly declared, but the lockfile has never heard of it ───────────

fn check_manifest_additions(
    scan: &mut OfflineScan,
    targets: &Targets<'_>,
    npm: &EcosystemIndex,
    cargo: &EcosystemIndex,
) {
    for (files, index, ecosystem) in [
        (&targets.npm_manifests, npm, Ecosystem::Npm),
        (&targets.cargo_manifests, cargo, Ecosystem::Cargo),
    ] {
        for file in files.iter() {
            let Some(path) = target::file_path(file) else {
                continue;
            };
            let Some(manifest_file) = index.manifest(path) else {
                scan.limit_all(
                    UncheckedReason::ParseFailed,
                    format!("{} could not be read as a manifest", path),
                );
                continue;
            };

            // A version bump removes and re-adds the same key; that is not a
            // new dependency and must not be treated as one.
            let removed: BTreeSet<String> = target::changed_lines(file, false)
                .filter_map(|(_, text)| manifest_key(ecosystem, text))
                .collect();

            for (line, text) in target::changed_lines(file, true) {
                let Some(key) = manifest_key(ecosystem, text) else {
                    continue;
                };
                if removed.contains(&key) {
                    continue;
                }
                // The on-disk manifest, not the hunk, decides which section a
                // key belongs to — hunks rarely include the section header.
                let Some(dep) = manifest_file.declared.get(&key) else {
                    continue;
                };
                if !is_tracked_section(ecosystem, &dep.section) || dep.is_local {
                    continue;
                }

                if ecosystem == Ecosystem::Npm {
                    scan.npm_candidates.push(Candidate {
                        package: dep.resolve_name.clone(),
                        file: path.to_string(),
                        line: Some(line),
                    });
                }
                if !index.has_lock() {
                    scan.limit_all(
                        UncheckedReason::MissingArtifact,
                        format!("no {} lockfile found", ecosystem.label()),
                    );
                    continue;
                }

                scan.mark_checked();
                if index.lock_contains(&lookup_name(ecosystem, &dep.resolve_name)) {
                    continue;
                }
                scan.add(
                    FindingKind::SuspiciousNewDependency,
                    &dep.resolve_name,
                    path,
                    Some(line),
                    format!(
                        "\"{}\" added to {} but absent from {}",
                        key,
                        dep.section,
                        index.lock_label()
                    ),
                    Some(text.trim().to_string()),
                );
            }
        }
    }
}

// ── Check 2: code imports a package nothing declares or locks ────────────────

fn check_added_imports(
    scan: &mut OfflineScan,
    targets: &Targets<'_>,
    npm: &EcosystemIndex,
    cargo: &EcosystemIndex,
    ts: &TsResolution,
) {
    let js_imports = collect_js_imports(targets, ts);
    let rust_imports = collect_rust_imports(targets);

    // Without `paths`, every alias (`@/lib/x`) would read as a package.
    if ts.parse_failed && !js_imports.is_empty() {
        scan.limit_all(
            UncheckedReason::ParseFailed,
            "tsconfig.json unreadable — import checks skipped for TypeScript/JavaScript",
        );
    }

    for (refs, index, ecosystem) in [
        (
            if ts.parse_failed { Vec::new() } else { js_imports },
            npm,
            Ecosystem::Npm,
        ),
        (rust_imports, cargo, Ecosystem::Cargo),
    ] {
        if refs.is_empty() {
            continue;
        }
        if !index.has_lock() {
            scan.limit_all(
                UncheckedReason::MissingArtifact,
                format!("no {} lockfile found", ecosystem.label()),
            );
            continue;
        }
        scan.mark_checked();

        for import in refs {
            check_one_import(scan, index, ecosystem, &import);
        }
    }
}

fn check_one_import(
    scan: &mut OfflineScan,
    index: &EcosystemIndex,
    ecosystem: Ecosystem,
    import: &ImportRef,
) {
    let declared = index.declared(ecosystem, &import.package);
    let lookup = match &declared {
        Some(dep) => lookup_name(ecosystem, &dep.resolve_name),
        None => lookup_name(ecosystem, &import.package),
    };

    if let Some(dep) = declared {
        if dep.is_local || index.lock_contains(&lookup) {
            return;
        }
        scan.add(
            FindingKind::SuspiciousNewDependency,
            &import.package,
            &import.file,
            Some(import.line),
            format!(
                "\"{}\" is declared in {} but absent from {}",
                import.package,
                dep.section,
                index.lock_label()
            ),
            Some(import.specifier.clone()),
        );
        return;
    }

    if ecosystem == Ecosystem::Npm {
        scan.npm_candidates.push(Candidate {
            package: import.package.clone(),
            file: import.file.clone(),
            line: Some(import.line),
        });
    }

    if index.lock_contains(&lookup) {
        scan.add(
            FindingKind::SuspiciousNewDependency,
            &import.package,
            &import.file,
            Some(import.line),
            format!(
                "\"{}\" is imported but not declared in any manifest (resolved transitively)",
                import.package
            ),
            Some(import.specifier.clone()),
        );
        return;
    }

    scan.add(
        FindingKind::HallucinatedDependency,
        &import.package,
        &import.file,
        Some(import.line),
        format!(
            "\"{}\" is imported but present in neither the manifest nor {}",
            import.package,
            index.lock_label()
        ),
        Some(import.specifier.clone()),
    );
}

fn collect_js_imports(targets: &Targets<'_>, ts: &TsResolution) -> Vec<ImportRef> {
    let mut out = Vec::new();
    for file in &targets.js_sources {
        let Some(path) = target::file_path(file) else {
            continue;
        };
        for (line, text) in target::changed_lines(file, true) {
            for specifier in imports::js_specifiers(text) {
                if ts.matches_alias(&specifier) || ts.resolves_under_base_url(&specifier) {
                    continue;
                }
                let Some(package) = imports::npm_package_of_specifier(&specifier) else {
                    continue;
                };
                if imports::is_node_builtin(&package) {
                    continue;
                }
                out.push(ImportRef {
                    file: path.to_string(),
                    line,
                    specifier,
                    package,
                });
            }
        }
    }
    out
}

fn collect_rust_imports(targets: &Targets<'_>) -> Vec<ImportRef> {
    let mut out = Vec::new();
    for file in &targets.rust_sources {
        let Some(path) = target::file_path(file) else {
            continue;
        };
        for (line, text) in target::changed_lines(file, true) {
            let Some(krate) = imports::rust_crate_of_line(text) else {
                continue;
            };
            out.push(ImportRef {
                file: path.to_string(),
                line,
                specifier: krate.clone(),
                package: krate,
            });
        }
    }
    out
}

fn lookup_name(ecosystem: Ecosystem, name: &str) -> String {
    match ecosystem {
        Ecosystem::Npm => name.to_string(),
        Ecosystem::Cargo => super::lockfile::normalize_crate(name),
    }
}

fn manifest_key(ecosystem: Ecosystem, line: &str) -> Option<String> {
    match ecosystem {
        Ecosystem::Npm => manifest::json_key_of_line(line),
        Ecosystem::Cargo => manifest::toml_key_of_line(line),
    }
}

fn is_tracked_section(ecosystem: Ecosystem, section: &str) -> bool {
    match ecosystem {
        Ecosystem::Npm => TRACKED_NPM_SECTIONS.contains(&section),
        Ecosystem::Cargo => TRACKED_CARGO_SECTIONS.contains(&section),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_declared_dependency_sections_count_as_added_dependencies() {
        assert!(is_tracked_section(Ecosystem::Npm, "dependencies"));
        assert!(is_tracked_section(Ecosystem::Npm, "devDependencies"));
        assert!(is_tracked_section(Ecosystem::Npm, "peerDependencies"));
        assert!(!is_tracked_section(Ecosystem::Npm, "optionalDependencies"));
        assert!(is_tracked_section(Ecosystem::Cargo, "dev-dependencies"));
        assert!(!is_tracked_section(Ecosystem::Cargo, "build-dependencies"));
    }

    #[test]
    fn cargo_lookups_normalize_hyphens_but_npm_lookups_do_not() {
        assert_eq!(
            lookup_name(Ecosystem::Cargo, "tauri-plugin-shell"),
            "tauri_plugin_shell"
        );
        assert_eq!(lookup_name(Ecosystem::Npm, "react-dom"), "react-dom");
    }
}
