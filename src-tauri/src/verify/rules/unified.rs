// SPDX-License-Identifier: GPL-3.0-or-later
//! Unified diff text parser.
//!
//! The static rules must be testable from an inline diff fixture, so this
//! module turns raw `git diff` text into the same [`DiffOutput`] shape that
//! `git/diff.rs` produces from libgit2. Nothing here touches git2 or the
//! filesystem.
//!
//! Only what a rule needs is parsed: per-file change kind, hunk ranges and
//! line origins with 1-based line numbers. Everything else (index lines, mode
//! bits, similarity scores) is skipped.

use crate::git::engine::{DiffHunk, DiffLine, DiffOutput, FileDiff};

/// Parse unified diff text into [`DiffOutput`].
///
/// Malformed input never panics: unparsable sections are skipped, which makes
/// the affected file look like it had no changes rather than aborting the scan.
pub fn parse_unified_diff(text: &str) -> DiffOutput {
    let mut parser = Parser::default();
    for line in text.lines() {
        parser.feed(line);
    }
    parser.finish()
}

#[derive(Default)]
struct Parser {
    files: Vec<FileDiff>,
    current: Option<FileDiff>,
    /// Remaining old/new lines declared by the active hunk header.
    remaining_old: u32,
    remaining_new: u32,
    old_lineno: u32,
    new_lineno: u32,
    saw_old_header: bool,
}

