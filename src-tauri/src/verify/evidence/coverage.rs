//! V12 — diff coverage: locate a coverage report, parse it, and project it onto
//! the lines a diff added.
//!
//! **Honesty rules baked into this module** (spec §7-①, §P3):
//!
//! - A missing report is *not* "no problem". It produces
//!   [`CoverageStatus::Missing`] and every changed file lands in
//!   `unmapped_files`, so the caller must report the rule as unchecked.
//! - Only *instrumented* added lines are counted. A blank line, a comment or a
//!   type-only declaration never appears in a coverage report; calling those
//!   "uncovered" would manufacture false positives. Therefore
//!   `added_lines == covered_added_lines + uncovered_added_lines.len()` always
//!   holds, and `added_lines` means "added lines the coverage tool instrumented".
//! - Coverage proves a line *executed*, never that it was *verified*. The UI
//!   must show V3 (test quality) alongside it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::Utc;

use crate::git::engine::DiffOutput;
use crate::verify::types::{CoverageResult, DiffCoverage};

use super::istanbul;
use super::lcov;
use super::model::{CoverageReport, FileCoverage};

/// Conventional report locations, in probe order.
const REPORT_CANDIDATES: [&str; 3] = [
    "coverage/lcov.info",
    "lcov.info",
    "coverage/coverage-final.json",
];

// ── Lookup outcome (internal — never serialized) ─────────────────────────────

/// Why the coverage result looks the way it does. The command layer maps this
/// onto `ScanLimit`: `Missing` -> `MissingArtifact`, `ParseFailed` ->
/// `ParseFailed`, `Parsed` -> the rule counts as checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoverageStatus {
    Missing,
    ParseFailed(String),
    Parsed,
}

#[derive(Clone, Debug)]
pub struct CoverageLookup {
    pub status: CoverageStatus,
    pub result: CoverageResult,
}

// ── Public API ───────────────────────────────────────────────────────────────

/// First conventional coverage report that exists under `repo_path`.
pub fn find_coverage_report(repo_path: &Path) -> Option<PathBuf> {
    REPORT_CANDIDATES
        .iter()
        .map(|candidate| repo_path.join(candidate))
        .find(|path| path.is_file())
}

/// Added (`+`) line numbers per file, in new-file coordinates. Binary files and
/// files without additions are dropped — there is nothing to judge there.
pub fn added_lines_from_diff(diff: &DiffOutput) -> Vec<(String, Vec<u32>)> {
    diff.files
        .iter()
        .filter(|file| !file.is_binary)
        .filter_map(|file| {
            let path = file.new_path.clone()?;
            let lines: Vec<u32> = file
                .hunks
                .iter()
                .flat_map(|hunk| hunk.lines.iter())
                .filter(|line| line.origin == '+')
                .filter_map(|line| line.new_lineno)
                .collect();
            if lines.is_empty() {
                None
            } else {
                Some((path, lines))
            }
        })
        .collect()
}

/// Projects a coverage report onto a diff. Never fails: a missing or unusable
/// report yields an empty `files` list with every changed path in
/// `unmapped_files` plus a non-`Parsed` status.
pub fn coverage_for_diff(
    repo_path: &Path,
    diff: &DiffOutput,
    coverage_path: Option<&str>,
) -> CoverageLookup {
    let added = added_lines_from_diff(diff);
    let all_paths: Vec<String> = added.iter().map(|(path, _)| path.clone()).collect();

    let report_path = match coverage_path.map(str::trim).filter(|p| !p.is_empty()) {
        Some(explicit) => resolve_report_path(repo_path, explicit),
        None => find_coverage_report(repo_path),
    };
    let Some(report_path) = report_path else {
        return lookup_without_data(CoverageStatus::Missing, String::new(), all_paths);
    };

    let source = relative_to(repo_path, &report_path);
    let text = match std::fs::read_to_string(&report_path) {
        Ok(text) => text,
        Err(err) => {
            return lookup_without_data(
                CoverageStatus::ParseFailed(err.to_string()),
                source,
                all_paths,
            )
        }
    };

    let is_json = report_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"));
    let report = if is_json {
        match istanbul::parse_istanbul(&text) {
            Ok(report) => report,
            Err(err) => {
                return lookup_without_data(
                    CoverageStatus::ParseFailed(err.to_string()),
                    source,
                    all_paths,
                )
            }
        }
    } else {
        lcov::parse_lcov(&text)
    };

    if report.files.is_empty() {
        return lookup_without_data(
            CoverageStatus::ParseFailed("no coverage records found".to_string()),
            source,
            all_paths,
        );
    }

    let (files, unmapped_files) = map_added_lines(&report, repo_path, &added);
    CoverageLookup {
        status: CoverageStatus::Parsed,
        result: CoverageResult {
            source,
            parsed_at: Utc::now().timestamp_millis(),
            files,
            unmapped_files,
        },
    }
}

