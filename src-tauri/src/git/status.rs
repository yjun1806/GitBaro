//! Working-tree status read through `git status --porcelain=v2 -z`.
//!
//! libgit2's status diverges from git in ways users notice: it ignores
//! skip-worktree / sparse-checkout bits (files outside the sparse cone show up
//! as deleted) and it does not detect renames. The git CLI is the reference,
//! so status is read from its machine-readable output instead.

use std::path::Path;
use std::process::Command;

use crate::error::AppError;
use crate::git::cli::parse_git_error;

/// One path reported by `git status --porcelain=v2`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PorcelainEntry {
    pub path: String,
    /// Source path of a rename or copy (`2` records only).
    pub orig_path: Option<String>,
    /// Index-side status code (`X`), `.` when unchanged.
    pub index: char,
    /// Worktree-side status code (`Y`), `.` when unchanged.
    pub worktree: char,
    pub conflicted: bool,
    pub untracked: bool,
}

impl PorcelainEntry {
    pub fn is_staged(&self) -> bool {
        !self.conflicted && !self.untracked && self.index != '.'
    }

    pub fn is_unstaged(&self) -> bool {
        !self.conflicted && (self.untracked || self.worktree != '.')
    }

    /// Status label of the staged side, matching the frontend `FileStatus`.
    pub fn index_status(&self) -> &'static str {
        if !self.is_staged() {
            return "unchanged";
        }
        status_label(self.index)
    }

    /// Status label of the unstaged side, matching the frontend `FileStatus`.
    pub fn worktree_status(&self) -> &'static str {
        if self.untracked {
            return "untracked";
        }
        if !self.is_unstaged() {
            return "unchanged";
        }
        status_label(self.worktree)
    }

    /// Whether the file is absent from the working tree.
    pub fn is_deleted_in_worktree(&self) -> bool {
        self.worktree == 'D' || (self.index == 'D' && self.worktree == '.')
    }
}

fn status_label(code: char) -> &'static str {
    match code {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        // 'M' modified, 'T' type change (e.g. file ↔ symlink)
        _ => "modified",
    }
}

/// Parse NUL-separated `git status --porcelain=v2 -z` output.
pub fn parse_porcelain_v2(output: &[u8]) -> Vec<PorcelainEntry> {
    let mut records = output
        .split(|b| *b == 0)
        .map(|r| String::from_utf8_lossy(r).into_owned());
    let mut entries = Vec::new();

    while let Some(record) = records.next() {
        let mut kind = record.splitn(2, ' ');
        let tag = kind.next().unwrap_or("");
        let rest = kind.next().unwrap_or("");
        match tag {
            // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
            "1" => {
                if let Some((xy, path)) = split_fields(rest, 7) {
                    entries.push(tracked_entry(xy, path, None));
                }
            }
            // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
            "2" => {
                let orig = records.next();
                if let Some((xy, path)) = split_fields(rest, 8) {
                    entries.push(tracked_entry(xy, path, orig));
                }
            }
            // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
            "u" => {
                if let Some((_, path)) = split_fields(rest, 9) {
                    entries.push(PorcelainEntry {
                        path,
                        orig_path: None,
                        index: '.',
                        worktree: '.',
                        conflicted: true,
                        untracked: false,
                    });
                }
            }
            "?" if !rest.is_empty() => entries.push(PorcelainEntry {
                path: rest.to_string(),
                orig_path: None,
                index: '.',
                worktree: '?',
                conflicted: false,
                untracked: true,
            }),
            _ => {} // headers ("#"), ignored ("!") and the trailing empty record
        }
    }
    entries
}

/// Split `rest` into the XY field and the path that follows `fields_before_path`
/// space-separated fields. The path itself may contain spaces.
fn split_fields(rest: &str, fields_before_path: usize) -> Option<(&str, String)> {
    let mut parts = rest.splitn(fields_before_path + 1, ' ');
    let xy = parts.next()?;
    let path = parts.nth(fields_before_path - 1)?;
    if path.is_empty() {
        return None;
    }
    Some((xy, path.to_string()))
}

