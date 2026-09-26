//! 두 커밋(트리) 사이의 변경: 바뀐 파일 목록과 파일 하나의 줄 단위 diff.
//!
//! 「push 안 한 범위」(`commands::range_changes`)와 PR 파일의 로컬 diff(`commands::pull_request`)가 쓴다.
//! 둘 다 트리 → 트리만 비교한다. 작업 트리(커밋하지 않은 변경)는 넣지 않는다.
//!
//! 줄 단위 diff 의 모양(`PatchHunk`·`PatchLine`)은 GitHub patch 를 푼 결과(`github::pr_parse`)와 같다.

use std::path::{Component, Path};

use git2::{Delta, Diff, DiffFindOptions, DiffOptions, Oid, Patch, Repository, Tree};
use serde::Serialize;

use crate::error::AppError;
use crate::git::binary::{detect_file_type, extension_to_mime, PreviewFileType};
use crate::git::engine::FileStatus;

/// 한쪽이라도 이보다 크면 줄 단위로 비교하지 않는다(「너무 큼」). `pnpm-lock.yaml` 같은 큰 텍스트
/// 파일은 diff 를 보도록 넉넉히 둔다.
pub const TRACKED_DIFF_LIMIT: u64 = 8 * 1024 * 1024;

/// 저장소 루트 기준의 상대 경로만 받는다(`..`·절대 경로는 거부).
pub fn ensure_relative(file_path: &str) -> Result<(), AppError> {
    let ok = !file_path.is_empty()
        && Path::new(file_path).components().all(|c| matches!(c, Component::Normal(_)));
    if ok {
        Ok(())
    } else {
        Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("not a repository-relative path: {file_path}"),
        )))
    }
}

/// 두 트리 사이에서 바뀐 파일 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// 저장소 루트 기준 경로. 지운 파일은 지우기 전 경로.
    pub path: String,
    /// 이름을 바꾼 파일의 이전 경로. 그 밖에는 `None`.
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    /// 한쪽이 `TRACKED_DIFF_LIMIT` 를 넘어 줄 단위로 비교하지 않았다. 줄 수는 0 이다.
    pub too_large: bool,
}

/// diff 한 줄. `kind` 는 `addition`/`deletion`/`context` 다(`get_file_diff` 의 줄과 같다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchLine {
    pub kind: &'static str,
    pub content: String,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchHunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<PatchLine>,
}

/// 파일 하나를 두 트리로 비교한 줄 단위 diff. TS `TreeFileDiff` 와 같은 모양이다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeFileDiff {
    pub file_path: String,
    /// 이름을 바꾼 파일이면 옛 쪽 경로.
    pub old_path: Option<String>,
    pub binary: bool,
    pub insertions: usize,
    pub deletions: usize,
    pub hunks: Vec<PatchHunk>,
    /// 옛 쪽 내용. 없던 파일이거나 바이너리면 빈 문자열.
    pub old_content: String,
    /// 새 쪽 내용. 지운 파일이거나 바이너리면 빈 문자열.
    pub new_content: String,
    /// 옛 쪽 커밋. 빈 트리(처음 커밋 전)와 비교했으면 `None`.
    pub base_oid: Option<String>,
    /// 옛 쪽 커밋이 두 커밋의 공통 조상인가. `false` 면 공통 조상이 없거나 조상이 아닌 커밋과 그대로 비교했다.
    pub base_is_merge_base: bool,
    /// 파일이 `TRACKED_DIFF_LIMIT` 를 넘어 읽지 않았을 때만 있다. `binary` 는 `true`, 내용·구간은 비어 있다.
    /// 모양은 `get_file_diff` 의 `binaryPreview` 와 같아서 diff 화면이 「너무 큼」으로 보여 준다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_preview: Option<TooLargePreview>,
}

/// 읽지 않은 큰 파일의 미리 보기 자리. TS `BinaryPreview` 와 같은 모양이다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TooLargePreview {
    pub meta: TooLargeMeta,
    pub old_base64: Option<String>,
    pub new_base64: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TooLargeMeta {
    pub file_type: PreviewFileType,
    pub mime_type: &'static str,
    pub old_size: Option<u64>,
    pub new_size: Option<u64>,
    pub too_large: bool,
}

