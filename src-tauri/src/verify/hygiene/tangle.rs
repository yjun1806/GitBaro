//! V31 — tangled-commit detection.
//!
//! The user-facing purpose is **"this commit cannot be reverted cleanly"**, not
//! style policing. The score is a deterministic sum of four independent
//! heuristics over the changed path set plus the conventional-commit header:
//!
//! | Signal | Question |
//! |---|---|
//! | file count | is this beyond the 1–5 files of an atomic commit? |
//! | area dispersion | how many distinct top-level areas are touched? |
//! | concern mix | do unrelated kinds of files (code / docs / ci / config) share the commit? |
//! | type mismatch | does the declared `type:` match the kinds of files actually touched? |
//!
//! Pure string logic — no git2, no IO. The path list comes from
//! [`super::commit_changed_paths`].

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::verify::types::{Finding, FindingKind};

use super::truncate_detail;

/// A commit at or above this score is reported as tangled.
pub const TANGLE_THRESHOLD: u8 = 50;

/// Area label used for files that sit at the repository root.
const ROOT_AREA: &str = "<root>";

/// Path segments that only group code and therefore never identify an area on
/// their own — the area is the segment (or segments) below them.
const CONTAINER_SEGMENTS: &[&str] = &[
    "src",
    "src-tauri",
    "lib",
    "libs",
    "app",
    "apps",
    "packages",
    "crates",
    "modules",
    "pkg",
    "internal",
    "cmd",
];

/// What kind of file a path is, judged by path only.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum FileCategory {
    Source,
    Test,
    Docs,
    Config,
    Ci,
    Asset,
    Other,
}

impl FileCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            FileCategory::Source => "source",
            FileCategory::Test => "test",
            FileCategory::Docs => "docs",
            FileCategory::Config => "config",
            FileCategory::Ci => "ci",
            FileCategory::Asset => "asset",
            FileCategory::Other => "other",
        }
    }

    /// Categories collapse into concern groups before the mix is scored:
    /// source + test are one concern (a feature and its tests belong together).
    fn concern_group(&self) -> &'static str {
        match self {
            FileCategory::Source | FileCategory::Test => "code",
            other => other.as_str(),
        }
    }
}

/// Why a commit scored the way it did. Every variant carries its evidence.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TangleReason {
    #[serde(rename_all = "camelCase")]
    ManyFiles { count: usize },
    #[serde(rename_all = "camelCase")]
    DispersedAreas { areas: Vec<String> },
    #[serde(rename_all = "camelCase")]
    MixedConcerns { groups: Vec<String> },
    #[serde(rename_all = "camelCase")]
    TypeMismatch {
        declared: String,
        unexpected: Vec<FileCategory>,
    },
}