impl Parser {
    fn feed(&mut self, line: &str) {
        if self.consumes_body(line) && self.consume_hunk_line(line) {
            return;
        }

        if let Some(rest) = line.strip_prefix("diff --git ") {
            self.start_file(git_header_paths(rest));
            return;
        }
        if line.starts_with("@@") {
            self.start_hunk(line);
            return;
        }
        if let Some(rest) = line.strip_prefix("--- ") {
            self.set_old_path(rest);
            return;
        }
        if let Some(rest) = line.strip_prefix("+++ ") {
            self.set_new_path(rest);
            return;
        }
        if line.starts_with("new file mode") {
            self.set_side(true, false);
            return;
        }
        if line.starts_with("deleted file mode") {
            self.set_side(false, true);
            return;
        }
        if let Some(rest) = line.strip_prefix("rename from ") {
            if let Some(f) = self.current.as_mut() {
                f.old_path = Some(strip_prefix_dir(rest));
            }
            return;
        }
        if let Some(rest) = line.strip_prefix("rename to ") {
            if let Some(f) = self.current.as_mut() {
                f.new_path = Some(strip_prefix_dir(rest));
            }
            return;
        }
        if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            if let Some(f) = self.current.as_mut() {
                f.is_binary = true;
            }
        }
    }

    fn in_hunk_body(&self) -> bool {
        self.remaining_old > 0 || self.remaining_new > 0
    }

    /// Whether `line` should be read as hunk content rather than as a header.
    ///
    /// Inside the range declared by the hunk header every line is content — that
    /// is what keeps a removed `--- old rule` from being mistaken for a file
    /// header. Once the declared range is exhausted we still accept `+`/`-`/` `
    /// lines (tolerating an under-counted header) but no longer shadow headers.
    fn consumes_body(&self, line: &str) -> bool {
        if self.in_hunk_body() {
            return true;
        }
        matches!(self.current.as_ref(), Some(f) if !f.hunks.is_empty())
            && matches!(line.chars().next(), Some('+') | Some('-') | Some(' '))
            && !line.starts_with("--- ")
            && !line.starts_with("+++ ")
    }

    /// Returns true when the line was consumed as hunk content.
    fn consume_hunk_line(&mut self, line: &str) -> bool {
        // A "\ No newline at end of file" marker belongs to the previous line
        // and consumes no budget.
        if line.starts_with('\\') {
            return true;
        }
        let (origin, content) = match line.chars().next() {
            Some('+') => ('+', &line[1..]),
            Some('-') => ('-', &line[1..]),
            Some(' ') => (' ', &line[1..]),
            // An empty line in a unified diff is an empty context line.
            None => (' ', ""),
            _ => return false,
        };

        let mut old_lineno = None;
        let mut new_lineno = None;
        if origin != '+' {
            old_lineno = Some(self.old_lineno);
            self.old_lineno += 1;
            self.remaining_old = self.remaining_old.saturating_sub(1);
        }
        if origin != '-' {
            new_lineno = Some(self.new_lineno);
            self.new_lineno += 1;
            self.remaining_new = self.remaining_new.saturating_sub(1);
        }

        if let Some(hunk) = self.current.as_mut().and_then(|f| f.hunks.last_mut()) {
            hunk.lines.push(DiffLine {
                origin,
                content: content.to_string(),
                old_lineno,
                new_lineno,
            });
        }
        true
    }

    fn start_file(&mut self, paths: Option<(String, String)>) {
        self.flush();
        let (old_path, new_path) = match paths {
            Some((a, b)) => (Some(a), Some(b)),
            None => (None, None),
        };
        self.current = Some(FileDiff {
            old_path,
            new_path,
            is_binary: false,
            hunks: Vec::new(),
        });
        self.saw_old_header = false;
    }

    fn set_old_path(&mut self, rest: &str) {
        // `--- a/x` starts a new file only when no `diff --git` header opened one.
        if self.current.is_none() || self.saw_old_header {
            self.start_file(None);
        }
        self.saw_old_header = true;
        let value = if rest == "/dev/null" {
            None
        } else {
            Some(strip_prefix_dir(rest))
        };
        if let Some(f) = self.current.as_mut() {
            f.old_path = value;
        }
    }

    fn set_new_path(&mut self, rest: &str) {
        let value = if rest == "/dev/null" {
            None
        } else {
            Some(strip_prefix_dir(rest))
        };
        if let Some(f) = self.current.as_mut() {
            f.new_path = value;
        }
    }

    /// `new file mode` / `deleted file mode` — clear the side that does not exist.
    fn set_side(&mut self, added: bool, deleted: bool) {
        if let Some(f) = self.current.as_mut() {
            if added {
                f.old_path = None;
            }
            if deleted {
                f.new_path = None;
            }
        }
    }

    fn start_hunk(&mut self, header: &str) {
        let Some((old_start, old_lines, new_start, new_lines)) = parse_hunk_header(header) else {
            return;
        };
        if self.current.is_none() {
            self.start_file(None);
        }
        self.old_lineno = old_start.max(1);
        self.new_lineno = new_start.max(1);
        self.remaining_old = old_lines;
        self.remaining_new = new_lines;
        if let Some(f) = self.current.as_mut() {
            f.hunks.push(DiffHunk {
                header: header.to_string(),
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
        }
    }

    fn flush(&mut self) {
        if let Some(f) = self.current.take() {
            self.files.push(f);
        }
        self.remaining_old = 0;
        self.remaining_new = 0;
    }

    fn finish(mut self) -> DiffOutput {
        self.flush();
        DiffOutput { files: self.files }
    }
}

/// `a/src/foo.ts b/src/foo.ts` → both paths. Returns None when the two halves
/// cannot be split unambiguously (paths containing spaces without quoting).
fn git_header_paths(rest: &str) -> Option<(String, String)> {
    // Find the split point " b/" that leaves a well-formed "a/..." on the left.
    let mut idx = 0;
    while let Some(found) = rest[idx..].find(" b/") {
        let at = idx + found;
        let left = &rest[..at];
        if left.starts_with("a/") || left.starts_with("\"a/") {
            return Some((strip_prefix_dir(left), strip_prefix_dir(&rest[at + 1..])));
        }
        idx = at + 1;
        if idx >= rest.len() {
            break;
        }
    }
    None
}

/// Drop the `a/` / `b/` diff prefix and surrounding quotes.
fn strip_prefix_dir(path: &str) -> String {
    let trimmed = path.trim().trim_matches('"');
    let stripped = trimmed
        .strip_prefix("a/")
        .or_else(|| trimmed.strip_prefix("b/"))
        .unwrap_or(trimmed);
    // git appends a tab-separated timestamp in some non-git unified diffs.
    stripped.split('\t').next().unwrap_or(stripped).to_string()
}

/// `@@ -12,7 +12,9 @@ fn foo()` → (12, 7, 12, 9). Counts default to 1 when omitted.
fn parse_hunk_header(header: &str) -> Option<(u32, u32, u32, u32)> {
    let body = header.strip_prefix("@@")?;
    let end = body.find("@@")?;
    let mut parts = body[..end].split_whitespace();
    let old = parts.next()?.strip_prefix('-')?;
    let new = parts.next()?.strip_prefix('+')?;
    let (old_start, old_lines) = parse_range(old)?;
    let (new_start, new_lines) = parse_range(new)?;
    Some((old_start, old_lines, new_start, new_lines))
}

fn parse_range(range: &str) -> Option<(u32, u32)> {
    match range.split_once(',') {
        Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
        None => Some((range.parse().ok()?, 1)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn added(file: &FileDiff) -> Vec<(u32, &str)> {
        file.hunks
            .iter()
            .flat_map(|h| h.lines.iter())
            .filter(|l| l.origin == '+')
            .map(|l| (l.new_lineno.unwrap_or(0), l.content.as_str()))
            .collect()
    }

    fn removed(file: &FileDiff) -> Vec<(u32, &str)> {
        file.hunks
            .iter()
            .flat_map(|h| h.lines.iter())
            .filter(|l| l.origin == '-')
            .map(|l| (l.old_lineno.unwrap_or(0), l.content.as_str()))
            .collect()
    }

    #[test]
    fn parses_line_numbers_from_hunk_header() {
        let diff = "\
diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,5 @@ describe(\"x\", () => {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
";
        let out = parse_unified_diff(diff);
        assert_eq!(out.files.len(), 1);
        let f = &out.files[0];
        assert_eq!(f.new_path.as_deref(), Some("src/a.ts"));
        assert_eq!(added(f), vec![(11, "const b = 3;"), (12, "const c = 4;")]);
        assert_eq!(removed(f), vec![(11, "const b = 2;")]);
    }

    #[test]
    fn detects_added_and_deleted_files() {
        let diff = "\
diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const c = 3;
";
        let out = parse_unified_diff(diff);
        assert_eq!(out.files.len(), 2);
        assert!(out.files[0].old_path.is_none());
        assert_eq!(out.files[0].new_path.as_deref(), Some("new.ts"));
        assert_eq!(added(&out.files[0]).len(), 2);
        assert_eq!(out.files[1].old_path.as_deref(), Some("gone.ts"));
        assert!(out.files[1].new_path.is_none());
    }

    #[test]
    fn detects_rename_and_binary() {
        let diff = "\
diff --git a/old/name.ts b/new/name.ts
similarity index 92%
rename from old/name.ts
rename to new/name.ts
diff --git a/logo.png b/logo.png
index 111..222 100644
Binary files a/logo.png and b/logo.png differ
";
        let out = parse_unified_diff(diff);
        assert_eq!(out.files.len(), 2);
        assert_eq!(out.files[0].old_path.as_deref(), Some("old/name.ts"));
        assert_eq!(out.files[0].new_path.as_deref(), Some("new/name.ts"));
        assert!(out.files[1].is_binary);
    }

    #[test]
    fn content_lines_starting_with_dashes_are_not_headers() {
        let diff = "\
diff --git a/a.md b/a.md
--- a/a.md
+++ b/a.md
@@ -1,3 +1,3 @@
 title
---- old rule
++++ new rule
";
        let out = parse_unified_diff(diff);
        assert_eq!(out.files.len(), 1);
        assert_eq!(removed(&out.files[0]), vec![(2, "--- old rule")]);
        assert_eq!(added(&out.files[0]), vec![(2, "+++ new rule")]);
    }

    #[test]
    fn handles_single_line_ranges_and_no_newline_marker() {
        let diff = "\
--- a/x.rs
+++ b/x.rs
@@ -7 +7 @@
-let a = 1;
+let a = 2;
\\ No newline at end of file
";
        let out = parse_unified_diff(diff);
        assert_eq!(out.files.len(), 1);
        assert_eq!(added(&out.files[0]), vec![(7, "let a = 2;")]);
        assert_eq!(removed(&out.files[0]), vec![(7, "let a = 1;")]);
    }

    #[test]
    fn multiple_hunks_keep_independent_line_numbers() {
        let diff = "\
diff --git a/a.rs b/a.rs
--- a/a.rs
+++ b/a.rs
@@ -1,2 +1,2 @@
-let a = 1;
+let a = 2;
 let keep = 0;
@@ -40,2 +40,3 @@
 let b = 1;
+let c = 2;
";
        let out = parse_unified_diff(diff);
        let f = &out.files[0];
        assert_eq!(f.hunks.len(), 2);
        assert_eq!(added(f), vec![(1, "let a = 2;"), (41, "let c = 2;")]);
    }

    #[test]
    fn empty_and_garbage_input_is_not_an_error() {
        assert!(parse_unified_diff("").files.is_empty());
        assert!(parse_unified_diff("not a diff at all\n@@ broken @@\n")
            .files
            .is_empty());
    }
}
