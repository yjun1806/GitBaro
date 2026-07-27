// SPDX-License-Identifier: GPL-3.0-or-later
//! Rule input for the static diff rules (V2 · V3 · V5 · V6 · V10).
//!
//! Pure conversion — `DiffOutput` (from libgit2) or raw unified diff text turns
//! into a [`DiffContext`] that carries only what a literal-token rule needs.
//! Nothing here touches git2 or the filesystem, so every rule is unit-testable
//! from an inline diff fixture.

use std::path::{Path, PathBuf};

use crate::git::engine::{DiffOutput, FileDiff};
use crate::verify::types::{Finding, FindingKind, ScanLimit, UncheckedReason};

use super::unified::parse_unified_diff;

/// Per-file changed-line budget. A file above this is reported as
/// `BudgetExceeded` rather than scanned — honest under-reporting beats a stall.
pub const MAX_CHANGED_LINES: usize = 20_000;

/// How many skipped paths are named in a [`ScanLimit`] detail before eliding.
const MAX_NAMED_PATHS: usize = 5;

#[derive(Clone, Debug)]
pub struct DiffContext {
    pub repo_path: PathBuf,
    pub files: Vec<FileChange>,
    /// `None` for a working-tree scan.
    pub commit: Option<CommitContext>,
    /// Draft commit message from the commit panel on a working-tree scan (V6).
    pub draft_message: Option<String>,
}

#[derive(Clone, Debug)]
pub struct FileChange {
    /// New path; the old path when the file was deleted.
    pub path: String,
    pub old_path: Option<String>,
    pub change: ChangeKind,
    pub language: Language,
    /// Path-based verdict only (`.test.` / `.spec.` / `__tests__/` / `/tests/` /
    /// `_test.rs` / `tests/*.rs`). Rust inline `#[cfg(test)]` modules cannot be
    /// judged by path, so `has_cfg_test` supplements it.
    pub is_test: bool,
    pub has_cfg_test: bool,
    pub added: Vec<ChangedLine>,
    pub removed: Vec<ChangedLine>,
}

#[derive(Clone, Debug)]
pub struct ChangedLine {
    /// 1-based; new-file numbering for `added`, old-file numbering for `removed`.
    pub line_no: u32,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language {
    TypeScript,
    JavaScript,
    Rust,
    Other,
}

#[derive(Clone, Debug)]
pub struct CommitContext {
    pub oid: String,
    pub message: String,
    pub parent_ids: Vec<String>,
    pub author_email: String,
    /// `Key: Value` trailers (V35), keys kept in their original case.
    pub trailers: Vec<(String, String)>,
}

impl Language {
    /// Contract §0 / spec §7-⑤: the rule scope is TS/JS + Rust. Everything else
    /// is recorded as unchecked instead of being scanned badly.
    pub fn is_supported(self) -> bool {
        !matches!(self, Language::Other)
    }

    pub fn is_js_family(self) -> bool {
        matches!(self, Language::TypeScript | Language::JavaScript)
    }
}

impl FileChange {
    /// A file whose changed lines may contain test code.
    pub fn is_test_scope(&self) -> bool {
        self.is_test || self.has_cfg_test
    }

