use git2::{DiffDelta, DiffFormat, DiffLine as GitLine, Patch};

use crate::error::AppError;
use crate::git::engine::{DiffHunk, DiffLine, DiffOutput, FileDiff};

/// Convert a git2 `Diff` object into our `DiffOutput` type.
pub fn convert_diff(diff: &git2::Diff<'_>) -> Result<DiffOutput, AppError> {
    let num_deltas = diff.deltas().count();
    let mut files: Vec<FileDiff> = Vec::with_capacity(num_deltas);

    for delta_idx in 0..num_deltas {
        let patch = Patch::from_diff(diff, delta_idx)?;
        let file_diff = convert_patch(patch)?;
        files.push(file_diff);
    }

    Ok(DiffOutput { files })
}

/// Convert a single git2 `Patch` into a `FileDiff`.
fn convert_patch(patch: Option<Patch<'_>>) -> Result<FileDiff, AppError> {
    let patch = match patch {
        Some(p) => p,
        None => {
            return Ok(FileDiff {
                old_path: None,
                new_path: None,
                is_binary: false,
                hunks: vec![],
            });
        }
    };

    let delta = patch.delta();
    let old_path = path_from_delta_old(&delta);
    let new_path = path_from_delta_new(&delta);
    let is_binary = delta.old_file().is_binary() || delta.new_file().is_binary();

    if is_binary {
        return Ok(FileDiff {
            old_path,
            new_path,
            is_binary: true,
            hunks: vec![],
        });
    }

    let num_hunks = patch.num_hunks();
    let mut hunks: Vec<DiffHunk> = Vec::with_capacity(num_hunks);

    for hunk_idx in 0..num_hunks {
        let (hunk, _) = patch.hunk(hunk_idx)?;
        let num_lines = patch.num_lines_in_hunk(hunk_idx)?;
        let mut lines: Vec<DiffLine> = Vec::with_capacity(num_lines);

        for line_idx in 0..num_lines {
            let line = patch.line_in_hunk(hunk_idx, line_idx)?;
            lines.push(convert_line(&line));
        }

        hunks.push(DiffHunk {
            header: String::from_utf8_lossy(hunk.header()).into_owned(),
            old_start: hunk.old_start(),
            old_lines: hunk.old_lines(),
            new_start: hunk.new_start(),
            new_lines: hunk.new_lines(),
            lines,
        });
    }

    Ok(FileDiff {
        old_path,
        new_path,
        is_binary: false,
        hunks,
    })
}

fn path_from_delta_old(delta: &DiffDelta<'_>) -> Option<String> {
    delta
        .old_file()
        .path()
        .map(|p| p.to_string_lossy().into_owned())
}

fn path_from_delta_new(delta: &DiffDelta<'_>) -> Option<String> {
    delta
        .new_file()
        .path()
        .map(|p| p.to_string_lossy().into_owned())
}

fn convert_line(line: &GitLine<'_>) -> DiffLine {
    let origin = line.origin();
    let content = String::from_utf8_lossy(line.content()).into_owned();
    DiffLine {
        origin,
        content,
        old_lineno: line.old_lineno(),
        new_lineno: line.new_lineno(),
    }
}

/// Produce a unified diff string for display purposes.
#[allow(dead_code)]
pub fn diff_to_string(diff: &git2::Diff<'_>) -> Result<String, AppError> {
    let mut output = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if matches!(origin, '+' | '-' | ' ') {
            output.push(origin);
        }
        output.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;
    Ok(output)
}
