//! Deciding what in a diff V4 is allowed to look at, and reading lines out of
//! it. Files outside TypeScript/JavaScript/Rust are counted rather than
//! guessed at — contract §0 requires the report to say what it skipped.

use std::path::Path;

use crate::git::engine::{DiffOutput, FileDiff};

use super::imports;

/// Directory names whose contents are vendored, generated, or third-party.
const SKIPPED_SEGMENTS: [&str; 6] = ["node_modules", "target", "dist", "build", "vendor", ".git"];

/// Extensions that mean "source code we do not analyse" — counted so the report
/// can say *what* it did not look at (contract §0 / spec §7-①).
const UNSUPPORTED_SOURCE_EXTENSIONS: [&str; 13] = [
    "py", "go", "rb", "java", "kt", "swift", "php", "cs", "c", "cpp", "scala", "ex", "dart",
];

#[derive(Default)]
pub(super) struct Targets<'a> {
    pub npm_manifests: Vec<&'a FileDiff>,
    pub cargo_manifests: Vec<&'a FileDiff>,
    pub js_sources: Vec<&'a FileDiff>,
    pub rust_sources: Vec<&'a FileDiff>,
    /// Repo-relative paths of everything above — the manifest search roots.
    pub paths: Vec<String>,
    pub unsupported: usize,
}

impl Targets<'_> {
    pub fn is_empty(&self) -> bool {
        self.npm_manifests.is_empty()
            && self.cargo_manifests.is_empty()
            && self.js_sources.is_empty()
            && self.rust_sources.is_empty()
    }
}

pub(super) fn classify_diff(diff: &DiffOutput) -> Targets<'_> {
    let mut targets = Targets::default();

    for file in &diff.files {
        let Some(path) = file_path(file) else {
            continue;
        };
        if !is_safe_relative(path) || is_skipped_path(path) {
            continue;
        }
        let name = base_name(path);
        let extension = extension_of(path);

        if name == "package.json" {
            targets.npm_manifests.push(file);
        } else if name == "Cargo.toml" {
            targets.cargo_manifests.push(file);
        } else if imports::is_js_extension(extension) {
            targets.js_sources.push(file);
        } else if extension == "rs" {
            targets.rust_sources.push(file);
        } else {
            if UNSUPPORTED_SOURCE_EXTENSIONS.contains(&extension) {
                targets.unsupported += 1;
            }
            continue;
        }
        targets.paths.push(path.to_string());
    }

    targets
}

pub(super) fn file_path(file: &FileDiff) -> Option<&str> {
    file.new_path
        .as_deref()
        .or(file.old_path.as_deref())
        .filter(|path| !path.is_empty())
}

/// `(line number, text)` for added (`+`) or removed (`-`) lines.
pub(super) fn changed_lines(file: &FileDiff, added: bool) -> impl Iterator<Item = (u32, &str)> {
    file.hunks
        .iter()
        .flat_map(|hunk| hunk.lines.iter())
        .filter(move |line| line.origin == if added { '+' } else { '-' })
        .map(move |line| {
            let number = if added {
                line.new_lineno
            } else {
                line.old_lineno
            };
            let text = line.content.trim_end_matches(['\n', '\r']);
            (number.unwrap_or(0), text)
        })
}

/// Reject anything that could escape the repository root before it is joined
/// onto `repo_path`.
fn is_safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !Path::new(path).components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
}

fn is_skipped_path(path: &str) -> bool {
    path.split('/')
        .any(|segment| SKIPPED_SEGMENTS.contains(&segment))
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn extension_of(path: &str) -> &str {
    let name = base_name(path);
    match name.rfind('.') {
        Some(index) if index + 1 < name.len() => &name[index + 1..],
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::engine::{DiffHunk, DiffLine};

    fn file(path: &str) -> FileDiff {
        FileDiff {
            old_path: Some(path.to_string()),
            new_path: Some(path.to_string()),
            is_binary: false,
            hunks: vec![DiffHunk {
                header: "@@".to_string(),
                old_start: 1,
                old_lines: 1,
                new_start: 1,
                new_lines: 1,
                lines: vec![
                    DiffLine {
                        origin: '-',
                        content: "old line\n".to_string(),
                        old_lineno: Some(4),
                        new_lineno: None,
                    },
                    DiffLine {
                        origin: ' ',
                        content: "context\n".to_string(),
                        old_lineno: Some(5),
                        new_lineno: Some(5),
                    },
                    DiffLine {
                        origin: '+',
                        content: "new line\n".to_string(),
                        old_lineno: None,
                        new_lineno: Some(6),
                    },
                ],
            }],
        }
    }

    #[test]
    fn diff_files_are_routed_by_name_and_extension() {
        let diff = DiffOutput {
            files: vec![
                file("package.json"),
                file("src-tauri/Cargo.toml"),
                file("src/app.tsx"),
                file("scripts/build.mjs"),
                file("src-tauri/src/lib.rs"),
                file("scripts/tool.py"),
                file("README.md"),
            ],
        };
        let targets = classify_diff(&diff);
        assert_eq!(targets.npm_manifests.len(), 1);
        assert_eq!(targets.cargo_manifests.len(), 1);
        assert_eq!(targets.js_sources.len(), 2);
        assert_eq!(targets.rust_sources.len(), 1);
        assert_eq!(targets.unsupported, 1, "only tool.py counts; README does not");
    }

    #[test]
    fn vendored_and_escaping_paths_are_dropped_entirely() {
        let diff = DiffOutput {
            files: vec![
                file("node_modules/react/index.js"),
                file("src-tauri/target/debug/build.rs"),
                file("../outside/evil.ts"),
                file("/etc/passwd.ts"),
            ],
        };
        let targets = classify_diff(&diff);
        assert!(targets.is_empty());
        assert_eq!(targets.unsupported, 0);
    }

    #[test]
    fn changed_lines_report_the_right_side_line_numbers() {
        let file = file("src/a.ts");
        let added: Vec<(u32, &str)> = changed_lines(&file, true).collect();
        let removed: Vec<(u32, &str)> = changed_lines(&file, false).collect();
        assert_eq!(added, vec![(6, "new line")]);
        assert_eq!(removed, vec![(4, "old line")]);
    }
}