/// 옛 쪽(없으면 빈 트리) → 새 쪽 트리에서 바뀐 파일. 경로 순서다.
pub fn changed_files_between(repo: &Repository, old: Option<&Tree>, new: &Tree) -> Result<Vec<ChangedFile>, git2::Error> {
    let mut opts = DiffOptions::new();
    opts.include_typechange(true);
    let mut diff = repo.diff_tree_to_tree(old, Some(new), Some(&mut opts))?;
    changed_files(repo, &mut diff)
}

fn changed_files(repo: &Repository, diff: &mut Diff) -> Result<Vec<ChangedFile>, git2::Error> {
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;

    let mut files = Vec::new();
    for (idx, delta) in diff.deltas().enumerate() {
        let Some(status) = status_from_delta(delta.status()) else {
            continue;
        };
        let new_path = delta.new_file().path().map(|p| p.to_string_lossy().into_owned());
        let old_path = delta.old_file().path().map(|p| p.to_string_lossy().into_owned());
        let path = match status {
            FileStatus::Deleted => old_path.clone().or(new_path),
            _ => new_path.or(old_path.clone()),
        }
        .unwrap_or_default();
        let old_path = matches!(status, FileStatus::Renamed | FileStatus::Copied)
            .then_some(old_path)
            .flatten()
            .filter(|old| *old != path);

        if is_too_large_delta(repo, &delta) {
            files.push(ChangedFile {
                path,
                old_path,
                status,
                additions: 0,
                deletions: 0,
                is_binary: false,
                too_large: true,
            });
            continue;
        }
        let (additions, deletions, is_binary) = match Patch::from_diff(diff, idx)? {
            Some(patch) if !patch.delta().flags().is_binary() => {
                let (_, add, del) = patch.line_stats()?;
                (add, del, false)
            }
            Some(_) => (0, 0, true),
            None => (0, 0, delta.flags().is_binary()),
        };
        files.push(ChangedFile { path, old_path, status, additions, deletions, is_binary, too_large: false });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// 목록에 넣을 변경 종류. 바뀌지 않았거나 무시한 파일은 `None`.
fn status_from_delta(delta: Delta) -> Option<FileStatus> {
    match delta {
        Delta::Added => Some(FileStatus::Added),
        Delta::Deleted => Some(FileStatus::Deleted),
        Delta::Modified | Delta::Typechange => Some(FileStatus::Modified),
        Delta::Renamed => Some(FileStatus::Renamed),
        Delta::Copied => Some(FileStatus::Copied),
        Delta::Untracked => Some(FileStatus::Untracked),
        Delta::Conflicted => Some(FileStatus::Conflicted),
        Delta::Unmodified | Delta::Ignored | Delta::Unreadable => None,
    }
}

/// 한쪽 크기. 저장소의 내용이면 머리만 읽어 크기를 본다. 없는 쪽(id 가 0)은 libgit2 가 준 크기(없으면 0)다.
fn side_size(repo: &Repository, file: &git2::DiffFile) -> u64 {
    let id = file.id();
    if id.is_zero() {
        return file.size();
    }
    match repo.odb().and_then(|odb| odb.read_header(id)) {
        Ok((size, _)) => size as u64,
        Err(_) => file.size(),
    }
}

/// 어느 쪽이든 `TRACKED_DIFF_LIMIT` 보다 큰가. 크면 줄 단위로 비교하지 않는다.
fn is_too_large_delta(repo: &Repository, delta: &git2::DiffDelta) -> bool {
    side_size(repo, &delta.old_file()) > TRACKED_DIFF_LIMIT || side_size(repo, &delta.new_file()) > TRACKED_DIFF_LIMIT
}

/// 파일 하나를 옛 쪽(없으면 빈 트리) → 새 쪽 트리로 비교한다. `old_path` 는 이름을 바꾼 파일의 이전 경로다.
/// `base_oid`·`base_is_merge_base` 는 결과에 그대로 담는다.
pub fn tree_file_diff(
    repo: &Repository,
    old_tree: Option<&Tree>,
    new_tree: &Tree,
    file_path: &str,
    old_path: Option<&str>,
    base_oid: Option<Oid>,
    base_is_merge_base: bool,
) -> Result<TreeFileDiff, AppError> {
    ensure_relative(file_path)?;
    if let Some(old) = old_path {
        ensure_relative(old)?;
    }
    let mut opts = DiffOptions::new();
    opts.include_typechange(true).disable_pathspec_match(true).pathspec(file_path);
    if let Some(old) = old_path {
        opts.pathspec(old);
    }
    let mut diff = repo.diff_tree_to_tree(old_tree, Some(new_tree), Some(&mut opts))?;
    if old_path.is_some() {
        diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;
    }

    let empty = TreeFileDiff {
        file_path: file_path.to_string(),
        old_path: old_path.map(str::to_string),
        binary: false,
        insertions: 0,
        deletions: 0,
        hunks: Vec::new(),
        old_content: String::new(),
        new_content: String::new(),
        base_oid: base_oid.map(|o| o.to_string()),
        base_is_merge_base,
        binary_preview: None,
    };

    let mut hunks = Vec::new();
    let mut binary = false;
    for (idx, delta) in diff.deltas().enumerate() {
        if is_too_large_delta(repo, &delta) {
            let size = |file: git2::DiffFile| (!file.id().is_zero()).then(|| side_size(repo, &file));
            let (old_size, new_size) = (size(delta.old_file()), size(delta.new_file()));
            return Ok(TreeFileDiff {
                binary: true,
                binary_preview: Some(TooLargePreview {
                    meta: TooLargeMeta {
                        file_type: detect_file_type(file_path),
                        mime_type: extension_to_mime(file_path),
                        old_size,
                        new_size,
                        too_large: true,
                    },
                    old_base64: None,
                    new_base64: None,
                }),
                ..empty
            });
        }
        let Some(patch) = Patch::from_diff(&diff, idx)? else {
            continue;
        };
        let delta = patch.delta();
        if delta.flags().is_binary() || delta.old_file().is_binary() || delta.new_file().is_binary() {
            binary = true;
            continue;
        }
        hunks.extend(patch_hunks(&patch)?);
    }
    let count = |kind: &str| hunks.iter().flat_map(|h: &PatchHunk| &h.lines).filter(|l| l.kind == kind).count();
    let (insertions, deletions) = (count("addition"), count("deletion"));
    let text = |tree: Option<&Tree>, path: &str| {
        if binary {
            return String::new();
        }
        tree.and_then(|t| t.get_path(Path::new(path)).ok())
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .map(|blob| String::from_utf8_lossy(blob.content()).into_owned())
            .unwrap_or_default()
    };

    Ok(TreeFileDiff {
        binary,
        insertions,
        deletions,
        old_content: text(old_tree, old_path.unwrap_or(file_path)),
        new_content: text(Some(new_tree), file_path),
        hunks,
        ..empty
    })
}

pub fn patch_hunks(patch: &Patch) -> Result<Vec<PatchHunk>, git2::Error> {
    (0..patch.num_hunks())
        .map(|h| {
            let (hunk, n) = patch.hunk(h)?;
            let lines = (0..n)
                .map(|l| patch.line_in_hunk(h, l))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter_map(|line| {
                    let kind = match line.origin() {
                        '+' => "addition",
                        '-' => "deletion",
                        ' ' => "context",
                        _ => return None,
                    };
                    Some(PatchLine {
                        kind,
                        content: String::from_utf8_lossy(line.content()).into_owned(),
                        old_line_no: line.old_lineno(),
                        new_line_no: line.new_lineno(),
                    })
                })
                .collect();
            Ok(PatchHunk {
                header: String::from_utf8_lossy(hunk.header()).into_owned(),
                old_start: hunk.old_start(),
                new_start: hunk.new_start(),
                lines,
            })
        })
        .collect()
}
