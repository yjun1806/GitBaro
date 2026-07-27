// SPDX-License-Identifier: GPL-3.0-or-later
//! Tree-sitter backed commands — V1 · V7 · V8 · V9 · V17 (design §9.1).
//!
//! Two kinds of work meet here and neither may run on the async runtime:
//!
//! - **Parsing** is CPU bound, so every `compare` / `extract` call happens
//!   inside `tokio::task::spawn_blocking`, exactly like the `git2` calls next
//!   to it.
//! - **Indexing** is CPU bound *and* long, so [`build_symbol_index`] returns as
//!   soon as it has claimed the build slot and reports the rest through the
//!   `verify:index-progress` event.
//!
//! The honesty invariant applies unchanged: a file that could not be parsed, or
//! a repository with no symbol index, produces a [`ScanLimit`] — never an empty
//! finding list that reads as "clean".

use std::path::{Component, Path, PathBuf};

use git2::{Commit, Repository};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::AppError;
use crate::events::VERIFY_INDEX_PROGRESS;
use crate::git::commit::validate_commit_oid;
use crate::verify::config::{load_rule_config, RuleConfig};
use crate::verify::context::{
    self, blast_radius, build_index, cache, changed_symbols, BlastRadiusEntry, ChangeSet,
    ContextInput, FileRevision, IndexPhase, IndexProgress, RepoIndex, SymbolIndexStatus,
    SymbolIndexStore,
};
use crate::verify::rules::{finish_report, RuleOutcome};
use crate::verify::structural::{
    self, invariant, FileComparison, StructuralOutcome, MAX_STRUCTURAL_BYTES,
};
use crate::verify::types::{FindingKind, ScanLimit, UncheckedReason, VerificationReport};

use super::verify::{commit_diff, resolve_commit, working_tree_diff};

/// A scan compares at most this many files. Parsing both sides of a thousand-file
/// commit would pin a worker for minutes and tell a reviewer nothing extra.
const MAX_SCANNED_FILES: usize = 300;

// ── §9.1 commands ────────────────────────────────────────────────────────────

/// Start (or resume) the repository symbol index and return immediately.
///
/// Progress arrives as `verify:index-progress`. A build already running for this
/// repository is left alone and its current status is returned — starting a
/// second one would double the CPU cost for the same answer.
#[tauri::command]
pub async fn build_symbol_index(
    repo_path: String,
    app_handle: AppHandle,
    store: State<'_, SymbolIndexStore>,
) -> Result<SymbolIndexStatus, AppError> {
    let path = PathBuf::from(&repo_path);

    let dir_path = path.clone();
    let (dir, seed) = tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&dir_path)?;
        let dir = context::build::cache_dir(&repo)?;
        let seed = cache::load(&dir);
        Ok::<_, AppError>((dir, seed))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    let Some(cancel) = store.begin(&path, seed.clone()) else {
        tracing::debug!("[verify] symbol index already building for {}", repo_path);
        return Ok(store.status(&path));
    };
    let status = store.status(&path);

    tauri::async_runtime::spawn(async move {
        let emit_handle = app_handle.clone();
        let build_path = path.clone();
        let result = tokio::task::spawn_blocking(move || {
            let mut progress = |update: IndexProgress| {
                let _ = emit_handle.emit(VERIFY_INDEX_PROGRESS, update);
            };
            let outcome = build_index(&build_path, seed, &cancel, &mut progress)?;

            progress(IndexProgress {
                repo_path: build_path.to_string_lossy().to_string(),
                phase: IndexPhase::Writing,
                files_done: outcome.index.file_count(),
                files_total: outcome.index.files_total,
                symbols: outcome.index.symbol_count(),
                running: true,
            });
            // A snapshot we could not persist is a slower next launch, not a
            // failed build — the in-memory index is still good.
            if let Err(e) = cache::save(&dir, &outcome.index, Some(&outcome.dirty)) {
                tracing::warn!("[verify] symbol index snapshot not saved: {}", e);
            }
            Ok::<_, AppError>(outcome)
        })
        .await;

        let store = app_handle.state::<SymbolIndexStore>();
        match result {
            Ok(Ok(outcome)) => {
                let phase = if outcome.cancelled {
                    IndexPhase::Cancelled
                } else {
                    IndexPhase::Done
                };
                let done = IndexProgress {
                    repo_path: path.to_string_lossy().to_string(),
                    phase,
                    files_done: outcome.index.file_count(),
                    files_total: outcome.index.files_total,
                    symbols: outcome.index.symbol_count(),
                    running: false,
                };
                store.finish(&path, outcome);
                let _ = app_handle.emit(VERIFY_INDEX_PROGRESS, done);
            }
            Ok(Err(e)) => {
                tracing::warn!("[verify] symbol index build failed: {}", e);
                store.fail(&path);
                emit_failed(&app_handle, &path);
            }
            Err(e) => {
                tracing::warn!("[verify] symbol index build panicked: {}", e);
                store.fail(&path);
                emit_failed(&app_handle, &path);
            }
        }
    });

    Ok(status)
}