    pub fn changed_line_count(&self) -> usize {
        self.added.len() + self.removed.len()
    }
}

/// Build a [`DiffContext`] from a libgit2-produced diff. Pure and testable.
pub fn context_from_diff(
    repo_path: &Path,
    diff: &DiffOutput,
    commit: Option<CommitContext>,
    draft_message: Option<String>,
) -> DiffContext {
    let files = diff.files.iter().map(file_change_from_diff).collect();
    DiffContext {
        repo_path: repo_path.to_path_buf(),
        files,
        commit,
        draft_message,
    }
}

/// Build a [`DiffContext`] straight from unified diff text.
pub fn context_from_unified(
    repo_path: &Path,
    diff_text: &str,
    commit: Option<CommitContext>,
    draft_message: Option<String>,
) -> DiffContext {
    let diff = parse_unified_diff(diff_text);
    context_from_diff(repo_path, &diff, commit, draft_message)
}

fn file_change_from_diff(file: &FileDiff) -> FileChange {
    let path = file
        .new_path
        .clone()
        .or_else(|| file.old_path.clone())
        .unwrap_or_default();

    let mut added = Vec::new();
    let mut removed = Vec::new();
    for line in file.hunks.iter().flat_map(|h| h.lines.iter()) {
        match line.origin {
            '+' => added.push(ChangedLine {
                line_no: line.new_lineno.unwrap_or(0),
                text: line.content.clone(),
            }),
            '-' => removed.push(ChangedLine {
                line_no: line.old_lineno.unwrap_or(0),
                text: line.content.clone(),
            }),
            _ => {}
        }
    }

    // A binary file has no scannable source, whatever its extension says.
    let language = if file.is_binary {
        Language::Other
    } else {
        detect_language(&path)
    };
    let has_cfg_test = language == Language::Rust && has_rust_test_attribute(&added, &removed);

    FileChange {
        old_path: file
            .old_path
            .clone()
            .filter(|old| Some(old) != file.new_path.as_ref()),
        change: infer_change_kind(file),
        language,
        is_test: is_test_path(&path),
        has_cfg_test,
        added,
        removed,
        path,
    }
}

fn infer_change_kind(file: &FileDiff) -> ChangeKind {
    let has_hunks = !file.hunks.is_empty();
    let old_empty = has_hunks && file.hunks.iter().all(|h| h.old_lines == 0);
    let new_empty = has_hunks && file.hunks.iter().all(|h| h.new_lines == 0);

    if file.new_path.is_none() || new_empty {
        return ChangeKind::Deleted;
    }
    if file.old_path.is_none() || old_empty {
        return ChangeKind::Added;
    }
    match (&file.old_path, &file.new_path) {
        (Some(old), Some(new)) if old != new => ChangeKind::Renamed,
        _ => ChangeKind::Modified,
    }
}

pub fn detect_language(path: &str) -> Language {
    let ext = path.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    match ext {
        "ts" | "tsx" | "mts" | "cts" => Language::TypeScript,
        "js" | "jsx" | "mjs" | "cjs" => Language::JavaScript,
        "rs" => Language::Rust,
        _ => Language::Other,
    }
}

/// Path-only test detection — deliberately language-agnostic so that an
/// out-of-scope test file (`api_test.py`) still shows up as *unchecked* rather
/// than silently vanishing from the report.
pub fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let with_slash = format!("/{}", lower);
    lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.contains("_test.")
        // Segment-anchored so that `latest_value.ts` is not a test file.
        || with_slash.contains("/test_")
        || with_slash.contains("/__tests__/")
        || with_slash.contains("/tests/")
        || with_slash.contains("/test/")
        || with_slash.contains("/spec/")
}

/// A diff cannot show an inline `#[cfg(test)]` module that stays untouched, so
/// this only detects test attributes that appear *in the diff itself*.
fn has_rust_test_attribute(added: &[ChangedLine], removed: &[ChangedLine]) -> bool {
    added.iter().chain(removed.iter()).any(|line| {
        let t = line.text.trim_start();
        t.starts_with("#[cfg(test)]")
            || t.starts_with("#[test]")
            || t.starts_with("#[tokio::test]")
            || t.starts_with("#[rstest]")
            // `#[ignore]` only ever annotates a test, so it is itself evidence
            // that these changed lines sit inside a test module.
            || t.starts_with("#[ignore]")
            || t.starts_with("#[ignore =")
            || t.starts_with("#[ignore(")
    })
}

// ── Rule plumbing ────────────────────────────────────────────────────────────

/// What a single static diff rule returns.
#[derive(Debug, Default)]
pub struct RuleOutcome {
    pub findings: Vec<Finding>,
    pub limits: Vec<ScanLimit>,
    /// rule_ids actually evaluated against at least one target (partial counts).
    pub checked: Vec<String>,
}