/// Pure projection step, split out so it can be tested without touching disk.
pub fn map_added_lines(
    report: &CoverageReport,
    repo_root: &Path,
    added: &[(String, Vec<u32>)],
) -> (Vec<DiffCoverage>, Vec<String>) {
    let index: BTreeMap<String, &FileCoverage> = report
        .files
        .values()
        .map(|file| (normalize_path(&file.path, repo_root), file))
        .collect();

    let mut files = Vec::new();
    let mut unmapped = Vec::new();

    for (path, lines) in added {
        let Some(file) = lookup(&index, &normalize_path(path, repo_root)) else {
            unmapped.push(path.clone());
            continue;
        };

        let mut instrumented = 0u32;
        let mut covered = 0u32;
        let mut uncovered = Vec::new();
        for &line in lines {
            match file.lines.get(&line).copied() {
                // Not instrumented (blank line, comment, type-only decl) —
                // silence is not evidence of absence of tests.
                None => {}
                Some(0) => {
                    instrumented += 1;
                    uncovered.push(line);
                }
                Some(_) => {
                    instrumented += 1;
                    covered += 1;
                }
            }
        }

        files.push(DiffCoverage {
            path: path.clone(),
            added_lines: instrumented,
            covered_added_lines: covered,
            uncovered_added_lines: uncovered,
        });
    }

    (files, unmapped)
}

// ── Internals ────────────────────────────────────────────────────────────────

fn lookup_without_data(
    status: CoverageStatus,
    source: String,
    unmapped_files: Vec<String>,
) -> CoverageLookup {
    CoverageLookup {
        status,
        result: CoverageResult {
            source,
            parsed_at: Utc::now().timestamp_millis(),
            files: Vec::new(),
            unmapped_files,
        },
    }
}

/// Exact match first, then a unique path-suffix match (monorepo reports often
/// carry a package prefix). An ambiguous suffix resolves to nothing —
/// mis-attributed coverage is worse than none.
fn lookup<'a>(index: &BTreeMap<String, &'a FileCoverage>, path: &str) -> Option<&'a FileCoverage> {
    if let Some(file) = index.get(path) {
        return Some(file);
    }
    let suffix = format!("/{}", path);
    let mut found: Option<&'a FileCoverage> = None;
    for (key, file) in index {
        if key.ends_with(&suffix) {
            if found.is_some() {
                return None;
            }
            found = Some(file);
        }
    }
    found
}

/// Makes a report path comparable with repo-relative diff paths.
fn normalize_path(path: &str, repo_root: &Path) -> String {
    let unified = path.replace('\\', "/");
    let root = repo_root.to_string_lossy().replace('\\', "/");
    let root = root.trim_end_matches('/');
    let stripped = if !root.is_empty() {
        unified
            .strip_prefix(&format!("{}/", root))
            .unwrap_or(&unified)
    } else {
        &unified
    };
    stripped.trim_start_matches("./").to_string()
}

