// SPDX-License-Identifier: GPL-3.0-or-later
//! V8 (orphan code) and V9 (blast radius) — both name-based reachability, so
//! they share one module and one set of caveats.
//!
//! **Name-based resolution is incomplete by construction.** Dynamic imports,
//! string-keyed dispatch, macro-generated calls, re-export chains and a
//! library's public API are all invisible to it. Every finding here therefore
//! says so in its `detail`, V8 ships off by default, and the exclusion list
//! below is deliberately aggressive: a wrong "this is dead code" costs more
//! trust than ten missed ones.

use serde::{Deserialize, Serialize};

use crate::verify::rules::RuleOutcome;
use crate::verify::types::{Finding, FindingKind, UncheckedReason};

use super::changes::{ChangeSet, ChangedSymbol};
use super::index::RepoIndex;
use super::model::{is_test_path, SymbolKind, SyntaxLanguage};

/// Call sites listed per changed symbol before eliding.
const MAX_CALL_SITES: usize = 50;
/// Call sites named in a finding's detail.
const NAMED_CALL_SITES: usize = 3;
const MAX_ORPHAN_FINDINGS: usize = 10;
/// Bytes read per file during V8's text-confirmation pass.
const MAX_TEXT_SCAN_BYTES: u64 = 1024 * 1024;