impl RuleOutcome {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, finding: Finding) {
        self.findings.push(finding);
    }

    pub fn check(&mut self, kind: FindingKind) {
        let id = kind.rule_id().to_string();
        if !self.checked.contains(&id) {
            self.checked.push(id);
        }
    }

    pub fn limit(&mut self, kind: FindingKind, reason: UncheckedReason, detail: Option<String>) {
        self.limits.push(ScanLimit {
            rule_id: kind.rule_id().to_string(),
            reason,
            detail,
        });
    }

    /// Record coverage for every `kind` the caller evaluated over `scope`.
    /// This is the only place the `checked` / `limits` bookkeeping happens, so a
    /// rule cannot forget half of it (contract §9-①).
    pub fn account(&mut self, files: &Applicability, kinds: &[FindingKind]) {
        for &kind in kinds {
            if !files.scanned.is_empty() {
                self.check(kind);
            }
            if !files.unsupported.is_empty() {
                self.limit(
                    kind,
                    UncheckedReason::UnsupportedLanguage,
                    Some(describe_paths(
                        &files.unsupported,
                        "unsupported language or binary",
                    )),
                );
            }
            if !files.oversized.is_empty() {
                self.limit(
                    kind,
                    UncheckedReason::BudgetExceeded,
                    Some(describe_paths(
                        &files.oversized,
                        &format!("over {} changed lines", MAX_CHANGED_LINES),
                    )),
                );
            }
            if files.is_empty() {
                self.limit(
                    kind,
                    UncheckedReason::NotApplicable,
                    Some(format!("no {} in this diff", files.scope.describe())),
                );
            }
        }
    }
}

/// Which files a rule cares about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileScope {
    /// Any source file.
    Source,
    /// Test files only (path-based, plus Rust `#[cfg(test)]` evidence).
    Test,
}

impl FileScope {
    fn describe(self) -> &'static str {
        match self {
            FileScope::Source => "source files",
            FileScope::Test => "test files",
        }
    }

    fn is_candidate(self, file: &FileChange) -> bool {
        match self {
            FileScope::Source => true,
            FileScope::Test => file.is_test_scope(),
        }
    }
}

/// The files a rule may scan, plus the ones it must confess it skipped.
#[derive(Clone, Debug)]
pub struct Applicability {
    pub scope: FileScope,
    /// Indexes into `DiffContext::files`.
    pub scanned: Vec<usize>,
    pub unsupported: Vec<String>,
    pub oversized: Vec<String>,
}

impl Applicability {
    /// No candidate file at all — neither scanned nor skipped.
    pub fn is_empty(&self) -> bool {
        self.scanned.is_empty() && self.unsupported.is_empty() && self.oversized.is_empty()
    }

    pub fn files<'a>(&self, ctx: &'a DiffContext) -> Vec<&'a FileChange> {
        self.scanned.iter().map(|&i| &ctx.files[i]).collect()
    }
}

pub fn applicable_files(ctx: &DiffContext, scope: FileScope) -> Applicability {
    let mut result = Applicability {
        scope,
        scanned: Vec::new(),
        unsupported: Vec::new(),
        oversized: Vec::new(),
    };
    for (index, file) in ctx.files.iter().enumerate() {
        if !scope.is_candidate(file) {
            continue;
        }
        if !file.language.is_supported() {
            result.unsupported.push(file.path.clone());
        } else if file.changed_line_count() > MAX_CHANGED_LINES {
            result.oversized.push(file.path.clone());
        } else {
            result.scanned.push(index);
        }
    }
    result
}