#[tauri::command]
pub async fn cancel_symbol_index(
    repo_path: String,
    store: State<'_, SymbolIndexStore>,
) -> Result<SymbolIndexStatus, AppError> {
    Ok(store.cancel(Path::new(&repo_path)))
}

#[tauri::command]
pub async fn get_symbol_index_status(
    repo_path: String,
    store: State<'_, SymbolIndexStore>,
) -> Result<SymbolIndexStatus, AppError> {
    Ok(store.status(Path::new(&repo_path)))
}

/// V1 — the structural comparison of one file.
///
/// `Degraded` is a normal answer, not an error: the frontend keeps the text
/// diff and does not offer a structural toggle (design §5.3).
#[tauri::command]
pub async fn get_structural_diff(
    repo_path: String,
    oid: Option<String>,
    path: String,
    staged: bool,
) -> Result<StructuralOutcome, AppError> {
    if let Some(oid) = &oid {
        validate_commit_oid(oid)?;
    }
    let relative = repo_relative_path(&path)?;

    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&repo_path);
        let repo = Repository::open(&root)?;
        let source = match &oid {
            Some(oid) => {
                let commit = resolve_commit(&repo, oid)?;
                commit_source(&repo, &commit, Some(&relative), Some(&relative))
            }
            None => worktree_source(&repo, &root, Some(&relative), Some(&relative), staged),
        };

        Ok(structural::compare_versions(
            &path,
            source.old.as_deref(),
            source.new.as_deref(),
        ))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V9 — the structured caller data the diff sidebar renders.