fn tracked_entry(xy: &str, path: String, orig_path: Option<String>) -> PorcelainEntry {
    let mut codes = xy.chars();
    PorcelainEntry {
        path,
        orig_path,
        index: codes.next().unwrap_or('.'),
        worktree: codes.next().unwrap_or('.'),
        conflicted: false,
        untracked: false,
    }
}

/// Run `git status` in `repo_path` and parse the result. Blocking — call from
/// `spawn_blocking`.
pub fn read_status(repo_path: &Path) -> Result<Vec<PorcelainEntry>, AppError> {
    // --no-optional-locks: status is polled; never hold index.lock while the
    // user runs git in a terminal (same as GitHub Desktop).
    // status.renames=true: a user's `status.renames` / `diff.renames = copies`
    // would otherwise report copies, whose source is a separate, still-changed
    // file. Stage/unstage/discard on a copy row must never touch that source,
    // so copies are reported as plain additions.
    let output = Command::new("git")
        .args([
            "-c",
            "status.renames=true",
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--find-renames",
        ])
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::GitCliNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    if !output.status.success() {
        return Err(AppError::GitCli {
            message: parse_git_error(&String::from_utf8_lossy(&output.stderr)),
            exit_code: output.status.code(),
        });
    }
    Ok(parse_porcelain_v2(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "587be6b4c3f93f93c489c0111bba5596147a26cb";

    fn one(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 {HASH} {HASH} {path}")
    }

    fn join(records: &[String]) -> Vec<u8> {
        let mut out = records.join("\0").into_bytes();
        out.push(0);
        out
    }

    #[test]
    fn parses_ordinary_entries_with_spaces_and_dashes() {
        let out = join(&[one(".M", "a b.txt"), one("A.", "-dash"), one("MM", "한글 파일.md")]);
        let entries = parse_porcelain_v2(&out);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "a b.txt");
        assert!(!entries[0].is_staged());
        assert_eq!(entries[0].worktree_status(), "modified");
        assert_eq!(entries[1].path, "-dash");
        assert_eq!(entries[1].index_status(), "added");
        assert!(!entries[1].is_unstaged());
        assert!(entries[2].is_staged() && entries[2].is_unstaged());
        assert_eq!(entries[2].path, "한글 파일.md");
    }

    #[test]
    fn parses_renames_with_original_path() {
        let out = join(&[
            format!("2 R. N... 100644 100644 100644 {HASH} {HASH} R100 new name.txt"),
            "old name.txt".to_string(),
            "? untracked \"quoted\".txt".to_string(),
        ]);
        let entries = parse_porcelain_v2(&out);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "new name.txt");
        assert_eq!(entries[0].orig_path.as_deref(), Some("old name.txt"));
        assert_eq!(entries[0].index_status(), "renamed");
        assert_eq!(entries[1].path, "untracked \"quoted\".txt");
        assert_eq!(entries[1].worktree_status(), "untracked");
    }

    #[test]
    fn parses_unmerged_entries_as_conflicted() {
        let out = join(&[format!(
            "u UU N... 100644 100644 100644 100644 {HASH} {HASH} {HASH} conflict file.txt"
        )]);
        let entries = parse_porcelain_v2(&out);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].conflicted);
        assert_eq!(entries[0].path, "conflict file.txt");
        assert!(!entries[0].is_staged() && !entries[0].is_unstaged());
    }

    #[test]
    fn maps_type_changes_and_deletions() {
        let out = join(&[one(".T", "link"), one("D.", "gone.txt"), one(".D", "wt-gone.txt")]);
        let entries = parse_porcelain_v2(&out);
        assert_eq!(entries[0].worktree_status(), "modified");
        assert_eq!(entries[1].index_status(), "deleted");
        assert!(entries[1].is_deleted_in_worktree());
        assert!(entries[2].is_deleted_in_worktree());
    }
}