fn describe_paths(paths: &[String], reason: &str) -> String {
    let shown: Vec<&str> = paths
        .iter()
        .take(MAX_NAMED_PATHS)
        .map(String::as_str)
        .collect();
    let suffix = if paths.len() > MAX_NAMED_PATHS {
        format!(", +{} more", paths.len() - MAX_NAMED_PATHS)
    } else {
        String::new()
    };
    format!(
        "{} file(s) skipped ({}): {}{}",
        paths.len(),
        reason,
        shown.join(", "),
        suffix
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(diff: &str) -> DiffContext {
        context_from_unified(Path::new("/repo"), diff, None, None)
    }

    #[test]
    fn added_line_numbers_are_new_file_based() {
        let c = ctx("\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -5,3 +5,4 @@
 keep
-old
+new
+extra
");
        let f = &c.files[0];
        assert_eq!(f.path, "src/a.ts");
        assert_eq!(f.language, Language::TypeScript);
        assert_eq!(
            f.added.iter().map(|l| l.line_no).collect::<Vec<_>>(),
            vec![6, 7]
        );
        assert_eq!(f.removed[0].line_no, 6);
        assert_eq!(f.change, ChangeKind::Modified);
    }

    #[test]
    fn change_kind_covers_add_delete_rename() {
        let c = ctx("\
diff --git a/new.rs b/new.rs
new file mode 100644
--- /dev/null
+++ b/new.rs
@@ -0,0 +1,1 @@
+fn a() {}
diff --git a/gone.rs b/gone.rs
deleted file mode 100644
--- a/gone.rs
+++ /dev/null
@@ -1,1 +0,0 @@
-fn b() {}
diff --git a/from.rs b/to.rs
rename from from.rs
rename to to.rs
");
        assert_eq!(c.files[0].change, ChangeKind::Added);
        assert_eq!(c.files[1].change, ChangeKind::Deleted);
        assert_eq!(c.files[1].path, "gone.rs");
        assert_eq!(c.files[2].change, ChangeKind::Renamed);
        assert_eq!(c.files[2].old_path.as_deref(), Some("from.rs"));
    }

    #[test]
    fn language_and_test_detection() {
        assert_eq!(detect_language("a/b.tsx"), Language::TypeScript);
        assert_eq!(detect_language("a/b.mjs"), Language::JavaScript);
        assert_eq!(detect_language("a/b.rs"), Language::Rust);
        assert_eq!(detect_language("a/b.py"), Language::Other);
        assert_eq!(detect_language("Makefile"), Language::Other);

        assert!(is_test_path("src/a.test.ts"));
        assert!(is_test_path("src/__tests__/a.ts"));
        assert!(is_test_path("tests/integration.rs"));
        assert!(is_test_path("src/api_test.rs"));
        assert!(is_test_path("py/test_api.py"));
        assert!(!is_test_path("src/latest.ts"));
        assert!(!is_test_path("src/latest_value.ts"));
        assert!(!is_test_path("src/components/Contest.tsx"));
    }

    #[test]
    fn binary_file_is_never_treated_as_source() {
        let c = ctx("\
diff --git a/a.ts b/a.ts
index 1..2 100644
Binary files a/a.ts and b/a.ts differ
");
        assert_eq!(c.files[0].language, Language::Other);
        assert!(!c.files[0].language.is_supported());
    }

    #[test]
    fn rust_cfg_test_attribute_marks_test_scope() {
        let c = ctx("\
diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,1 +1,3 @@
 fn a() {}
+#[cfg(test)]
+mod tests {}
");
        assert!(!c.files[0].is_test);
        assert!(c.files[0].has_cfg_test);
        assert!(c.files[0].is_test_scope());
    }

    #[test]
    fn applicability_separates_scanned_from_skipped() {
        let c = ctx("\
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-a
+b
diff --git a/b.py b/b.py
--- a/b.py
+++ b/b.py
@@ -1,1 +1,1 @@
-a
+b
");
        let app = applicable_files(&c, FileScope::Source);
        assert_eq!(app.scanned.len(), 1);
        assert_eq!(app.unsupported, vec!["b.py".to_string()]);
        assert!(!app.is_empty());

        let tests = applicable_files(&c, FileScope::Test);
        assert!(tests.is_empty());
    }

    #[test]
    fn describe_paths_elides_long_lists() {
        let paths: Vec<String> = (0..9).map(|i| format!("f{}.py", i)).collect();
        let text = describe_paths(&paths, "unsupported language");
        assert!(text.starts_with("9 file(s) skipped"));
        assert!(text.ends_with("+4 more"));
    }
}