///
/// An empty list means "no signature changed, or nothing calls what did". It
/// never means "no index": that case is reported through [`verify_syntax`],
/// where a `ScanLimit` can say so.
#[tauri::command]
pub async fn get_blast_radius(
    repo_path: String,
    oid: Option<String>,
    staged: bool,
    store: State<'_, SymbolIndexStore>,
) -> Result<Vec<BlastRadiusEntry>, AppError> {
    if let Some(oid) = &oid {
        validate_commit_oid(oid)?;
    }
    let index = store.snapshot(Path::new(&repo_path));

    tokio::task::spawn_blocking(move || {
        let Some(index) = usable_index(index) else {
            return Ok(Vec::new());
        };
        let sources = scan_sources(&repo_path, oid.as_deref(), staged)?;
        Ok(blast_radius(&change_set(&sources), &index))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// V1 · V7 · V8 · V9 · V17 as one report.
///
/// Registry coverage is filled exactly once, here, so a rule cannot be counted
/// twice against two different scans (design §9.2).
#[tauri::command]
pub async fn verify_syntax(
    repo_path: String,
    oid: Option<String>,
    staged: bool,
    store: State<'_, SymbolIndexStore>,
) -> Result<VerificationReport, AppError> {
    if let Some(oid) = &oid {
        validate_commit_oid(oid)?;
    }
    let index = store.snapshot(Path::new(&repo_path));

    tokio::task::spawn_blocking(move || {
        let config = load_rule_config();
        syntax_report(&repo_path, oid.as_deref(), staged, index, &config)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/// The whole syntax scan, synchronously. Blocking and CPU bound — every caller
/// runs it inside `spawn_blocking`.
fn syntax_report(
    repo_path: &str,
    oid: Option<&str>,
    staged: bool,
    index: Option<RepoIndex>,
    config: &RuleConfig,
) -> Result<VerificationReport, AppError> {
    let root = PathBuf::from(repo_path);
    let repo = Repository::open(&root)?;

    let message = match oid {
        Some(oid) => Some(resolve_commit(&repo, oid)?.message().unwrap_or("").to_string()),
        None => None,
    };
    let sources = scan_sources(repo_path, oid, staged)?;

    let mut outcome = RuleOutcome::new();

    // ── V1 · V17: structural comparison of every changed file ──
    let structural_wanted = enabled(config, &mut outcome, structural::KINDS);
    let invariant_wanted = enabled(config, &mut outcome, invariant::KINDS);
    if structural_wanted || invariant_wanted {
        let comparisons: Vec<FileComparison> = sources
            .iter()
            .map(|source| FileComparison {
                path: source.path.clone(),
                outcome: structural::compare_versions(
                    &source.path,
                    source.old.as_deref(),
                    source.new.as_deref(),
                ),
            })
            .collect();

        if structural_wanted {
            merge(&mut outcome, structural::collect(&comparisons));
        }
        if invariant_wanted {
            merge(
                &mut outcome,
                invariant::collect(message.as_deref(), &comparisons),
            );
        }
    }

    // ── V7 · V8 · V9: whole-repository context ──
    let changes = change_set(&sources);
    let index = usable_index(index);
    merge(
        &mut outcome,
        context::collect_context_rules(
            &ContextInput {
                repo_root: Some(&root),
                changes: &changes,
                index: index.as_ref(),
            },
            config,
        ),
    );

    Ok(finish_report(outcome, config, "syntax"))
}

/// Both versions of one changed file, as raw bytes.
struct FileSource {
    path: String,
    old: Option<Vec<u8>>,
    new: Option<Vec<u8>>,
}

/// Record a `Disabled` limit for every kind that is off, and report whether any
/// of them survived. Mirrors what `run_diff_rules` does for the static engine.
fn enabled(config: &RuleConfig, outcome: &mut RuleOutcome, kinds: &[FindingKind]) -> bool {
    let mut any = false;
    for kind in kinds {
        if config.is_enabled(kind.rule_id()) {
            any = true;
        } else {
            outcome.limits.push(ScanLimit {
                rule_id: kind.rule_id().to_string(),
                reason: UncheckedReason::Disabled,
                detail: None,
            });
        }
    }
    any
}

fn merge(into: &mut RuleOutcome, other: RuleOutcome) {
    into.findings.extend(other.findings);
    into.limits.extend(other.limits);
    for id in other.checked {
        if !into.checked.contains(&id) {
            into.checked.push(id);
        }
    }
}

/// A partial index answers nothing, and the rules already refuse it — dropping
/// it here keeps the sidebar command from pretending otherwise.
fn usable_index(index: Option<RepoIndex>) -> Option<RepoIndex> {
    index.filter(|index| index.complete && !index.is_empty())
}

/// `FileSource` bytes as the UTF-8 revisions the symbol differ wants. A file
/// that is not valid UTF-8 has no symbols to extract, so it drops out.
fn change_set(sources: &[FileSource]) -> ChangeSet {
    let revisions: Vec<FileRevision> = sources
        .iter()
        .map(|source| FileRevision {
            path: source.path.clone(),
            old_source: source.old.as_deref().and_then(utf8),
            new_source: source.new.as_deref().and_then(utf8),
        })
        .collect();
    changed_symbols(&revisions)
}

fn utf8(bytes: &[u8]) -> Option<String> {
    std::str::from_utf8(bytes).ok().map(str::to_string)
}

/// Every changed file of the scan target, both sides, budget-capped.
fn scan_sources(
    repo_path: &str,
    oid: Option<&str>,
    staged: bool,
) -> Result<Vec<FileSource>, AppError> {
    let root = PathBuf::from(repo_path);
    let repo = Repository::open(&root)?;

    match oid {
        Some(oid) => {
            let commit = resolve_commit(&repo, oid)?;
            let diff = commit_diff(&repo, &commit)?;
            Ok(changed_paths(&diff)
                .into_iter()
                .map(|(old_path, new_path)| {
                    commit_source(&repo, &commit, old_path.as_deref(), new_path.as_deref())
                })
                .collect())
        }
        None => {
            let diff = working_tree_diff(&repo, staged)?;
            Ok(changed_paths(&diff)
                .into_iter()
                .map(|(old_path, new_path)| {
                    worktree_source(
                        &repo,
                        &root,
                        old_path.as_deref(),
                        new_path.as_deref(),
                        staged,
                    )
                })
                .collect())
        }
    }
}

/// `(old_path, new_path)` per changed file, capped at [`MAX_SCANNED_FILES`].
fn changed_paths(
    diff: &crate::git::engine::DiffOutput,
) -> Vec<(Option<String>, Option<String>)> {
    diff.files
        .iter()
        .filter(|file| !file.is_binary)
        .filter(|file| file.old_path.is_some() || file.new_path.is_some())
        .take(MAX_SCANNED_FILES)
        .map(|file| (file.old_path.clone(), file.new_path.clone()))
        .collect()
}

/// The commit's version against its first parent's.
fn commit_source<P: AsRef<Path>>(
    repo: &Repository,
    commit: &Commit<'_>,
    old_path: Option<P>,
    new_path: Option<P>,
) -> FileSource {
    let parent_tree = commit
        .parent_ids()
        .next()
        .and_then(|id| repo.find_commit(id).ok())
        .and_then(|parent| parent.tree().ok());
    let commit_tree = commit.tree().ok();

    FileSource {
        path: display_path(old_path.as_ref(), new_path.as_ref()),
        old: parent_tree
            .as_ref()
            .zip(old_path.as_ref())
            .and_then(|(tree, path)| blob_bytes(repo, tree, path.as_ref())),
        new: commit_tree
            .as_ref()
            .zip(new_path.as_ref())
            .and_then(|(tree, path)| blob_bytes(repo, tree, path.as_ref())),
    }
}

/// Staged: index against `HEAD`. Unstaged: the file on disk against the index.
fn worktree_source<P: AsRef<Path>>(
    repo: &Repository,
    root: &Path,
    old_path: Option<P>,
    new_path: Option<P>,
    staged: bool,
) -> FileSource {
    let path = display_path(old_path.as_ref(), new_path.as_ref());

    let old = match (staged, old_path.as_ref()) {
        (true, Some(path)) => repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_tree().ok())
            .and_then(|tree| blob_bytes(repo, &tree, path.as_ref())),
        (false, Some(path)) => index_bytes(repo, path.as_ref()),
        (_, None) => None,
    };

    let new = match (staged, new_path.as_ref()) {
        (true, Some(path)) => index_bytes(repo, path.as_ref()),
        (false, Some(path)) => read_capped(&root.join(path.as_ref())),
        (_, None) => None,
    };

    FileSource { path, old, new }
}

fn display_path<P: AsRef<Path>>(old_path: Option<&P>, new_path: Option<&P>) -> String {
    new_path
        .or(old_path)
        .map(|path| path.as_ref().to_string_lossy().to_string())
        .unwrap_or_default()
}

fn blob_bytes(repo: &Repository, tree: &git2::Tree<'_>, path: &Path) -> Option<Vec<u8>> {
    let entry = tree.get_path(path).ok()?;
    let blob = repo.find_blob(entry.id()).ok()?;
    let content = blob.content();
    // Oversized input is rejected by `compare` anyway; refusing to copy it here
    // keeps a 100 MiB generated file out of memory in the first place.
    if content.len() > MAX_STRUCTURAL_BYTES {
        return None;
    }
    Some(content.to_vec())
}

fn index_bytes(repo: &Repository, path: &Path) -> Option<Vec<u8>> {
    let index = repo.index().ok()?;
    let entry = index.get_path(path, 0)?;
    let blob = repo.find_blob(entry.id).ok()?;
    let content = blob.content();
    if content.len() > MAX_STRUCTURAL_BYTES {
        return None;
    }
    Some(content.to_vec())
}

fn read_capped(path: &Path) -> Option<Vec<u8>> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_STRUCTURAL_BYTES as u64 {
        return None;
    }
    std::fs::read(path).ok()
}

/// A caller-supplied path must stay inside the repository (design §9.1).
fn repo_relative_path(path: &str) -> Result<PathBuf, AppError> {
    let candidate = Path::new(path);
    let escapes = candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    if path.is_empty() || escapes {
        return Err(AppError::Verify(format!(
            "Path must be relative to the repository root: {}",
            path
        )));
    }
    Ok(candidate.to_path_buf())
}

fn emit_failed(app_handle: &AppHandle, repo_path: &Path) {
    let _ = app_handle.emit(
        VERIFY_INDEX_PROGRESS,
        IndexProgress {
            repo_path: repo_path.to_string_lossy().to_string(),
            phase: IndexPhase::Done,
            files_done: 0,
            files_total: 0,
            symbols: 0,
            running: false,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::registry::registry;
    use std::collections::BTreeSet;

    fn all_enabled() -> RuleConfig {
        let mut config = RuleConfig::default();
        for entry in registry() {
            config.set(entry.id.to_string(), true);
        }
        config
    }

    #[test]
    fn a_path_outside_the_repository_is_refused() {
        assert!(repo_relative_path("../../etc/passwd").is_err());
        assert!(repo_relative_path("/etc/passwd").is_err());
        assert!(repo_relative_path("").is_err());
        assert!(repo_relative_path("src/a.ts").is_ok());
    }

    #[test]
    fn a_disabled_kind_is_recorded_and_reported_as_off() {
        let mut config = all_enabled();
        config.set(FindingKind::StructuralDiff.rule_id().to_string(), false);

        let mut outcome = RuleOutcome::new();
        assert!(!enabled(&config, &mut outcome, structural::KINDS));
        assert_eq!(outcome.limits.len(), 1);
        assert_eq!(outcome.limits[0].reason, UncheckedReason::Disabled);
    }

    #[test]
    fn a_partial_index_is_not_usable() {
        let mut index =
            crate::verify::context::index::fixture::index_from_sources(&[("src/a.ts", "export function a() {}")]);
        index.complete = false;
        assert!(usable_index(Some(index)).is_none());
        assert!(usable_index(Some(RepoIndex::default())).is_none());
    }

    #[test]
    fn non_utf8_sources_drop_out_of_the_change_set() {
        let sources = vec![FileSource {
            path: "src/a.ts".to_string(),
            old: Some(vec![0xff, 0xfe]),
            new: Some(vec![0xff, 0xfe]),
        }];
        assert!(change_set(&sources).is_empty());
    }

    fn assert_registry_is_covered(report: &VerificationReport) {
        let covered: BTreeSet<&str> = report
            .checked
            .iter()
            .chain(report.unchecked.iter())
            .map(String::as_str)
            .collect();
        for entry in registry() {
            assert!(covered.contains(entry.id), "{} unaccounted for", entry.id);
        }
    }

    /// The production path, on a real commit: §2.3 accounting must survive it.
    #[test]
    fn a_commit_scan_accounts_for_every_registry_rule() {
        let temp = crate::verify::hygiene::test_support::TempRepo::new();
        temp.commit(
            "feat(app): seed",
            &[("src/app.ts", "export function alpha() {\n  return 1;\n}\n")],
        );
        let head = temp.commit(
            "feat(app): change",
            &[("src/app.ts", "export function alpha() {\n  return 2;\n}\n")],
        );

        let report = syntax_report(
            &temp.dir.to_string_lossy(),
            Some(&head.to_string()),
            false,
            None,
            &all_enabled(),
        )
        .expect("syntax report");

        assert_registry_is_covered(&report);
        // No index was supplied, so the context rules must confess it rather
        // than report nothing and look clean.
        for kind in [
            FindingKind::ReinventedFunction,
            FindingKind::OrphanCode,
            FindingKind::BlastRadius,
        ] {
            assert!(
                report.limits.iter().any(|limit| limit.rule_id == kind.rule_id()
                    && limit.reason == UncheckedReason::MissingArtifact),
                "{} did not report the missing index",
                kind.rule_id()
            );
        }
    }

    /// V1 · V17 both run off the same comparison, and a `docs:` commit that
    /// edits code is exactly what V17 exists to catch.
    #[test]
    fn a_docs_commit_that_changes_code_violates_its_own_invariant() {
        let temp = crate::verify::hygiene::test_support::TempRepo::new();
        temp.commit(
            "feat(app): seed",
            &[("src/app.ts", "export function alpha() {\n  return 1;\n}\n")],
        );
        let head = temp.commit(
            "docs(app): tidy the comment",
            &[("src/app.ts", "export function alpha() {\n  return 99;\n}\n")],
        );

        let report = syntax_report(
            &temp.dir.to_string_lossy(),
            Some(&head.to_string()),
            false,
            None,
            &all_enabled(),
        )
        .expect("syntax report");

        assert!(
            report
                .findings
                .iter()
                .any(|f| f.rule_id == FindingKind::InvariantViolation.rule_id()),
            "expected a V17 finding, got {:?}",
            report.findings
        );
        assert!(report
            .checked
            .contains(&FindingKind::StructuralDiff.rule_id().to_string()));
        assert_registry_is_covered(&report);
    }

    /// The context half of the wiring: with a usable index in hand, V8 must
    /// actually reach a `Finding` through the same entry point the command uses.
    #[test]
    fn a_supplied_index_lets_the_context_rules_reach_a_finding() {
        let before = "export function alpha() {\n  return 1;\n}\n";
        let after = "export function alpha() {\n  return 1;\n}\n\
                     export function zeta() {\n  return 2;\n}\n";

        let temp = crate::verify::hygiene::test_support::TempRepo::new();
        temp.commit("feat(app): seed", &[("src/app.ts", before)]);
        let head = temp.commit("feat(app): add zeta", &[("src/app.ts", after)]);

        let index = crate::verify::context::index::fixture::index_from_sources(&[
            ("src/app.ts", after),
            ("src/other.ts", "export function beta() { return alpha(); }"),
        ]);

        let report = syntax_report(
            &temp.dir.to_string_lossy(),
            Some(&head.to_string()),
            false,
            Some(index),
            &all_enabled(),
        )
        .expect("syntax report");

        assert!(
            report
                .findings
                .iter()
                .any(|f| f.rule_id == FindingKind::OrphanCode.rule_id()),
            "expected a V8 finding, got {:?}",
            report.findings
        );
        assert_registry_is_covered(&report);
    }

    /// A file outside the TS/JS/Rust scope must degrade to a limit, never to a
    /// silent pass.
    #[test]
    fn an_unsupported_language_degrades_instead_of_reporting_clean() {
        let temp = crate::verify::hygiene::test_support::TempRepo::new();
        temp.commit("feat: seed", &[("main.py", "a = 1\n")]);
        let head = temp.commit("docs: tweak", &[("main.py", "a = 2\n")]);

        let report = syntax_report(
            &temp.dir.to_string_lossy(),
            Some(&head.to_string()),
            false,
            None,
            &all_enabled(),
        )
        .expect("syntax report");

        assert!(report
            .findings
            .iter()
            .all(|f| f.rule_id != FindingKind::StructuralDiff.rule_id()));
        assert!(report.limits.iter().any(|limit| limit.rule_id
            == FindingKind::StructuralDiff.rule_id()
            && limit.reason == UncheckedReason::UnsupportedLanguage));
        assert_registry_is_covered(&report);
    }
}
