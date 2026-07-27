//! V4 — hallucinated dependency (slopsquatting) detection.
//!
//! The offline path is the product; the registry lookup is a garnish. A package
//! a diff imports but that appears in neither the manifest nor the lockfile is
//! already the strongest signal available without a network, and it is the one
//! signal npm's own typosquatting checks structurally cannot give: a
//! hallucinated name is a *brand new string*, so edit-distance collision
//! detection never fires (spec §V4).
//!
//! Layout:
//!
//! | file | responsibility |
//! |---|---|
//! | [`target`] | what in the diff V4 may look at, and its added/removed lines |
//! | [`manifest`] | what the repo declares / what the diff newly declared |
//! | [`lockfile`] | does a lockfile mention this package |
//! | [`imports`] | bare specifiers, minus builtins and `tsconfig` aliases |
//! | [`index`] | manifests and lockfiles found around the changed files |
//! | [`checks`] | the two offline checks |
//! | [`scan`] | findings plus the `checked`/`unchecked` accounting |
//! | [`registry_api`] | **the only networked code in V4** |
//!
//! Everything reachable from [`scan_dependencies_offline`] is hermetic: file
//! reads under `repo_path` and nothing else.

mod checks;
mod imports;
mod index;
mod jsonc;
mod lockfile;
mod manifest;
mod registry_api;
mod scan;
mod target;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::git::engine::DiffOutput;
use crate::verify::config::RuleConfig;
use crate::verify::types::{FindingKind, UncheckedReason, VerificationReport};

use scan::{Candidate, OfflineScan};

/// V4 entry point for `commands::verify::check_dependencies`.
///
/// `allow_registry == false` (the default) is byte-for-byte the offline scan —
/// no HTTP client is even constructed.
pub async fn check_dependencies(
    repo_path: PathBuf,
    diff: DiffOutput,
    config: RuleConfig,
    allow_registry: bool,
) -> Result<VerificationReport, AppError> {
    let scan = tokio::task::spawn_blocking(move || checks::scan_offline(&repo_path, &diff, &config))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?;

    if !allow_registry {
        return Ok(scan.into_report());
    }
    Ok(enrich_with_registry(scan).await)
}

/// Offline-only scan. Blocking file IO — call inside `spawn_blocking`.
pub fn scan_dependencies_offline(
    repo_path: &Path,
    diff: &DiffOutput,
    config: &RuleConfig,
) -> VerificationReport {
    checks::scan_offline(repo_path, diff, config).into_report()
}

/// Opt-in enrichment. A registry that does not answer degrades to a
/// `MissingArtifact` limit — the offline findings stand either way.
async fn enrich_with_registry(mut scan: OfflineScan) -> VerificationReport {
    let mut names: Vec<String> = Vec::new();
    let mut origins: BTreeMap<String, Candidate> = BTreeMap::new();
    for candidate in &scan.npm_candidates {
        if origins.contains_key(&candidate.package) {
            continue;
        }
        names.push(candidate.package.clone());
        origins.insert(candidate.package.clone(), candidate.clone());
    }

    if names.is_empty() {
        return scan.into_report();
    }

    let facts = match registry_api::lookup_npm_packages(&names).await {
        Ok(facts) => facts,
        Err(error) => {
            tracing::warn!("[verify] V4 registry lookup failed: {}", error);
            scan.limit_all(
                UncheckedReason::MissingArtifact,
                "npm registry lookup failed — offline results only",
            );
            return scan.into_report();
        }
    };

    let now = chrono::Utc::now().timestamp_millis();
    for fact in facts {
        let Some(origin) = origins.get(&fact.name).cloned() else {
            continue;
        };
        if !fact.exists {
            scan.add(
                FindingKind::HallucinatedDependency,
                &fact.name,
                &origin.file,
                origin.line,
                format!("\"{}\" does not exist on registry.npmjs.org", fact.name),
                None,
            );
            continue;
        }
        if let Some(reason) = registry_api::suspicion_reason(&fact, now) {
            scan.add(
                FindingKind::SuspiciousNewDependency,
                &fact.name,
                &origin.file,
                origin.line,
                format!("\"{}\" {}", fact.name, reason),
                None,
            );
        }
    }

    scan.into_report()
}

#[cfg(test)]
mod tests;