// ── V9 wire types ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlastRadiusEntry {
    pub symbol: String,
    pub file: String,
    pub kind: SymbolKind,
    pub signature_changed: bool,
    /// Capped at [`MAX_CALL_SITES`].
    pub callers: Vec<CallSite>,
    pub caller_count: usize,
    /// Callers living in files this change does not touch.
    pub untouched_caller_count: usize,
    pub resolution: CallerResolution,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CallSite {
    pub file: String,
    pub line: u32,
    /// The symbol containing the call; `None` for top-level code.
    pub symbol: Option<String>,
    pub touched_in_diff: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CallerResolution {
    /// Exactly one definition of this name in the index — name matching is
    /// exact enough to trust.
    NameUnique,
    /// Several definitions share the name, so the caller list may contain
    /// unrelated ones. Misattribution is worse than no attribution (§7-⑧), so
    /// this is stated in the message rather than hidden.
    #[serde(rename_all = "camelCase")]
    NameAmbiguous { definitions: usize },
}

// ── V9 ───────────────────────────────────────────────────────────────────────

/// The structured data behind the diff sidebar. Also the finding source below.
pub fn blast_radius(changes: &ChangeSet, index: &RepoIndex) -> Vec<BlastRadiusEntry> {
    changes
        .signature_changed
        .iter()
        .map(|changed| entry_for(changed, changes, index))
        .collect()
}

fn entry_for(changed: &ChangedSymbol, changes: &ChangeSet, index: &RepoIndex) -> BlastRadiusEntry {
    let name = changed.record.name.as_str();
    let definitions = index.definitions_of(name).len();
    let resolution = if definitions <= 1 {
        CallerResolution::NameUnique
    } else {
        CallerResolution::NameAmbiguous { definitions }
    };

    let mut callers: Vec<CallSite> = index
        .occurrences_of(name)
        .into_iter()
        .map(|hit| CallSite {
            touched_in_diff: changes.touches(&hit.path),
            file: hit.path,
            line: hit.line,
            symbol: hit.symbol,
        })
        .collect();
    callers.sort_by(|a, b| a.file.cmp(&b.file).then_with(|| a.line.cmp(&b.line)));

    let caller_count = callers.len();
    let untouched_caller_count = callers.iter().filter(|site| !site.touched_in_diff).count();
    callers.truncate(MAX_CALL_SITES);

    BlastRadiusEntry {
        symbol: changed.record.name.clone(),
        file: changed.path.clone(),
        kind: changed.record.kind,
        signature_changed: true,
        callers,
        caller_count,
        untouched_caller_count,
        resolution,
    }
}

pub fn run_blast_radius(changes: &ChangeSet, index: &RepoIndex) -> RuleOutcome {
    let mut outcome = RuleOutcome::new();
    let kind = FindingKind::BlastRadius;

    if changes.signature_changed.is_empty() {
        outcome.limit(
            kind,
            UncheckedReason::NotApplicable,
            Some("no signature changed in this change".to_string()),
        );
        return outcome;
    }
    outcome.check(kind);

    for entry in blast_radius(changes, index) {
        // Silence is the point: a signature change whose callers were all
        // updated in the same diff has nothing to warn about.
        if entry.untouched_caller_count == 0 {
            continue;
        }
        let ambiguity = match entry.resolution {
            CallerResolution::NameUnique => String::new(),
            CallerResolution::NameAmbiguous { definitions } => {
                format!(" (name is ambiguous: {definitions} definitions)")
            }
        };
        let named: Vec<String> = entry
            .callers
            .iter()
            .filter(|site| !site.touched_in_diff)
            .take(NAMED_CALL_SITES)
            .map(|site| format!("{}:{}", site.file, site.line))
            .collect();
        let elided = entry.untouched_caller_count.saturating_sub(named.len());
        let more = if elided > 0 {
            format!(", +{elided} more")
        } else {
            String::new()
        };

        outcome.push(
            Finding::new(
                kind,
                entry.file.clone(),
                format!(
                    "`{}` signature changed · {} caller(s), {} in files this change does not touch{}",
                    entry.symbol, entry.caller_count, entry.untouched_caller_count, ambiguity
                ),
            )
            .with_detail(format!(
                "name-based resolution · {}{}",
                named.join(", "),
                more
            )),
        );
    }
    outcome
}

// ── V8 ───────────────────────────────────────────────────────────────────────

pub fn run_orphan(
    changes: &ChangeSet,
    index: &RepoIndex,
    repo_root: Option<&std::path::Path>,
) -> RuleOutcome {
    let mut outcome = RuleOutcome::new();
    let kind = FindingKind::OrphanCode;

    let candidates: Vec<&ChangedSymbol> = changes
        .added
        .iter()
        .filter(|added| added.record.exported)
        .filter(|added| exclusion_reason(added).is_none())
        .collect();

    if candidates.is_empty() {
        outcome.limit(
            kind,
            UncheckedReason::NotApplicable,
            Some("no newly exported symbol in this change".to_string()),
        );
        return outcome;
    }
    outcome.check(kind);

    let mut reported = 0;
    for candidate in candidates {
        if index.referencing_files(&candidate.record.name, &candidate.path) > 0 {
            continue;
        }
        // Last defence: names reached only through a string literal, a macro or
        // a config file. The candidate set is tiny by now, so this costs
        // nothing, and it removes the most embarrassing class of false positive.
        if let Some(root) = repo_root {
            if appears_in_text(root, index, &candidate.record.name, &candidate.path) {
                continue;
            }
        }
        if reported >= MAX_ORPHAN_FINDINGS {
            outcome.limit(
                kind,
                UncheckedReason::BudgetExceeded,
                Some(format!(
                    "more than {MAX_ORPHAN_FINDINGS} unreferenced exports; the rest are not reported"
                )),
            );
            break;
        }
        reported += 1;

        let coverage = format!(
            "index covers {} file(s) · name-based resolution · dynamic references are not detected{}",
            index.file_count(),
            if repo_root.is_some() {
                ""
            } else {
                " · text confirmation pass skipped"
            }
        );
        outcome.push(
            Finding::new(
                kind,
                candidate.path.clone(),
                format!(
                    "exported `{}` is not referenced anywhere in the index",
                    candidate.record.name
                ),
            )
            .at_line(candidate.record.span.start_line)
            .with_detail(coverage),
        );
    }
    outcome
}

/// Why a newly exported symbol must not be called dead. Returning the reason
/// rather than a bool keeps the list auditable.
fn exclusion_reason(added: &ChangedSymbol) -> Option<&'static str> {
    let symbol = &added.record;
    let path = added.path.as_str();

    if symbol
        .attributes
        .iter()
        .any(|attr| attr.starts_with("tauri::command"))
    {
        // Tauri commands are named only inside `generate_handler!` and a TS
        // string — the single biggest false-positive source in this repository.
        return Some("tauri command");
    }
    if symbol
        .attributes
        .iter()
        .any(|attr| attr.starts_with("test") || attr.starts_with("cfg(test") || attr.starts_with("derive"))
    {
        return Some("test or derive attribute");
    }
    if is_test_path(path) {
        return Some("test file");
    }
    if is_barrel_file(path) {
        return Some("barrel re-export");
    }
    if is_entry_point(path) {
        return Some("entry point");
    }
    if symbol.name == "default" {
        return Some("default export");
    }
    if is_react_component(path, &symbol.name) {
        // A component is referenced as a JSX tag or lazily; both resolve badly
        // by name, so components are excluded rather than downgraded.
        return Some("react component");
    }
    None
}