impl TangleReason {
    /// One factual English clause. Not translated — the frontend renders titles
    /// from `rule_id` i18n keys and quotes this as evidence.
    pub fn describe(&self) -> String {
        match self {
            TangleReason::ManyFiles { count } => {
                format!("{} files changed", count)
            }
            TangleReason::DispersedAreas { areas } => {
                format!("{} areas touched: {}", areas.len(), areas.join(", "))
            }
            TangleReason::MixedConcerns { groups } => {
                format!("unrelated concerns in one commit: {}", groups.join(", "))
            }
            TangleReason::TypeMismatch {
                declared,
                unexpected,
            } => format!(
                "declared `{}:` but also changes {}",
                declared,
                unexpected
                    .iter()
                    .map(|c| c.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
}

/// Deterministic tangle assessment of one commit.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TangleScore {
    /// 0..=100. Clamped sum of the four heuristics.
    pub score: u8,
    pub is_tangled: bool,
    pub files_changed: usize,
    /// Distinct areas, sorted.
    pub areas: Vec<String>,
    /// Distinct categories present, sorted.
    pub categories: Vec<FileCategory>,
    /// Conventional-commit type from the subject, if the subject has one.
    pub declared_type: Option<String>,
    pub reasons: Vec<TangleReason>,
}

/// Score a commit for mixed concerns.
pub fn score_tangle(message: &str, paths: &[String]) -> TangleScore {
    let files_changed = paths.len();
    let areas: Vec<String> = paths
        .iter()
        .map(|p| area_of(p))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let categories: Vec<FileCategory> = paths
        .iter()
        .map(|p| classify(p))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let groups: Vec<String> = categories
        .iter()
        .map(|c| c.concern_group().to_string())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let declared_type = conventional_type(message.lines().next().unwrap_or(""));

    let mut reasons = Vec::new();
    let mut total: u32 = 0;

    total += match files_changed {
        0..=4 => 0,
        5..=7 => 10,
        8..=14 => 25,
        _ => 40,
    };
    if files_changed >= 8 {
        reasons.push(TangleReason::ManyFiles {
            count: files_changed,
        });
    }

    total += match areas.len() {
        0..=1 => 0,
        2 => 10,
        3 => 20,
        4 => 28,
        _ => 35,
    };
    if areas.len() >= 3 {
        reasons.push(TangleReason::DispersedAreas {
            areas: areas.clone(),
        });
    }

    total += match groups.len() {
        0..=1 => 0,
        2 => 5,
        3 => 15,
        _ => 25,
    };
    if groups.len() >= 3 {
        reasons.push(TangleReason::MixedConcerns {
            groups: groups.clone(),
        });
    }

    if let Some(declared) = declared_type.as_deref() {
        let unexpected = unexpected_categories(declared, &categories);
        if !unexpected.is_empty() {
            total += 10 + 10 * unexpected.len().min(2) as u32;
            reasons.push(TangleReason::TypeMismatch {
                declared: declared.to_string(),
                unexpected,
            });
        }
    }

    let score = total.min(100) as u8;
    TangleScore {
        score,
        is_tangled: score >= TANGLE_THRESHOLD,
        files_changed,
        areas,
        categories,
        declared_type,
        reasons,
    }
}

/// `v31.tangledCommit` finding for an already-scored commit.
pub fn tangle_finding(score: &TangleScore) -> Finding {
    let detail = score
        .reasons
        .iter()
        .map(|r| r.describe())
        .collect::<Vec<_>>()
        .join("; ");
    Finding::new(
        FindingKind::TangledCommit,
        "",
        format!(
            "{} files across {} area(s), {} file kind(s) — tangle score {}/100",
            score.files_changed,
            score.areas.len(),
            score.categories.len(),
            score.score
        ),
    )
    .with_detail(truncate_detail(&detail))
}

/// The area a path belongs to: the shallowest segment prefix that is not purely
/// a container. `src-tauri/src/verify/hygiene.rs` → `src-tauri/src/verify`.
fn area_of(path: &str) -> String {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() <= 1 {
        return ROOT_AREA.to_string();
    }
    let last = segments.len() - 1;
    let mut i = 0;
    // Descend past container segments while at least one directory remains
    // between the candidate area and the file name.
    while i + 2 <= last && CONTAINER_SEGMENTS.contains(&segments[i]) {
        i += 1;
    }
    segments[..=i].join("/")
}

/// Classify a path. Order matters: CI wins over config (a workflow file is
/// both), tests win over source, docs win over asset.
fn classify(path: &str) -> FileCategory {
    let lower = path.to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower).to_string();
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");

    if is_ci(&lower, &name) {
        return FileCategory::Ci;
    }
    if is_test(&lower) {
        return FileCategory::Test;
    }
    if is_docs(&lower, &name, ext) {
        return FileCategory::Docs;
    }
    if matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "ico" | "icns" | "woff" | "woff2"
            | "ttf" | "otf" | "mp4" | "pdf"
    ) {
        return FileCategory::Asset;
    }
    if is_config(&name, ext) {
        return FileCategory::Config;
    }
    if matches!(
        ext,
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "rs" | "css" | "scss" | "html" | "svelte"
            | "vue" | "py" | "go" | "java" | "kt" | "rb" | "swift" | "sh" | "sql"
    ) {
        return FileCategory::Source;
    }
    FileCategory::Other
}

fn is_ci(lower: &str, name: &str) -> bool {
    lower.starts_with(".github/workflows/")
        || lower.contains("/.github/workflows/")
        || lower.starts_with(".github/actions/")
        || lower.starts_with(".circleci/")
        || lower.starts_with(".husky/")
        || matches!(
            name,
            ".gitlab-ci.yml" | "jenkinsfile" | "azure-pipelines.yml" | ".travis.yml"
        )
}

fn is_test(lower: &str) -> bool {
    lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.contains("__tests__/")
        || lower.contains("/tests/")
        || lower.starts_with("tests/")
        || lower.ends_with("_test.rs")
        || lower.ends_with("_test.go")
        || lower.ends_with("_test.py")
        || lower.starts_with("test/")
        || lower.contains("/test/")
}

fn is_docs(lower: &str, name: &str, ext: &str) -> bool {
    matches!(ext, "md" | "mdx" | "rst" | "adoc" | "txt")
        || lower.starts_with("docs/")
        || lower.contains("/docs/")
        || matches!(name, "license" | "changelog" | "readme" | "authors" | "notice")
}

fn is_config(name: &str, ext: &str) -> bool {
    matches!(
        ext,
        "json" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" | "lock" | "env" | "plist"
            | "properties"
    ) || name.starts_with('.')
        || matches!(name, "makefile" | "dockerfile" | "procfile")
}

/// Parse the type out of a conventional-commit subject: `type(scope)!: subject`.
fn conventional_type(subject: &str) -> Option<String> {
    let colon = subject.find(':')?;
    let head = subject[..colon].trim();
    let head = head.strip_suffix('!').unwrap_or(head);
    let ty = match head.find('(') {
        Some(paren) => {
            if !head.ends_with(')') {
                return None;
            }
            &head[..paren]
        }
        None => head,
    };
    if ty.is_empty() || !ty.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some(ty.to_ascii_lowercase())
}

/// Categories that do not belong in a commit of the declared type.
/// `Other` is always tolerated, and unknown types opt out entirely.
fn unexpected_categories(declared: &str, present: &[FileCategory]) -> Vec<FileCategory> {
    use FileCategory::*;
    let allowed: &[FileCategory] = match declared {
        // Dependency bumps ride along with features and fixes often enough that
        // Config must not be a mismatch signal here.
        "feat" | "fix" | "perf" | "refactor" | "style" => &[Source, Test, Config, Other],
        "docs" => &[Docs, Other],
        "test" => &[Test, Config, Other],
        "ci" => &[Ci, Config, Other],
        "build" => &[Config, Ci, Other],
        // `chore` is the declared catch-all; nothing can mismatch it.
        "chore" | "revert" => return Vec::new(),
        _ => return Vec::new(),
    };
    present
        .iter()
        .filter(|c| !allowed.contains(c))
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn atomic_commit_scores_zero() {
        let score = score_tangle(
            "feat(branch): add compare view",
            &paths(&[
                "src/components/branch/BranchCompare.tsx",
                "src/components/branch/BranchList.tsx",
                "src/components/branch/BranchCompare.test.tsx",
            ]),
        );
        assert_eq!(score.score, 0);
        assert!(!score.is_tangled);
        assert!(score.reasons.is_empty());
        assert_eq!(score.declared_type.as_deref(), Some("feat"));
    }

    #[test]
    fn tangled_commit_scores_high_and_names_every_reason() {
        let score = score_tangle(
            "feat(verify): add verification subsystem",
            &paths(&[
                "src/components/verify/VerifyPanel.tsx",
                "src/stores/verify.ts",
                "src-tauri/src/verify/hygiene.rs",
                "src-tauri/src/commands/verify.rs",
                "docs/verify-contract.md",
                "README.md",
                ".github/workflows/ci.yml",
                "package.json",
                "public/logo.svg",
            ]),
        );
        assert!(score.is_tangled, "score was {}", score.score);
        assert!(score
            .reasons
            .iter()
            .any(|r| matches!(r, TangleReason::ManyFiles { .. })));
        assert!(score
            .reasons
            .iter()
            .any(|r| matches!(r, TangleReason::DispersedAreas { .. })));
        assert!(score
            .reasons
            .iter()
            .any(|r| matches!(r, TangleReason::MixedConcerns { .. })));
        assert!(score
            .reasons
            .iter()
            .any(|r| matches!(r, TangleReason::TypeMismatch { .. })));
    }

    #[test]
    fn threshold_boundary_is_exactly_fifty() {
        // 15 files (40) + 2 areas (10) + 1 concern group (0) + no mismatch = 50.
        let mut list: Vec<String> = (0..14)
            .map(|i| format!("src/components/branch/File{}.tsx", i))
            .collect();
        list.push("src/stores/branch.ts".to_string());
        let score = score_tangle("feat(branch): big change", &list);
        assert_eq!(score.files_changed, 15);
        assert_eq!(score.areas.len(), 2);
        assert_eq!(score.score, TANGLE_THRESHOLD);
        assert!(score.is_tangled);

        // One file fewer drops to 14 files (25) + 10 = 35.
        let score = score_tangle("feat(branch): big change", &list[..14]);
        assert_eq!(score.score, 25);
        assert!(!score.is_tangled);
    }

    #[test]
    fn source_and_tests_are_one_concern_group() {
        let score = score_tangle(
            "feat(diff): add markdown engine",
            &paths(&["src/lib/md.ts", "src/lib/md.test.ts"]),
        );
        assert_eq!(score.categories.len(), 2);
        assert!(score.reasons.is_empty());
        assert_eq!(score.score, 0);
    }

    #[test]
    fn docs_commit_touching_source_is_a_type_mismatch() {
        let score = score_tangle(
            "docs: update README",
            &paths(&["README.md", "src/lib/utils.ts"]),
        );
        let mismatch = score
            .reasons
            .iter()
            .find_map(|r| match r {
                TangleReason::TypeMismatch { unexpected, .. } => Some(unexpected.clone()),
                _ => None,
            })
            .expect("docs: touching source must mismatch");
        assert_eq!(mismatch, vec![FileCategory::Source]);
    }

    #[test]
    fn chore_never_mismatches_and_unknown_types_opt_out() {
        let files = paths(&["README.md", "src/lib/utils.ts", ".github/workflows/ci.yml"]);
        for subject in ["chore: tidy up", "wip stuff", "Merge branch 'main'"] {
            let score = score_tangle(subject, &files);
            assert!(
                !score
                    .reasons
                    .iter()
                    .any(|r| matches!(r, TangleReason::TypeMismatch { .. })),
                "subject {:?} must not mismatch",
                subject
            );
        }
    }

    #[test]
    fn feature_with_a_dependency_bump_is_not_a_mismatch() {
        let score = score_tangle(
            "feat(auth): use gh cli",
            &paths(&["src/api/auth.ts", "package.json"]),
        );
        assert!(!score
            .reasons
            .iter()
            .any(|r| matches!(r, TangleReason::TypeMismatch { .. })));
    }

    #[test]
    fn classifies_paths_by_kind() {
        assert_eq!(classify(".github/workflows/ci.yml"), FileCategory::Ci);
        assert_eq!(classify("src/lib/utils.test.ts"), FileCategory::Test);
        assert_eq!(classify("src-tauri/src/git/cli_test.rs"), FileCategory::Test);
        assert_eq!(classify("docs/plan.md"), FileCategory::Docs);
        assert_eq!(classify("LICENSE"), FileCategory::Docs);
        assert_eq!(classify("package.json"), FileCategory::Config);
        assert_eq!(classify(".eslintrc"), FileCategory::Config);
        assert_eq!(classify("src/main.tsx"), FileCategory::Source);
        assert_eq!(classify("public/icon.png"), FileCategory::Asset);
        assert_eq!(classify("bin/tool"), FileCategory::Other);
    }

    #[test]
    fn area_descends_past_nested_container_segments() {
        assert_eq!(area_of("README.md"), ROOT_AREA);
        assert_eq!(area_of("src/main.tsx"), "src");
        assert_eq!(area_of("src/components/branch/List.tsx"), "src/components");
        assert_eq!(
            area_of("src-tauri/src/verify/hygiene.rs"),
            "src-tauri/src/verify"
        );
        assert_eq!(area_of(".github/workflows/ci.yml"), ".github");
    }

    #[test]
    fn parses_conventional_commit_types() {
        assert_eq!(conventional_type("feat: x").as_deref(), Some("feat"));
        assert_eq!(conventional_type("feat(diff): x").as_deref(), Some("feat"));
        assert_eq!(conventional_type("feat(diff)!: x").as_deref(), Some("feat"));
        assert_eq!(conventional_type("FIX: x").as_deref(), Some("fix"));
        assert_eq!(conventional_type("no colon here"), None);
        assert_eq!(conventional_type("feat(diff: x"), None);
        assert_eq!(conventional_type("v1.2.3: release"), None);
    }

    #[test]
    fn empty_change_set_is_not_tangled() {
        let score = score_tangle("chore: empty", &[]);
        assert_eq!(score.score, 0);
        assert!(!score.is_tangled);
        assert!(score.areas.is_empty());
    }
}