fn relative_to(repo_root: &Path, path: &Path) -> String {
    path.strip_prefix(repo_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// A caller-supplied report path must resolve to a real file inside the
/// repository. Anything else is treated as "no report" rather than read.
fn resolve_report_path(repo_path: &Path, candidate: &str) -> Option<PathBuf> {
    let joined = if Path::new(candidate).is_absolute() {
        PathBuf::from(candidate)
    } else {
        repo_path.join(candidate)
    };
    let resolved = joined.canonicalize().ok()?;
    let root = repo_path.canonicalize().ok()?;
    if !resolved.starts_with(&root) {
        tracing::warn!("[verify] coverage path resolves outside the repository, ignoring");
        return None;
    }
    resolved.is_file().then_some(resolved)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::TempDir;
    use super::*;
    use crate::git::engine::{DiffHunk, DiffLine, FileDiff};

    fn report_with(path: &str, lines: &[(u32, u64)]) -> CoverageReport {
        let mut file = FileCoverage::new(path);
        for &(line, hits) in lines {
            file.add_line(line, hits);
        }
        let mut report = CoverageReport::default();
        report.merge(file);
        report
    }

    fn diff_line(origin: char, new_lineno: Option<u32>) -> DiffLine {
        DiffLine {
            origin,
            content: String::new(),
            old_lineno: None,
            new_lineno,
        }
    }

    #[test]
    fn extracts_added_line_numbers_only() {
        let diff = DiffOutput {
            files: vec![FileDiff {
                old_path: Some("src/a.ts".into()),
                new_path: Some("src/a.ts".into()),
                is_binary: false,
                hunks: vec![DiffHunk {
                    header: "@@".into(),
                    old_start: 1,
                    old_lines: 1,
                    new_start: 1,
                    new_lines: 3,
                    lines: vec![
                        diff_line(' ', Some(1)),
                        diff_line('+', Some(2)),
                        diff_line('-', None),
                        diff_line('+', Some(3)),
                    ],
                }],
            }],
        };
        assert_eq!(
            added_lines_from_diff(&diff),
            vec![("src/a.ts".to_string(), vec![2, 3])]
        );
    }

    #[test]
    fn skips_binary_files_and_files_without_additions() {
        let diff = DiffOutput {
            files: vec![
                FileDiff {
                    old_path: None,
                    new_path: Some("logo.png".into()),
                    is_binary: true,
                    hunks: vec![],
                },
                FileDiff {
                    old_path: Some("gone.ts".into()),
                    new_path: Some("gone.ts".into()),
                    is_binary: false,
                    hunks: vec![DiffHunk {
                        header: "@@".into(),
                        old_start: 1,
                        old_lines: 1,
                        new_start: 1,
                        new_lines: 0,
                        lines: vec![diff_line('-', None)],
                    }],
                },
            ],
        };
        assert!(added_lines_from_diff(&diff).is_empty());
    }

    #[test]
    fn counts_only_instrumented_added_lines() {
        let report = report_with("src/a.ts", &[(2, 4), (3, 0), (9, 1)]);
        let added = vec![("src/a.ts".to_string(), vec![1, 2, 3, 4])];
        let (files, unmapped) = map_added_lines(&report, Path::new("/repo"), &added);

        assert!(unmapped.is_empty());
        let entry = &files[0];
        // Lines 1 and 4 are not instrumented, so they are not judged at all.
        assert_eq!(entry.added_lines, 2);
        assert_eq!(entry.covered_added_lines, 1);
        assert_eq!(entry.uncovered_added_lines, vec![3]);
        assert_eq!(
            entry.added_lines as usize,
            entry.covered_added_lines as usize + entry.uncovered_added_lines.len()
        );
    }

    #[test]
    fn files_absent_from_the_report_are_unmapped_not_uncovered() {
        let report = report_with("src/a.ts", &[(1, 1)]);
        let added = vec![("src/b.ts".to_string(), vec![1, 2])];
        let (files, unmapped) = map_added_lines(&report, Path::new("/repo"), &added);
        assert!(files.is_empty());
        assert_eq!(unmapped, vec!["src/b.ts".to_string()]);
    }

    #[test]
    fn strips_the_repo_root_from_absolute_report_paths() {
        let report = report_with("/repo/src/a.ts", &[(5, 0)]);
        let added = vec![("src/a.ts".to_string(), vec![5])];
        let (files, unmapped) = map_added_lines(&report, Path::new("/repo"), &added);
        assert!(unmapped.is_empty());
        assert_eq!(files[0].uncovered_added_lines, vec![5]);
    }

    #[test]
    fn resolves_a_unique_path_suffix_but_refuses_an_ambiguous_one() {
        let mut unique = report_with("packages/web/src/a.ts", &[(1, 1)]);
        let added = vec![("src/a.ts".to_string(), vec![1])];
        let (files, unmapped) = map_added_lines(&unique, Path::new("/repo"), &added);
        assert!(unmapped.is_empty());
        assert_eq!(files[0].covered_added_lines, 1);

        unique.merge(FileCoverage::new("packages/api/src/a.ts"));
        let (files, unmapped) = map_added_lines(&unique, Path::new("/repo"), &added);
        assert!(files.is_empty());
        assert_eq!(unmapped, vec!["src/a.ts".to_string()]);
    }

    #[test]
    fn normalizes_dot_slash_and_backslash_prefixes() {
        assert_eq!(normalize_path("./src/a.ts", Path::new("/repo")), "src/a.ts");
        assert_eq!(
            normalize_path("src\\a.ts", Path::new("/repo")),
            "src/a.ts".to_string()
        );
        assert_eq!(normalize_path("/repo/src/a.ts", Path::new("/repo/")), "src/a.ts");
    }

    // ── discovery / end-to-end lookup ────────────────────────────────────────

    fn one_added_line(path: &str, line: u32) -> DiffOutput {
        DiffOutput {
            files: vec![FileDiff {
                old_path: Some(path.into()),
                new_path: Some(path.into()),
                is_binary: false,
                hunks: vec![DiffHunk {
                    header: "@@".into(),
                    old_start: 1,
                    old_lines: 0,
                    new_start: line,
                    new_lines: 1,
                    lines: vec![diff_line('+', Some(line))],
                }],
            }],
        }
    }

    #[test]
    fn probes_conventional_locations_in_order() {
        let dir = TempDir::new("coverage-order");
        dir.write("lcov.info", "SF:src/a.ts\nDA:1,1\nend_of_record\n");
        assert_eq!(
            find_coverage_report(dir.path()),
            Some(dir.path().join("lcov.info"))
        );

        dir.write("coverage/lcov.info", "SF:src/a.ts\nDA:1,1\nend_of_record\n");
        assert_eq!(
            find_coverage_report(dir.path()),
            Some(dir.path().join("coverage/lcov.info"))
        );
    }

    #[test]
    fn a_missing_report_is_reported_as_missing_with_everything_unmapped() {
        let dir = TempDir::new("coverage-missing");
        let lookup = coverage_for_diff(dir.path(), &one_added_line("src/a.ts", 4), None);
        assert_eq!(lookup.status, CoverageStatus::Missing);
        assert!(lookup.result.source.is_empty());
        assert!(lookup.result.files.is_empty());
        assert_eq!(lookup.result.unmapped_files, vec!["src/a.ts".to_string()]);
    }

    #[test]
    fn reads_an_lcov_report_from_disk() {
        let dir = TempDir::new("coverage-lcov");
        dir.write(
            "coverage/lcov.info",
            "SF:src/a.ts\nDA:4,0\nDA:5,2\nend_of_record\n",
        );
        let lookup = coverage_for_diff(dir.path(), &one_added_line("src/a.ts", 4), None);
        assert_eq!(lookup.status, CoverageStatus::Parsed);
        assert_eq!(lookup.result.source, "coverage/lcov.info");
        assert_eq!(lookup.result.files[0].uncovered_added_lines, vec![4]);
    }

    #[test]
    fn reads_an_istanbul_report_selected_by_extension() {
        let dir = TempDir::new("coverage-istanbul");
        dir.write(
            "coverage/coverage-final.json",
            r#"{ "src/a.ts": { "statementMap": { "0": { "start": { "line": 4 } } }, "s": { "0": 0 } } }"#,
        );
        let lookup = coverage_for_diff(dir.path(), &one_added_line("src/a.ts", 4), None);
        assert_eq!(lookup.status, CoverageStatus::Parsed);
        assert_eq!(lookup.result.files[0].uncovered_added_lines, vec![4]);
    }

    #[test]
    fn an_unparseable_report_is_parse_failed_not_a_finding() {
        let dir = TempDir::new("coverage-garbage");
        dir.write("coverage/lcov.info", "this file is not lcov at all\n");
        let lookup = coverage_for_diff(dir.path(), &one_added_line("src/a.ts", 4), None);
        assert!(matches!(lookup.status, CoverageStatus::ParseFailed(_)));
        assert!(lookup.result.files.is_empty());
        assert_eq!(lookup.result.unmapped_files, vec!["src/a.ts".to_string()]);
    }

    #[test]
    fn an_explicit_path_outside_the_repository_is_refused() {
        let repo = TempDir::new("coverage-repo");
        let outside = TempDir::new("coverage-outside");
        outside.write("lcov.info", "SF:src/a.ts\nDA:4,1\nend_of_record\n");
        let escape = outside.path().join("lcov.info");

        let lookup = coverage_for_diff(
            repo.path(),
            &one_added_line("src/a.ts", 4),
            Some(&escape.to_string_lossy()),
        );
        assert_eq!(lookup.status, CoverageStatus::Missing);
    }

    #[test]
    fn an_explicit_relative_path_inside_the_repository_is_used() {
        let dir = TempDir::new("coverage-explicit");
        dir.write("out/report.info", "SF:src/a.ts\nDA:4,3\nend_of_record\n");
        let lookup = coverage_for_diff(
            dir.path(),
            &one_added_line("src/a.ts", 4),
            Some("out/report.info"),
        );
        assert_eq!(lookup.status, CoverageStatus::Parsed);
        assert_eq!(lookup.result.files[0].covered_added_lines, 1);
    }
}