fn is_barrel_file(path: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    matches!(
        file,
        "index.ts" | "index.tsx" | "index.js" | "index.jsx" | "mod.rs" | "lib.rs"
    )
}

fn is_entry_point(path: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    matches!(file, "main.rs" | "main.ts" | "main.tsx" | "App.tsx")
}

fn is_react_component(path: &str, name: &str) -> bool {
    let jsx = matches!(
        super::lang::language_of_path(path),
        Some(SyntaxLanguage::Tsx) | Some(SyntaxLanguage::Jsx)
    );
    jsx && name
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_uppercase())
}

/// Grep the indexed files for the raw name. Only ever called for a handful of
/// candidates, so reading the files is cheaper than maintaining a text index.
fn appears_in_text(root: &std::path::Path, index: &RepoIndex, name: &str, own_path: &str) -> bool {
    for file in index.files() {
        if file.path == own_path {
            continue;
        }
        let absolute = root.join(&file.path);
        let Ok(metadata) = std::fs::metadata(&absolute) else {
            continue;
        };
        if metadata.len() > MAX_TEXT_SCAN_BYTES {
            continue;
        }
        let Ok(contents) = std::fs::read_to_string(&absolute) else {
            continue;
        };
        if contents.contains(name) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::context::changes::{changed_symbols, FileRevision};
    use crate::verify::context::index::fixture::index_from_sources;

    // ── V8 ───────────────────────────────────────────────────────────────

    #[test]
    fn an_unreferenced_new_export_is_reported() {
        let index = index_from_sources(&[
            ("src/lib/util.ts", "export function parseFooBar(x) { return x; }"),
            ("src/app.ts", "export const ready = true;"),
        ]);
        let changes = changed_symbols(&[FileRevision::added(
            "src/lib/util.ts",
            "export function parseFooBar(x) { return x; }",
        )]);

        let outcome = run_orphan(&changes, &index, None);
        assert_eq!(outcome.findings.len(), 1);
        assert_eq!(outcome.findings[0].rule_id, "v8.orphanCode");
        assert!(outcome.findings[0].message.contains("parseFooBar"));
        let detail = outcome.findings[0].detail.clone().expect("detail");
        assert!(
            detail.contains("dynamic references are not detected"),
            "the incompleteness caveat is mandatory, detail was {detail}"
        );
    }

    #[test]
    fn an_export_imported_by_another_file_is_not_reported() {
        let index = index_from_sources(&[
            ("src/lib/util.ts", "export function parseFooBar(x) { return x; }"),
            (
                "src/app.ts",
                "import { parseFooBar } from \"./lib/util\";\nexport const out = parseFooBar(1);",
            ),
        ]);
        let changes = changed_symbols(&[FileRevision::added(
            "src/lib/util.ts",
            "export function parseFooBar(x) { return x; }",
        )]);
        assert!(run_orphan(&changes, &index, None).findings.is_empty());
    }

    #[test]
    fn a_tauri_command_is_never_orphan_code() {
        let source = "#[tauri::command]\npub async fn open_repo(path: String) -> String { path }\n";
        let index = index_from_sources(&[("src-tauri/src/commands/repo.rs", source)]);
        let changes = changed_symbols(&[FileRevision::added(
            "src-tauri/src/commands/repo.rs",
            source,
        )]);
        let outcome = run_orphan(&changes, &index, None);
        assert!(outcome.findings.is_empty());
        assert!(
            outcome
                .limits
                .iter()
                .any(|limit| limit.reason == UncheckedReason::NotApplicable),
            "an all-excluded candidate set is not applicable, not clean"
        );
    }

    #[test]
    fn a_react_component_is_excluded() {
        let source = "export function StatusBadge() { return <span />; }";
        let index = index_from_sources(&[("src/components/StatusBadge.tsx", source)]);
        let changes = changed_symbols(&[FileRevision::added(
            "src/components/StatusBadge.tsx",
            source,
        )]);
        assert!(run_orphan(&changes, &index, None).findings.is_empty());
    }

    #[test]
    fn barrel_files_and_test_files_are_excluded() {
        let barrel = "export function reexported() { return 1; }";
        let index = index_from_sources(&[("src/lib/index.ts", barrel)]);
        let changes = changed_symbols(&[
            FileRevision::added("src/lib/index.ts", barrel),
            FileRevision::added("src/lib/a.test.ts", "export function helper() { return 1; }"),
        ]);
        assert!(run_orphan(&changes, &index, None).findings.is_empty());
    }

    #[test]
    fn a_non_exported_symbol_is_not_a_candidate() {
        let source = "function internalOnly() { return 1; }";
        let index = index_from_sources(&[("src/lib/util.ts", source)]);
        let changes = changed_symbols(&[FileRevision::added("src/lib/util.ts", source)]);
        assert!(run_orphan(&changes, &index, None).findings.is_empty());
    }

    #[test]
    fn the_text_pass_rescues_a_name_used_only_in_a_string() {
        let root = crate::verify::context::build::testutil::TempRepo::new("orphan-text");
        root.write("src/lib/util.ts", "export function parseFooBar(x) { return x; }");
        // A name reachable only through a string literal — invisible to the
        // identifier index, obvious to a byte scan.
        root.write("src/registry.ts", "export const handlers = { \"parseFooBar\": 1 };");

        let index = index_from_sources(&[
            ("src/lib/util.ts", "export function parseFooBar(x) { return x; }"),
            ("src/registry.ts", "export const handlers = { \"parseFooBar\": 1 };"),
        ]);
        let changes = changed_symbols(&[FileRevision::added(
            "src/lib/util.ts",
            "export function parseFooBar(x) { return x; }",
        )]);

        assert_eq!(
            run_orphan(&changes, &index, None).findings.len(),
            1,
            "without the text pass the string reference is missed"
        );
        assert!(
            run_orphan(&changes, &index, Some(root.root()))
                .findings
                .is_empty(),
            "the text pass must suppress it"
        );
    }

    // ── V9 ───────────────────────────────────────────────────────────────

    fn caller_index() -> RepoIndex {
        index_from_sources(&[
            (
                "src/api/user.ts",
                "export function fetchUser(id: string) { return id; }",
            ),
            (
                "src/api/queries.ts",
                "import { fetchUser } from \"./user\";\nexport function useUser(id: string) {\n  return fetchUser(id);\n}\n",
            ),
            (
                "src/stores/repository.ts",
                "import { fetchUser } from \"../api/user\";\nexport function load(id: string) {\n  return fetchUser(id);\n}\n",
            ),
        ])
    }

    fn signature_change(paths: &[(&str, &str, &str)]) -> ChangeSet {
        let revisions: Vec<FileRevision> = paths
            .iter()
            .map(|(path, old, new)| FileRevision::modified(*path, *old, *new))
            .collect();
        changed_symbols(&revisions)
    }

    #[test]
    fn call_sites_are_listed_with_their_enclosing_symbol() {
        let changes = signature_change(&[(
            "src/api/user.ts",
            "export function fetchUser(id: string) { return id; }",
            "export function fetchUser(id: string, force: boolean) { return id; }",
        )]);
        let entries = blast_radius(&changes, &caller_index());
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.symbol, "fetchUser");
        assert_eq!(entry.resolution, CallerResolution::NameUnique);
        assert_eq!(entry.caller_count, 2);
        assert_eq!(entry.untouched_caller_count, 2);
        assert!(entry
            .callers
            .iter()
            .any(|site| site.file == "src/api/queries.ts"
                && site.symbol.as_deref() == Some("useUser")
                && !site.touched_in_diff));
    }

    #[test]
    fn a_signature_change_with_untouched_callers_produces_a_finding() {
        let changes = signature_change(&[(
            "src/api/user.ts",
            "export function fetchUser(id: string) { return id; }",
            "export function fetchUser(id: string, force: boolean) { return id; }",
        )]);
        let outcome = run_blast_radius(&changes, &caller_index());
        assert_eq!(outcome.findings.len(), 1);
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, "v9.blastRadius");
        assert!(finding.message.contains("2 caller(s)"));
        assert!(finding.message.contains("2 in files this change does not touch"));
    }

    #[test]
    fn a_signature_change_whose_callers_were_all_updated_is_silent() {
        let changes = signature_change(&[
            (
                "src/api/user.ts",
                "export function fetchUser(id: string) { return id; }",
                "export function fetchUser(id: string, force: boolean) { return id; }",
            ),
            (
                "src/api/queries.ts",
                "import { fetchUser } from \"./user\";\nexport function useUser(id: string) {\n  return fetchUser(id);\n}\n",
                "import { fetchUser } from \"./user\";\nexport function useUser(id: string) {\n  return fetchUser(id, true);\n}\n",
            ),
            (
                "src/stores/repository.ts",
                "import { fetchUser } from \"../api/user\";\nexport function load(id: string) {\n  return fetchUser(id);\n}\n",
                "import { fetchUser } from \"../api/user\";\nexport function load(id: string) {\n  return fetchUser(id, false);\n}\n",
            ),
        ]);
        let outcome = run_blast_radius(&changes, &caller_index());
        assert!(
            outcome.findings.is_empty(),
            "every caller was updated: {:?}",
            outcome.findings
        );
        assert!(outcome.checked.contains(&"v9.blastRadius".to_string()));
    }

    #[test]
    fn two_definitions_of_a_name_make_the_resolution_ambiguous() {
        let mut index = caller_index();
        for file in index_from_sources(&[(
            "src/legacy/user.ts",
            "export function fetchUser(id: string) { return id; }",
        )])
        .files()
        {
            index.insert(file.clone());
        }
        let changes = signature_change(&[(
            "src/api/user.ts",
            "export function fetchUser(id: string) { return id; }",
            "export function fetchUser(id: string, force: boolean) { return id; }",
        )]);
        let entries = blast_radius(&changes, &index);
        assert_eq!(
            entries[0].resolution,
            CallerResolution::NameAmbiguous { definitions: 2 }
        );
        let outcome = run_blast_radius(&changes, &index);
        assert!(outcome.findings[0].message.contains("name is ambiguous"));
    }

    #[test]
    fn no_signature_change_means_the_rule_is_not_applicable() {
        let changes = changed_symbols(&[]);
        let outcome = run_blast_radius(&changes, &caller_index());
        assert!(outcome.findings.is_empty());
        assert!(outcome.checked.is_empty());
        assert!(outcome
            .limits
            .iter()
            .any(|limit| limit.reason == UncheckedReason::NotApplicable));
    }
}
