//! main 대비 변경: 저장소 하나가 기본 브랜치(main)와 갈라진 지점 이후로 바꾼 파일.
//!
//! 「파일별 변경」 화면(W7)이 저장소마다 따로 부른다. 브랜치 이름이 같아도 저장소를 합치지 않는다.
//! 갈라진 지점은 워크스페이스 타임라인과 같은 규칙(`git::merge_base::divergence_point`)으로 고른다.
//!
//! 세 목록을 돌려준다.
//! - `committed`: 갈라진 지점 → HEAD. 커밋한 변경.
//! - `uncommitted`: HEAD → 작업 트리(스테이징 포함, 추적하지 않는 파일 포함). 커밋하지 않은 변경.
//! - `files`: 갈라진 지점 → 작업 트리. 둘을 합친 최종 결과(고쳤다가 되돌린 파일은 빠진다).
//!
//! HEAD 가 기본 브랜치 자신이면 갈라진 지점은 그 upstream(`origin/main`)과의 공통 조상이다.
//! 그래서 main 에서 아직 push 하지 않은 커밋이 `committed` 에 들어간다(`branch == default_branch`
//! 로 화면이 구분해 보여 줄 수 있다).
//!
//! 파일 하나의 줄 단위 diff(갈라진 지점 → 작업 트리)는 `get_file_diff_vs_default` 가 돌려준다.
//!
//! 두 명령 모두 선택 인자 둘을 받는다. 둘 다 없으면 위 동작 그대로다.
//! - `base`: 기본 브랜치 대신 비교할 브랜치(로컬·원격). 갈라진 지점은 HEAD 와 그 브랜치의 공통 조상이다.
//! - `target`: HEAD 대신 볼 브랜치(체크아웃하지 않고 보는 브랜치). 커밋 안 한 변경은 체크아웃한
//!   작업 트리의 것이라 넣지 않는다 — `uncommitted` 는 비고 `files` 는 `committed` 와 같다.

use std::collections::HashSet;
use std::path::{Component, Path};

use git2::{
    Delta, Diff, DiffFindOptions, DiffOptions, ErrorCode, Index, IndexEntryExtendedFlag, ObjectType, Oid, Patch,
    Repository, Tree,
};
use serde::Serialize;

use crate::error::AppError;
use crate::git::engine::FileStatus;
use crate::git::binary::{detect_file_type, extension_to_mime, PreviewFileType};
use crate::git::merge_base::{divergence_point, BaseStatus, DivergencePoint};
use crate::git::untracked::{is_too_large_untracked, untracked_lines, UntrackedLines, UNTRACKED_COUNT_LIMIT};
use crate::git::worktree_base::default_branch_with_fallback;

/// 바뀐 파일 하나.
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
    /// 추적하지 않는 새 파일이 1 MiB(`UNTRACKED_COUNT_LIMIT`)를 넘어 읽지 않았다. 줄 수는 0 이다.
    pub too_large: bool,
    /// 이 목록이 보여 주는 쪽(커밋이면 그 트리, 작업 트리면 디스크)의 파일 내용 id. 「봤음」 표시가
    /// 내용이 바뀌었는지 가리는 데 쓴다. 보통은 blob OID 이고, 1 MiB 를 넘는 작업 트리 파일은 읽지 않고
    /// `size:<바이트>:mtime:<나노초>` 로 대신한다. 지운 파일이거나 읽지 못하면 `None`.
    pub blob_id: Option<String>,
}

/// `get_changes_vs_default` 의 결과. 저장소 하나.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchChanges {
    /// 요청에 넘긴 저장소 경로 그대로.
    pub path: String,
    /// 체크아웃한 로컬 브랜치. detached HEAD 면 `None`.
    pub branch: Option<String>,
    /// HEAD 커밋. 커밋이 없는 저장소면 `None`.
    pub head_oid: Option<String>,
    /// 기본 브랜치 이름(`main`). 찾지 못하면 `None`.
    pub default_branch: Option<String>,
    /// 갈라진 지점을 준 참조(`main`, `origin/main`).
    pub base_ref: Option<String>,
    /// 갈라진 지점을 찾았는가. 커밋이 없는 저장소면 `None`.
    /// `found` 가 아니면 `committed` 는 비고 `files` 는 `uncommitted` 와 같다.
    pub base_status: Option<BaseStatus>,
    /// main 과 갈라진 지점. `base_status` 가 `found` 일 때만 있다.
    pub merge_base_oid: Option<String>,
    /// 갈라진 지점 → HEAD. HEAD 가 기본 브랜치 자신이면 아직 push 하지 않은 커밋의 변경이다.
    pub committed: Vec<ChangedFile>,
    /// HEAD → 작업 트리(스테이징·추적하지 않는 파일 포함).
    /// `git rm --cached` 처럼 인덱스에서만 뺀 파일은 `deleted` 와 `untracked` 두 항목으로 나온다.
    pub uncommitted: Vec<ChangedFile>,
    /// 갈라진 지점 → 작업 트리.
    pub files: Vec<ChangedFile>,
}

/// 짧은 이름(`feat/x`, `origin/x`, 태그)을 커밋으로 푼다. `-`로 시작하거나 빈 이름은 거부한다.
fn resolve_commit(repo: &Repository, name: &str) -> Result<Oid, AppError> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::Git(git2::Error::from_str(&format!("invalid ref name: {name:?}"))));
    }
    Ok(repo.resolve_reference_from_short_name(name)?.peel_to_commit()?.id())
}

/// `head` 의 갈라진 지점. `base` 가 없으면 기본 브랜치 규칙(`divergence_point`), 있으면 그 브랜치와의 공통 조상.
fn point_against(
    repo: &Repository,
    head: Oid,
    head_branch: Option<&str>,
    base: Option<&str>,
) -> Result<DivergencePoint, AppError> {
    let Some(base) = base else {
        return Ok(divergence_point(repo, head, head_branch)?);
    };
    let default_branch = default_branch_with_fallback(repo);
    let base_oid = resolve_commit(repo, base)?;
    Ok(match repo.merge_base(head, base_oid) {
        Ok(merge_base) => DivergencePoint {
            default_branch,
            base_ref: Some(base.trim().to_string()),
            merge_base: Some(merge_base),
            status: BaseStatus::Found,
        },
        Err(e) if e.code() == ErrorCode::NotFound => DivergencePoint {
            default_branch,
            base_ref: None,
            merge_base: None,
            status: BaseStatus::NoSharedHistory,
        },
        Err(e) => return Err(e.into()),
    })
}

/// 체크아웃하지 않고 보는 브랜치 `target` 의 변경: 갈라진 지점 → `target`. 커밋 안 한 변경은 없다.
fn changes_of_target(
    repo: &Repository,
    path: &str,
    target: &str,
    base: Option<&str>,
) -> Result<BranchChanges, AppError> {
    let oid = resolve_commit(repo, target)?;
    let target_tree = tree_of(repo, oid)?;
    let point = point_against(repo, oid, Some(target.trim()), base)?;
    let committed = match point.merge_base {
        Some(merge_base) => tree_to_tree(repo, &tree_of(repo, merge_base)?, &target_tree)?,
        None => Vec::new(),
    };
    Ok(BranchChanges {
        path: path.to_string(),
        branch: Some(target.trim().to_string()),
        head_oid: Some(oid.to_string()),
        default_branch: point.default_branch,
        base_ref: point.base_ref,
        base_status: Some(point.status),
        merge_base_oid: point.merge_base.map(|o| o.to_string()),
        files: committed.clone(),
        committed,
        uncommitted: Vec::new(),
    })
}

/// 저장소 하나의 main(또는 `base`) 대비 변경. `target` 이 있으면 HEAD 대신 그 브랜치를 본다.
pub fn changes_vs_default(
    path: &str,
    base: Option<&str>,
    target: Option<&str>,
) -> Result<BranchChanges, AppError> {
    let repo = Repository::open(path)?;
    if repo.is_bare() {
        return Err(AppError::BareRepository(path.to_string()));
    }
    if let Some(target) = target {
        return changes_of_target(&repo, path, target, base);
    }

    let head = match repo.head() {
        Ok(head_ref) => Some(head_ref),
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.into()),
    };
    let Some(head_ref) = head else {
        // 커밋이 없는 저장소: 모든 변경이 커밋하지 않은 변경이다.
        let uncommitted = to_workdir(&repo, None, &index_to_workdir(&repo, &mut workdir_opts())?)?;
        return Ok(BranchChanges {
            path: path.to_string(),
            branch: unborn_branch(&repo),
            head_oid: None,
            default_branch: default_branch_with_fallback(&repo),
            base_ref: None,
            base_status: None,
            merge_base_oid: None,
            committed: Vec::new(),
            files: uncommitted.clone(),
            uncommitted,
        });
    };

    let head_commit = head_ref.peel_to_commit()?;
    let head_oid = head_commit.id();
    let branch = head_ref.is_branch().then(|| head_ref.shorthand().map(str::to_string)).flatten();
    let head_tree = head_commit.tree()?;

    let point = point_against(&repo, head_oid, branch.as_deref(), base)?;
    let base_tree = point.merge_base.map(|oid| tree_of(&repo, oid)).transpose()?;

    // 작업 트리 쪽(인덱스 → 작업 트리)은 한 번만 훑고 두 비교에 같이 쓴다.
    let workdir = index_to_workdir(&repo, &mut workdir_opts())?;
    let uncommitted = to_workdir(&repo, Some(&head_tree), &workdir)?;
    let (committed, files) = match &base_tree {
        Some(base) => (tree_to_tree(&repo, base, &head_tree)?, to_workdir(&repo, Some(base), &workdir)?),
        None => (Vec::new(), uncommitted.clone()),
    };

    Ok(BranchChanges {
        path: path.to_string(),
        branch,
        head_oid: Some(head_oid.to_string()),
        default_branch: point.default_branch,
        base_ref: point.base_ref,
        base_status: Some(point.status),
        merge_base_oid: point.merge_base.map(|o| o.to_string()),
        committed,
        uncommitted,
        files,
    })
}

fn tree_of(repo: &Repository, commit: Oid) -> Result<Tree<'_>, git2::Error> {
    repo.find_commit(commit)?.tree()
}

/// 커밋이 없는 저장소에서 HEAD 가 가리키는 브랜치 이름(`refs/heads/main` → `main`).
fn unborn_branch(repo: &Repository) -> Option<String> {
    let head = repo.find_reference("HEAD").ok()?;
    head.symbolic_target()?.strip_prefix("refs/heads/").map(str::to_string)
}

fn tree_to_tree(repo: &Repository, old: &Tree, new: &Tree) -> Result<Vec<ChangedFile>, git2::Error> {
    let mut diff = repo.diff_tree_to_tree(Some(old), Some(new), Some(&mut DiffOptions::new()))?;
    changed_files(repo, &mut diff)
}

/// 작업 트리와 비교할 때 쓰는 옵션. 추적하지 않는 파일은 폴더 안까지 넣되 내용은 읽지 않는다
/// (줄 수는 `untracked_file` 이 크기를 보고 센다).
fn workdir_opts() -> DiffOptions {
    let mut opts = DiffOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true).include_typechange(true);
    opts
}

/// 인덱스 → 작업 트리. sparse checkout 으로 디스크에 없는 파일(skip-worktree)은 넣지 않는다.
fn index_to_workdir<'r>(repo: &'r Repository, opts: &mut DiffOptions) -> Result<Diff<'r>, git2::Error> {
    let visible = index_without_absent_skip_worktree(repo)?;
    repo.diff_index_to_workdir(visible.as_ref(), Some(opts))
}

/// skip-worktree 로 표시돼 디스크에 없는 항목을 뺀 인덱스 사본. 저장하지 않는다. 그런 항목이 없으면 `None`.
///
/// libgit2 는 skip-worktree 파일이 디스크에 있으면 바뀌지 않은 것으로 보지만, 없으면 삭제로 본다.
/// git 은 이런 파일을 비교하지 않는다(sparse checkout 범위 밖).
fn index_without_absent_skip_worktree(repo: &Repository) -> Result<Option<Index>, git2::Error> {
    let Some(workdir) = repo.workdir() else { return Ok(None) };
    let index = repo.index()?;
    let skip = IndexEntryExtendedFlag::SKIP_WORKTREE.bits();
    let absent: HashSet<Vec<u8>> = index
        .iter()
        .filter(|e| e.flags_extended & skip != 0)
        .filter(|e| std::fs::symlink_metadata(workdir.join(&*String::from_utf8_lossy(&e.path))).is_err())
        .map(|e| e.path)
        .collect();
    if absent.is_empty() {
        return Ok(None);
    }
    let mut visible = Index::new()?;
    for entry in index.iter().filter(|e| !absent.contains(&e.path)) {
        visible.add(&entry)?;
    }
    Ok(Some(visible))
}

/// `old`(없으면 빈 트리) → 인덱스 → 작업 트리. `workdir` 는 `index_to_workdir` 결과다.
fn tree_to_workdir<'r>(
    repo: &'r Repository,
    old: Option<&Tree>,
    workdir: &Diff<'r>,
    opts: &mut DiffOptions,
) -> Result<Diff<'r>, git2::Error> {
    let mut diff = repo.diff_tree_to_index(old, None, Some(opts))?;
    diff.merge(workdir)?;
    Ok(diff)
}

/// `old`(없으면 빈 트리) → 작업 트리. 스테이징한 변경과 추적하지 않는 파일(폴더 안까지)을 넣는다.
fn to_workdir(repo: &Repository, old: Option<&Tree>, workdir: &Diff) -> Result<Vec<ChangedFile>, git2::Error> {
    let mut diff = tree_to_workdir(repo, old, workdir, &mut workdir_opts())?;
    let mut files = changed_files(repo, &mut diff)?;
    let untracked_copies = untracked_copies_of_deleted(repo, &files, workdir);
    if !untracked_copies.is_empty() {
        files.extend(untracked_copies);
        files.sort_by(|a, b| a.path.cmp(&b.path));
    }
    Ok(files
        .into_iter()
        .map(|file| {
            let blob_id = (file.status != FileStatus::Deleted).then(|| workdir_content_id(repo, &file.path)).flatten();
            ChangedFile { blob_id, ..file }
        })
        .collect())
}

/// 작업 트리 파일의 내용 id. diff 가 준 id 는 stat 캐시에 따라 비어 있을 수 있어 디스크에서 직접 구한다.
///
/// 1 MiB(`UNTRACKED_COUNT_LIMIT`)까지는 blob OID 를 계산하고(쓰지 않는다), 그보다 크면 읽지 않고
/// 크기·수정 시각으로 대신한다. 링크는 대상 경로가 내용이다. sparse checkout 으로 디스크에 없으면
/// 인덱스의 blob 이다. 어느 쪽도 없으면 `None`.
fn workdir_content_id(repo: &Repository, rel_path: &str) -> Option<String> {
    let full = repo.workdir()?.join(rel_path);
    let Ok(meta) = std::fs::symlink_metadata(&full) else {
        let index = repo.index().ok()?;
        return index.get_path(Path::new(rel_path), 0).map(|entry| entry.id.to_string());
    };
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full).ok()?;
        return Oid::hash_object(ObjectType::Blob, target.as_os_str().as_encoded_bytes()).ok().map(|o| o.to_string());
    }
    if !meta.is_file() {
        return None;
    }
    if meta.len() > UNTRACKED_COUNT_LIMIT {
        let mtime = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
        return Some(format!("size:{}:mtime:{mtime}", meta.len()));
    }
    Oid::hash_file(ObjectType::Blob, &full).ok().map(|o| o.to_string())
}

/// 「삭제」로 나온 파일 중 디스크에 추적하지 않는 파일로 남아 있는 것(`git rm --cached`).
///
/// 트리 → 인덱스 → 작업 트리를 합친 diff 는 인덱스에서 뺀 파일을 「삭제」 하나로만 남긴다.
/// `git status` 는 같은 파일을 추적하지 않는 파일로도 보여 주므로 그 항목을 더한다.
fn untracked_copies_of_deleted(repo: &Repository, files: &[ChangedFile], workdir: &Diff) -> Vec<ChangedFile> {
    let deleted: HashSet<&str> = files
        .iter()
        .filter(|f| f.status == FileStatus::Deleted)
        .map(|f| f.path.as_str())
        .collect();
    if deleted.is_empty() {
        return Vec::new();
    }
    let listed: HashSet<&str> = files
        .iter()
        .filter(|f| f.status != FileStatus::Deleted)
        .map(|f| f.path.as_str())
        .collect();
    workdir
        .deltas()
        .filter(|delta| delta.status() == Delta::Untracked)
        .filter_map(|delta| delta.new_file().path().map(|p| p.to_string_lossy().into_owned()))
        .filter(|path| deleted.contains(path.as_str()) && !listed.contains(path.as_str()))
        .map(|path| untracked_file(repo, path))
        .collect()
}

/// 추적하지 않는 새 파일 하나. 1 MiB 를 넘으면 읽지 않는다(`git::untracked`).
fn untracked_file(repo: &Repository, path: String) -> ChangedFile {
    let lines = match repo.workdir() {
        Some(dir) => untracked_lines(&dir.join(&path)),
        None => UntrackedLines::Unreadable,
    };
    let (additions, is_binary, too_large) = match lines {
        UntrackedLines::Text(n) => (n, false, false),
        UntrackedLines::Binary => (0, true, false),
        UntrackedLines::TooLarge => (0, false, true),
        UntrackedLines::Unreadable => (0, false, false),
    };
    ChangedFile {
        path,
        old_path: None,
        status: FileStatus::Untracked,
        additions,
        deletions: 0,
        is_binary,
        too_large,
        blob_id: None,
    }
}

/// 더한 줄 수, 뺀 줄 수, 바이너리 여부.
fn line_counts(
    delta: &git2::DiffDelta,
    patch: Option<Patch>,
) -> Result<(usize, usize, bool), git2::Error> {
    Ok(match patch {
        Some(patch) if !patch.delta().flags().is_binary() => {
            let (_, add, del) = patch.line_stats()?;
            (add, del, false)
        }
        Some(_) => (0, 0, true),
        None => (0, 0, delta.flags().is_binary()),
    })
}

fn changed_files(repo: &Repository, diff: &mut Diff) -> Result<Vec<ChangedFile>, git2::Error> {
    diff.find_similar(Some(DiffFindOptions::new().renames(true).for_untracked(true)))?;

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
        if status == FileStatus::Untracked {
            files.push(untracked_file(repo, path));
            continue;
        }

        let patch = Patch::from_diff(diff, idx)?;
        if status == FileStatus::Modified && is_unchanged(&delta, patch.as_ref()) {
            // 트리 → 인덱스 → 작업 트리를 합친 diff 는 고쳤다가 되돌린 파일도 「수정」으로 남긴다.
            continue;
        }
        let (additions, deletions, is_binary) = line_counts(&delta, patch)?;

        // 트리 쪽 새 파일 id. 작업 트리와 비교했으면 `to_workdir` 가 디스크 내용으로 바꾼다.
        let new_id = delta.new_file().id();
        let blob_id = (status != FileStatus::Deleted && !new_id.is_zero()).then(|| new_id.to_string());
        files.push(ChangedFile { path, old_path, status, additions, deletions, is_binary, too_large: false, blob_id });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// 「수정」으로 나왔지만 내용·모드가 그대로인가. 내용 id 가 같거나, 모드가 같고 바뀐 구간이 없으면 그대로다.
fn is_unchanged(delta: &git2::DiffDelta, patch: Option<&Patch>) -> bool {
    let (old, new) = (delta.old_file(), delta.new_file());
    if old.mode() != new.mode() {
        return false;
    }
    if !old.id().is_zero() && old.id() == new.id() {
        return true;
    }
    match patch {
        Some(p) => !p.delta().flags().is_binary() && p.num_hunks() == 0,
        None => false,
    }
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

/// diff 한 줄. 모양은 `get_file_diff` 의 줄과 같다(`addition`/`deletion`/`context`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VsDefaultDiffLine {
    pub kind: &'static str,
    pub content: String,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VsDefaultDiffHunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<VsDefaultDiffLine>,
}

/// `get_file_diff_vs_default` 의 결과. 파일 하나를 갈라진 지점 → 작업 트리로 비교한다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffVsDefault {
    pub file_path: String,
    /// 이름을 바꾼 파일이면 갈라진 지점에서의 경로.
    pub old_path: Option<String>,
    pub binary: bool,
    pub insertions: usize,
    pub deletions: usize,
    pub hunks: Vec<VsDefaultDiffHunk>,
    /// 비교 기준(갈라진 지점) 쪽 내용. 없던 파일이면 빈 문자열.
    pub old_content: String,
    /// 작업 트리 쪽 내용. 지운 파일이면 빈 문자열.
    pub new_content: String,
    /// 비교 기준 커밋. 갈라진 지점을 못 찾으면 HEAD, 커밋이 없는 저장소면 `None`.
    pub base_oid: Option<String>,
    /// 비교 기준이 갈라진 지점인가. `false` 면 HEAD 와 비교한 결과다(`files` 와 같은 규칙).
    pub base_is_divergence_point: bool,
    /// 추적하지 않는 새 파일이 1 MiB 를 넘어 읽지 않았을 때만 있다. `binary` 는 `true`, 내용·구간은 비어 있다.
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

/// 파일 하나의 main(또는 `base`) 대비 diff: 갈라진 지점 → 작업 트리(스테이징 포함).
/// `target` 이 있으면 작업 트리 대신 그 브랜치의 내용과 비교한다.
/// `old_path` 는 `ChangedFile::old_path`(이름을 바꾼 파일의 이전 경로)를 그대로 넘긴다.
pub fn file_diff_vs_default(
    path: &str,
    file_path: &str,
    old_path: Option<&str>,
    base: Option<&str>,
    target: Option<&str>,
) -> Result<FileDiffVsDefault, AppError> {
    ensure_relative(file_path)?;
    if let Some(old) = old_path {
        ensure_relative(old)?;
    }
    let repo = Repository::open(path)?;
    if repo.is_bare() {
        return Err(AppError::BareRepository(path.to_string()));
    }
    let (base_tree, base_oid, is_point, target_tree) = comparison_base(&repo, base, target)?;
    if target_tree.is_none() && is_too_large_untracked(&repo, file_path) {
        return Ok(too_large_diff(&repo, file_path, old_path, base_oid, is_point));
    }

    let opts = || {
        let mut opts = DiffOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true)
            .include_typechange(true)
            .disable_pathspec_match(true)
            .pathspec(file_path);
        if let Some(old) = old_path {
            opts.pathspec(old);
        }
        opts
    };
    let mut diff = match &target_tree {
        Some(new_tree) => repo.diff_tree_to_tree(base_tree.as_ref(), Some(new_tree), Some(&mut opts()))?,
        None => {
            let workdir = index_to_workdir(&repo, &mut opts())?;
            tree_to_workdir(&repo, base_tree.as_ref(), &workdir, &mut opts())?
        }
    };
    if old_path.is_some() {
        diff.find_similar(Some(DiffFindOptions::new().renames(true).for_untracked(true)))?;
    }

    let mut hunks = Vec::new();
    let mut binary = false;
    for idx in 0..diff.deltas().count() {
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
    let count = |kind: &str| hunks.iter().flat_map(|h: &VsDefaultDiffHunk| &h.lines).filter(|l| l.kind == kind).count();
    let (insertions, deletions) = (count("addition"), count("deletion"));

    let base_path = old_path.unwrap_or(file_path);
    let old_bytes = base_tree
        .as_ref()
        .and_then(|tree| tree.get_path(Path::new(base_path)).ok())
        .and_then(|entry| repo.find_blob(entry.id()).ok())
        .map(|blob| blob.content().to_vec());
    let new_bytes = match &target_tree {
        Some(tree) => tree
            .get_path(Path::new(file_path))
            .ok()
            .and_then(|entry| repo.find_blob(entry.id()).ok())
            .map(|blob| blob.content().to_vec()),
        None => repo
            .workdir()
            .and_then(|dir| std::fs::read(dir.join(file_path)).ok())
            .or_else(|| skip_worktree_blob(&repo, file_path)),
    };
    let text = |bytes: Option<Vec<u8>>| {
        bytes.filter(|_| !binary).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default()
    };

    Ok(FileDiffVsDefault {
        file_path: file_path.to_string(),
        old_path: old_path.map(str::to_string),
        binary,
        insertions,
        deletions,
        hunks,
        old_content: text(old_bytes),
        new_content: text(new_bytes),
        base_oid: base_oid.map(|o| o.to_string()),
        base_is_divergence_point: is_point,
        binary_preview: None,
    })
}

/// sparse checkout 범위 밖이라 디스크에 없는 파일의 내용: 인덱스에 있는 내용이 그 파일의 현재 내용이다.
fn skip_worktree_blob(repo: &Repository, file_path: &str) -> Option<Vec<u8>> {
    let index = repo.index().ok()?;
    let entry = index.get_path(Path::new(file_path), 0)?;
    if entry.flags_extended & IndexEntryExtendedFlag::SKIP_WORKTREE.bits() == 0 {
        return None;
    }
    repo.find_blob(entry.id).ok().map(|blob| blob.content().to_vec())
}

/// 1 MiB 를 넘는 새 파일: 읽지 않고 「너무 큼」 자리만 돌려준다.
fn too_large_diff(
    repo: &Repository,
    file_path: &str,
    old_path: Option<&str>,
    base_oid: Option<Oid>,
    is_point: bool,
) -> FileDiffVsDefault {
    let new_size = repo
        .workdir()
        .and_then(|dir| std::fs::symlink_metadata(dir.join(file_path)).ok())
        .map(|m| m.len());
    FileDiffVsDefault {
        file_path: file_path.to_string(),
        old_path: old_path.map(str::to_string),
        binary: true,
        insertions: 0,
        deletions: 0,
        hunks: Vec::new(),
        old_content: String::new(),
        new_content: String::new(),
        base_oid: base_oid.map(|o| o.to_string()),
        base_is_divergence_point: is_point,
        binary_preview: Some(TooLargePreview {
            meta: TooLargeMeta {
                file_type: detect_file_type(file_path),
                mime_type: extension_to_mime(file_path),
                old_size: None,
                new_size,
                too_large: true,
            },
            old_base64: None,
            new_base64: None,
        }),
    }
}

/// 저장소 루트 기준의 상대 경로만 받는다(`..`·절대 경로는 거부).
fn ensure_relative(file_path: &str) -> Result<(), AppError> {
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

/// 비교 기준 트리, 그 커밋, 기준이 갈라진 지점인가, 새 쪽 트리(`target` 을 볼 때만; 없으면 작업 트리).
type ComparisonBase<'r> = (Option<Tree<'r>>, Option<Oid>, bool, Option<Tree<'r>>);

/// `files` 와 같은 비교 기준: 갈라진 지점, 못 찾으면 HEAD(또는 `target`), 커밋이 없으면 빈 트리.
fn comparison_base<'r>(
    repo: &'r Repository,
    base: Option<&str>,
    target: Option<&str>,
) -> Result<ComparisonBase<'r>, AppError> {
    let (head_oid, branch, target_tree) = match target {
        Some(name) => {
            let oid = resolve_commit(repo, name)?;
            (oid, Some(name.trim().to_string()), Some(tree_of(repo, oid)?))
        }
        None => {
            let head_ref = match repo.head() {
                Ok(head_ref) => head_ref,
                Err(e) if e.code() == ErrorCode::UnbornBranch => return Ok((None, None, false, None)),
                Err(e) => return Err(e.into()),
            };
            let oid = head_ref.peel_to_commit()?.id();
            let branch = head_ref.is_branch().then(|| head_ref.shorthand().map(str::to_string)).flatten();
            (oid, branch, None)
        }
    };
    let point = point_against(repo, head_oid, branch.as_deref(), base)?;
    let (oid, is_point) = match point.merge_base {
        Some(merge_base) => (merge_base, true),
        None => (head_oid, false),
    };
    Ok((Some(tree_of(repo, oid)?), Some(oid), is_point, target_tree))
}

fn patch_hunks(patch: &Patch) -> Result<Vec<VsDefaultDiffHunk>, git2::Error> {
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
                    Some(VsDefaultDiffLine {
                        kind,
                        content: String::from_utf8_lossy(line.content()).into_owned(),
                        old_line_no: line.old_lineno(),
                        new_line_no: line.new_lineno(),
                    })
                })
                .collect();
            Ok(VsDefaultDiffHunk {
                header: String::from_utf8_lossy(hunk.header()).into_owned(),
                old_start: hunk.old_start(),
                new_start: hunk.new_start(),
                lines,
            })
        })
        .collect()
}

/// 파일 하나를 그 저장소 main(또는 `base`)과 갈라진 지점 → 작업 트리(또는 `target`)로 비교한 줄 단위 diff.
#[tauri::command]
pub async fn get_file_diff_vs_default(
    path: String,
    file_path: String,
    old_path: Option<String>,
    base: Option<String>,
    target: Option<String>,
) -> Result<FileDiffVsDefault, AppError> {
    tokio::task::spawn_blocking(move || {
        file_diff_vs_default(&path, &file_path, old_path.as_deref(), base.as_deref(), target.as_deref())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// 저장소 하나가 main(또는 `base`)과 갈라진 지점 이후로 바꾼 파일과 커밋하지 않은 변경.
/// `target` 이 있으면 체크아웃하지 않고 그 브랜치를 본다(커밋 안 한 변경 없음).
/// 여러 저장소는 저장소마다 따로 부른다.
#[tauri::command]
pub async fn get_changes_vs_default(
    path: String,
    base: Option<String>,
    target: Option<String>,
) -> Result<BranchChanges, AppError> {
    tokio::task::spawn_blocking(move || changes_vs_default(&path, base.as_deref(), target.as_deref()))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("gitbaro-branch-changes-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn init(dir: &Path, default: &str) {
        std::fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q", "-b", default]);
        git(dir, &["config", "user.email", "t@t"]);
        git(dir, &["config", "user.name", "t"]);
    }

    fn write(dir: &Path, rel: &str, content: &str) {
        let file = dir.join(rel);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }

    fn commit_all(dir: &Path, msg: &str) {
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
    }

    fn head_of(dir: &Path, rev: &str) -> String {
        let out = Command::new("git").args(["rev-parse", rev]).current_dir(dir).output().unwrap();
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    fn paths(files: &[ChangedFile]) -> Vec<&str> {
        files.iter().map(|f| f.path.as_str()).collect()
    }

    fn find<'a>(files: &'a [ChangedFile], path: &str) -> &'a ChangedFile {
        files.iter().find(|f| f.path == path).unwrap_or_else(|| panic!("{path} 없음: {files:?}"))
    }

    /// main: a.txt, keep.txt / feat: a.txt 수정, b.txt 추가 커밋. HEAD 는 feat.
    fn feature_repo(dir: &Path) {
        init(dir, "main");
        write(dir, "a.txt", "one\ntwo\n");
        write(dir, "keep.txt", "keep\n");
        commit_all(dir, "base");
        git(dir, &["checkout", "-q", "-b", "feat"]);
        write(dir, "a.txt", "one\ntwo\nthree\n");
        write(dir, "b.txt", "new\n");
        commit_all(dir, "feat work");
    }

    #[test]
    fn committed_changes_since_the_fork_are_listed() {
        let dir = tmp_dir("committed").join("r");
        feature_repo(&dir);
        let fork = head_of(&dir, "main");
        // main 이 더 나아가도 main 쪽 변경은 들어오지 않는다.
        git(&dir, &["checkout", "-q", "main"]);
        write(&dir, "main-only.txt", "m\n");
        commit_all(&dir, "main later");
        git(&dir, &["checkout", "-q", "feat"]);

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert_eq!(c.branch.as_deref(), Some("feat"));
        assert_eq!(c.default_branch.as_deref(), Some("main"));
        assert_eq!(c.base_status, Some(BaseStatus::Found));
        assert_eq!(c.merge_base_oid.as_deref(), Some(fork.as_str()));
        assert_eq!(paths(&c.committed), vec!["a.txt", "b.txt"]);
        let a = find(&c.committed, "a.txt");
        assert_eq!((a.status.clone(), a.additions, a.deletions), (FileStatus::Modified, 1, 0));
        assert_eq!(find(&c.committed, "b.txt").status, FileStatus::Added);
        assert!(c.uncommitted.is_empty());
        assert_eq!(paths(&c.files), vec!["a.txt", "b.txt"]);
    }

    #[test]
    fn uncommitted_changes_include_staged_unstaged_and_untracked_dirs() {
        let dir = tmp_dir("uncommitted").join("r");
        feature_repo(&dir);
        write(&dir, "keep.txt", "changed\n");
        write(&dir, "staged.txt", "s\n");
        git(&dir, &["add", "staged.txt"]);
        write(&dir, "new-dir/x.txt", "x\n");
        write(&dir, "new-dir/deep/y.txt", "y\n");
        std::fs::remove_file(dir.join("b.txt")).unwrap();

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert_eq!(
            paths(&c.uncommitted),
            vec!["b.txt", "keep.txt", "new-dir/deep/y.txt", "new-dir/x.txt", "staged.txt"]
        );
        assert_eq!(find(&c.uncommitted, "b.txt").status, FileStatus::Deleted);
        assert_eq!(find(&c.uncommitted, "keep.txt").status, FileStatus::Modified);
        assert_eq!(find(&c.uncommitted, "staged.txt").status, FileStatus::Added);
        assert_eq!(find(&c.uncommitted, "new-dir/x.txt").status, FileStatus::Untracked);
        assert_eq!(find(&c.uncommitted, "new-dir/x.txt").additions, 1);
        // committed 는 그대로이고, 합친 목록에서 추가했다가 지운 b.txt 는 빠진다.
        assert_eq!(paths(&c.committed), vec!["a.txt", "b.txt"]);
        assert_eq!(
            paths(&c.files),
            vec!["a.txt", "keep.txt", "new-dir/deep/y.txt", "new-dir/x.txt", "staged.txt"]
        );
    }

    #[test]
    fn a_change_reverted_in_the_working_tree_drops_out_of_the_combined_list() {
        let dir = tmp_dir("reverted").join("r");
        feature_repo(&dir);
        write(&dir, "a.txt", "one\ntwo\n");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert_eq!(paths(&c.committed), vec!["a.txt", "b.txt"]);
        assert_eq!(paths(&c.uncommitted), vec!["a.txt"]);
        assert_eq!(paths(&c.files), vec!["b.txt"]);
    }

    #[test]
    fn a_renamed_file_keeps_its_old_path() {
        let dir = tmp_dir("rename").join("r");
        feature_repo(&dir);
        git(&dir, &["mv", "keep.txt", "moved.txt"]);
        commit_all(&dir, "move");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        let moved = find(&c.committed, "moved.txt");
        assert_eq!(moved.status, FileStatus::Renamed);
        assert_eq!(moved.old_path.as_deref(), Some("keep.txt"));
    }

    #[test]
    fn binary_files_are_flagged_without_line_counts() {
        let dir = tmp_dir("binary").join("r");
        feature_repo(&dir);
        std::fs::write(dir.join("img.bin"), [0u8, 1, 2, 0, 255, 0, 3]).unwrap();
        commit_all(&dir, "binary");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        let bin = find(&c.committed, "img.bin");
        assert!(bin.is_binary);
        assert_eq!((bin.additions, bin.deletions), (0, 0));
        assert!(!find(&c.committed, "a.txt").is_binary);
    }

    #[test]
    fn on_a_local_only_default_branch_only_uncommitted_changes_show() {
        let dir = tmp_dir("on-main").join("r");
        init(&dir, "main");
        write(&dir, "a.txt", "a\n");
        commit_all(&dir, "base");
        write(&dir, "a.txt", "b\n");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert_eq!(c.base_status, Some(BaseStatus::Found));
        assert_eq!(c.merge_base_oid, c.head_oid);
        assert!(c.committed.is_empty());
        assert_eq!(paths(&c.uncommitted), vec!["a.txt"]);
        assert_eq!(paths(&c.files), vec!["a.txt"]);
    }

    #[test]
    fn on_main_with_an_origin_unpushed_commits_count_as_committed() {
        let root = tmp_dir("unpushed");
        let upstream = root.join("up");
        init(&upstream, "main");
        write(&upstream, "a.txt", "a\n");
        commit_all(&upstream, "base");
        let clone = root.join("clone");
        git(&root, &["clone", "-q", upstream.to_str().unwrap(), clone.to_str().unwrap()]);
        git(&clone, &["config", "user.email", "t@t"]);
        git(&clone, &["config", "user.name", "t"]);
        write(&clone, "local.txt", "l\n");
        commit_all(&clone, "local");

        let c = changes_vs_default(clone.to_str().unwrap(), None, None).unwrap();
        assert_eq!(c.base_ref.as_deref(), Some("origin/main"));
        assert_eq!(paths(&c.committed), vec!["local.txt"]);
    }

    #[test]
    fn without_a_default_branch_only_uncommitted_changes_show() {
        let dir = tmp_dir("no-default").join("r");
        init(&dir, "develop");
        write(&dir, "a.txt", "a\n");
        commit_all(&dir, "base");
        write(&dir, "u.txt", "u\n");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert!(c.default_branch.is_none());
        assert_eq!(c.base_status, Some(BaseStatus::NoDefaultBranch));
        assert!(c.committed.is_empty());
        assert_eq!(paths(&c.uncommitted), vec!["u.txt"]);
        assert_eq!(c.files, c.uncommitted);
    }

    #[test]
    fn an_empty_repo_lists_its_working_tree_as_uncommitted() {
        let dir = tmp_dir("empty").join("r");
        init(&dir, "main");
        write(&dir, "first.txt", "hi\n");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert!(c.head_oid.is_none());
        assert!(c.base_status.is_none());
        assert_eq!(c.branch.as_deref(), Some("main"));
        assert!(c.committed.is_empty());
        assert_eq!(paths(&c.uncommitted), vec!["first.txt"]);
    }

    #[test]
    fn ignored_files_are_left_out() {
        let dir = tmp_dir("ignored").join("r");
        feature_repo(&dir);
        write(&dir, ".gitignore", "build/\n");
        commit_all(&dir, "ignore");
        write(&dir, "build/out.txt", "o\n");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert!(c.uncommitted.is_empty());
    }

    #[tokio::test]
    async fn each_repo_uses_its_own_default_branch_and_fork_point_on_the_same_branch_name() {
        // 두 저장소 모두 `feat` 에 있지만 기본 브랜치(main/master)와 갈라진 지점이 다르다.
        // 기본 브랜치·갈라진 지점을 브랜치 이름으로 캐시하거나 앞 호출에서 이어 쓰면 틀린다.
        let root = tmp_dir("separate");
        let a = root.join("a");
        feature_repo(&a);
        let b = root.join("b");
        init(&b, "master");
        write(&b, "x.txt", "x\n");
        commit_all(&b, "base");
        write(&b, "y.txt", "y\n");
        commit_all(&b, "second on master");
        git(&b, &["checkout", "-q", "-b", "feat"]);
        write(&b, "only-b.txt", "b\n");
        commit_all(&b, "b only");

        let ca = get_changes_vs_default(a.to_str().unwrap().to_string(), None, None).await.unwrap();
        let cb = get_changes_vs_default(b.to_str().unwrap().to_string(), None, None).await.unwrap();
        assert_eq!((ca.branch.as_deref(), cb.branch.as_deref()), (Some("feat"), Some("feat")));
        assert_eq!(ca.default_branch.as_deref(), Some("main"));
        assert_eq!(cb.default_branch.as_deref(), Some("master"));
        assert_eq!(ca.merge_base_oid.as_deref(), Some(head_of(&a, "main").as_str()));
        assert_eq!(cb.merge_base_oid.as_deref(), Some(head_of(&b, "master").as_str()));
        assert_eq!(paths(&ca.committed), vec!["a.txt", "b.txt"]);
        assert_eq!(paths(&cb.committed), vec!["only-b.txt"]);
    }

    #[test]
    fn a_file_removed_only_from_the_index_is_listed_as_deleted_and_untracked() {
        // `git rm --cached`: git status 는 「삭제(스테이징)」와 「추적하지 않는 파일」 둘 다 보여 준다.
        let dir = tmp_dir("rm-cached").join("r");
        feature_repo(&dir);
        git(&dir, &["rm", "-q", "--cached", "keep.txt"]);

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        let entries: Vec<_> = c
            .uncommitted
            .iter()
            .map(|f| (f.path.as_str(), f.status.clone(), f.additions))
            .collect();
        assert_eq!(
            entries,
            vec![("keep.txt", FileStatus::Deleted, 0), ("keep.txt", FileStatus::Untracked, 1)]
        );
        // 디스크에서도 지우면 추적하지 않는 항목은 없다.
        std::fs::remove_file(dir.join("keep.txt")).unwrap();
        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert_eq!(paths(&c.uncommitted), vec!["keep.txt"]);
        assert_eq!(c.uncommitted[0].status, FileStatus::Deleted);
    }

    #[test]
    fn a_large_untracked_file_is_not_read() {
        use crate::git::untracked::UNTRACKED_COUNT_LIMIT;
        let dir = tmp_dir("large-untracked").join("r");
        feature_repo(&dir);
        write(&dir, "big.log", &"x\n".repeat(UNTRACKED_COUNT_LIMIT as usize / 2 + 1));
        write(&dir, "small.log", "a\nb\n");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        let big = find(&c.uncommitted, "big.log");
        assert!(big.too_large);
        assert_eq!((big.additions, big.deletions, big.is_binary), (0, 0, false));
        assert!(find(&c.files, "big.log").too_large);
        let small = find(&c.uncommitted, "small.log");
        assert_eq!((small.additions, small.too_large), (2, false));

        let d = file_diff_vs_default(dir.to_str().unwrap(), "big.log", None, None, None).unwrap();
        assert!(d.binary && d.hunks.is_empty() && d.new_content.is_empty());
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["binaryPreview"]["meta"]["tooLarge"], true);
        assert_eq!(json["binaryPreview"]["meta"]["newSize"], UNTRACKED_COUNT_LIMIT + 2);
        let small = file_diff_vs_default(dir.to_str().unwrap(), "small.log", None, None, None).unwrap();
        assert!(serde_json::to_value(&small).unwrap().get("binaryPreview").is_none());
    }

    #[test]
    fn files_outside_a_sparse_checkout_are_not_deleted() {
        let dir = tmp_dir("sparse").join("r");
        init(&dir, "main");
        write(&dir, "in/a.txt", "a\n");
        write(&dir, "out/b.txt", "b\n");
        commit_all(&dir, "base");
        git(&dir, &["checkout", "-q", "-b", "feat"]);
        write(&dir, "out/b.txt", "b2\n");
        commit_all(&dir, "change outside the cone");
        git(&dir, &["sparse-checkout", "set", "in"]);
        assert!(!dir.join("out/b.txt").exists(), "sparse checkout 이 파일을 치웠다");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        assert!(c.uncommitted.is_empty(), "{:?}", c.uncommitted);
        assert_eq!(paths(&c.files), vec!["out/b.txt"]);
        assert_eq!(find(&c.files, "out/b.txt").status, FileStatus::Modified);

        let d = file_diff_vs_default(dir.to_str().unwrap(), "out/b.txt", None, None, None).unwrap();
        assert_eq!(lines_of(&d, "deletion"), vec!["b"]);
        assert_eq!(lines_of(&d, "addition"), vec!["b2"]);
        assert_eq!((d.old_content.as_str(), d.new_content.as_str()), ("b\n", "b2\n"));
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn blob_ids_follow_the_file_content_on_each_side() {
        use crate::git::untracked::UNTRACKED_COUNT_LIMIT;
        let dir = tmp_dir("blob-id").join("r");
        feature_repo(&dir);
        let committed_a = head_of(&dir, "HEAD:a.txt");

        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        // 커밋한 변경은 HEAD 트리의 blob, 작업 트리가 같으면 합친 목록도 같은 id 다.
        assert_eq!(find(&c.committed, "a.txt").blob_id.as_deref(), Some(committed_a.as_str()));
        assert_eq!(find(&c.files, "a.txt").blob_id.as_deref(), Some(committed_a.as_str()));

        // 에이전트가 다시 고치면 작업 트리 쪽 id 가 바뀌고, 커밋 쪽은 그대로다.
        write(&dir, "a.txt", "one\ntwo\nthree\nfour\n");
        write(&dir, "new.txt", "fresh\n");
        std::fs::remove_file(dir.join("b.txt")).unwrap();
        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        let edited = find(&c.files, "a.txt").blob_id.clone().unwrap();
        assert_ne!(edited, committed_a);
        assert_eq!(find(&c.uncommitted, "a.txt").blob_id.as_deref(), Some(edited.as_str()));
        assert_eq!(find(&c.committed, "a.txt").blob_id.as_deref(), Some(committed_a.as_str()));
        // git 과 같은 blob id 다(필터가 없을 때).
        let out = Command::new("git").args(["hash-object", "a.txt"]).current_dir(&dir).output().unwrap();
        assert_eq!(edited, String::from_utf8(out.stdout).unwrap().trim());
        let untracked = find(&c.uncommitted, "new.txt");
        assert_eq!(untracked.status, FileStatus::Untracked);
        assert!(untracked.blob_id.is_some());
        assert_eq!(find(&c.uncommitted, "b.txt").blob_id, None, "지운 파일은 내용이 없다");

        // 1 MiB 를 넘는 새 파일은 읽지 않고 크기·수정 시각을 쓴다.
        write(&dir, "big.log", &"x\n".repeat(UNTRACKED_COUNT_LIMIT as usize / 2 + 1));
        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        let big = find(&c.uncommitted, "big.log").blob_id.clone().unwrap();
        assert!(big.starts_with(&format!("size:{}:mtime:", UNTRACKED_COUNT_LIMIT + 2)), "{big}");

        // 보는 브랜치(체크아웃 안 함)는 그 브랜치 트리의 blob 이다.
        git(&dir, &["stash", "-u", "-q"]);
        git(&dir, &["checkout", "-q", "main"]);
        let v = changes_vs_default(dir.to_str().unwrap(), None, Some("feat")).unwrap();
        assert_eq!(find(&v.files, "a.txt").blob_id.as_deref(), Some(committed_a.as_str()));
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn serialized_shape_matches_the_typescript_types() {
        // src/types/index.ts 의 BranchChanges·BranchChangedFile 와 키가 같아야 한다.
        let dir = tmp_dir("shape").join("r");
        feature_repo(&dir);
        let c = changes_vs_default(dir.to_str().unwrap(), None, None).unwrap();
        let json = serde_json::to_value(&c).unwrap();
        let keys = |v: &serde_json::Value| {
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort();
            k
        };
        assert_eq!(
            keys(&json),
            vec![
                "baseRef", "baseStatus", "branch", "committed", "defaultBranch", "files",
                "headOid", "mergeBaseOid", "path", "uncommitted"
            ]
        );
        assert_eq!(
            keys(&json["committed"][0]),
            vec!["additions", "blobId", "deletions", "isBinary", "oldPath", "path", "status", "tooLarge"]
        );
        assert_eq!(json["baseStatus"], "found");
        assert_eq!(json["committed"][0]["status"], "modified");
    }

    fn lines_of(d: &FileDiffVsDefault, kind: &str) -> Vec<String> {
        d.hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.kind == kind)
            .map(|l| l.content.trim_end().to_string())
            .collect()
    }

    #[test]
    fn file_diff_compares_the_fork_point_with_the_working_tree() {
        let dir = tmp_dir("file-diff").join("r");
        feature_repo(&dir);
        // main 이 나중에 바꾼 줄은 들어오지 않는다.
        git(&dir, &["checkout", "-q", "main"]);
        write(&dir, "a.txt", "one\nTWO-main\n");
        commit_all(&dir, "main later");
        git(&dir, &["checkout", "-q", "feat"]);
        // 커밋한 변경(three) + 커밋하지 않은 변경(four).
        write(&dir, "a.txt", "one\ntwo\nthree\nfour\n");

        let d = file_diff_vs_default(dir.to_str().unwrap(), "a.txt", None, None, None).unwrap();
        assert!(d.base_is_divergence_point);
        assert_eq!(d.base_oid, Some(head_of(&dir, "main~1")));
        assert_eq!(lines_of(&d, "addition"), vec!["three", "four"]);
        assert!(lines_of(&d, "deletion").is_empty());
        assert_eq!((d.insertions, d.deletions), (2, 0));
        assert_eq!(d.old_content, "one\ntwo\n");
        assert_eq!(d.new_content, "one\ntwo\nthree\nfour\n");
        let added = d.hunks.iter().flat_map(|h| &h.lines).find(|l| l.kind == "addition").unwrap();
        assert_eq!((added.old_line_no, added.new_line_no), (None, Some(3)));
    }

    #[test]
    fn file_diff_of_added_untracked_and_renamed_files() {
        let dir = tmp_dir("file-diff-kinds").join("r");
        feature_repo(&dir);
        write(&dir, "new-dir/u.txt", "u1\nu2\n");
        git(&dir, &["mv", "keep.txt", "moved.txt"]);
        commit_all(&dir, "move");
        write(&dir, "later.txt", "l\n");

        let path = dir.to_str().unwrap();
        let b = file_diff_vs_default(path, "b.txt", None, None, None).unwrap();
        assert_eq!(lines_of(&b, "addition"), vec!["new"]);
        assert_eq!(b.old_content, "");

        let u = file_diff_vs_default(path, "later.txt", None, None, None).unwrap();
        assert_eq!(lines_of(&u, "addition"), vec!["l"]);

        let moved = file_diff_vs_default(path, "moved.txt", Some("keep.txt"), None, None).unwrap();
        assert!(lines_of(&moved, "addition").is_empty(), "{moved:?}");
        assert_eq!(moved.old_content, "keep\n");
        assert_eq!(moved.new_content, "keep\n");
    }

    #[test]
    fn file_diff_without_a_default_branch_compares_with_head() {
        let dir = tmp_dir("file-diff-no-default").join("r");
        init(&dir, "develop");
        write(&dir, "a.txt", "a\n");
        commit_all(&dir, "base");
        write(&dir, "a.txt", "a\nb\n");

        let d = file_diff_vs_default(dir.to_str().unwrap(), "a.txt", None, None, None).unwrap();
        assert!(!d.base_is_divergence_point);
        assert_eq!(d.base_oid, Some(head_of(&dir, "HEAD")));
        assert_eq!(lines_of(&d, "addition"), vec!["b"]);
    }

    #[test]
    fn file_diff_rejects_paths_outside_the_repository() {
        let dir = tmp_dir("file-diff-escape").join("r");
        feature_repo(&dir);
        let path = dir.to_str().unwrap();
        assert!(file_diff_vs_default(path, "../secret", None, None, None).is_err());
        assert!(file_diff_vs_default(path, "/etc/hosts", None, None, None).is_err());
        assert!(file_diff_vs_default(path, "a.txt", Some("../x"), None, None).is_err());
    }

    #[tokio::test]
    async fn a_missing_repo_is_an_error() {
        let missing = tmp_dir("missing").join("nope");
        let err = get_changes_vs_default(missing.to_str().unwrap().to_string(), None, None).await;
        assert!(err.is_err());
    }

    /// main ← dev(d.txt) ← feat(b.txt, a.txt 수정). HEAD 는 feat, 작업 트리에 w.txt.
    fn stacked_repo(dir: &Path) {
        init(dir, "main");
        write(dir, "a.txt", "one\ntwo\n");
        commit_all(dir, "base");
        git(dir, &["checkout", "-q", "-b", "dev"]);
        write(dir, "d.txt", "dev\n");
        commit_all(dir, "dev work");
        git(dir, &["checkout", "-q", "-b", "feat"]);
        write(dir, "a.txt", "one\ntwo\nthree\n");
        write(dir, "b.txt", "new\n");
        commit_all(dir, "feat work");
        write(dir, "w.txt", "wip\n");
    }

    #[test]
    fn a_chosen_base_replaces_the_default_branch() {
        let dir = tmp_dir("base").join("r");
        stacked_repo(&dir);
        let path = dir.to_str().unwrap();

        // 기본(main) 대비: dev 의 d.txt 도 들어간다.
        let by_default = changes_vs_default(path, None, None).unwrap();
        assert_eq!(paths(&by_default.committed), vec!["a.txt", "b.txt", "d.txt"]);
        assert_eq!(by_default.base_ref.as_deref(), Some("main"));

        // dev 대비: feat 이 dev 에서 갈라진 뒤의 변경만.
        let by_dev = changes_vs_default(path, Some("dev"), None).unwrap();
        assert_eq!(by_dev.base_ref.as_deref(), Some("dev"));
        assert_eq!(by_dev.merge_base_oid.as_deref(), Some(head_of(&dir, "dev").as_str()));
        assert_eq!(by_dev.default_branch.as_deref(), Some("main"));
        assert_eq!(paths(&by_dev.committed), vec!["a.txt", "b.txt"]);
        assert_eq!(paths(&by_dev.uncommitted), vec!["w.txt"]);
        assert_eq!(paths(&by_dev.files), vec!["a.txt", "b.txt", "w.txt"]);

        // 파일 diff 도 같은 기준을 쓴다: dev 대비 d.txt 는 바뀌지 않았다.
        let d = file_diff_vs_default(path, "d.txt", None, Some("dev"), None).unwrap();
        assert!(d.hunks.is_empty());
        assert_eq!(d.base_oid.as_deref(), Some(head_of(&dir, "dev").as_str()));
        let a = file_diff_vs_default(path, "a.txt", None, Some("dev"), None).unwrap();
        assert_eq!((a.insertions, a.deletions), (1, 0));
    }

    #[test]
    fn a_viewed_branch_is_compared_without_uncommitted_changes() {
        let dir = tmp_dir("target").join("r");
        stacked_repo(&dir);
        // 체크아웃은 dev 로 옮기고, feat 은 보기만 한다. 작업 트리의 w.txt 는 dev 의 것이다.
        git(&dir, &["stash", "-u", "-q"]);
        git(&dir, &["checkout", "-q", "dev"]);
        git(&dir, &["stash", "pop", "-q"]);
        let path = dir.to_str().unwrap();

        let c = changes_vs_default(path, None, Some("feat")).unwrap();
        assert_eq!(c.branch.as_deref(), Some("feat"));
        assert_eq!(c.head_oid.as_deref(), Some(head_of(&dir, "feat").as_str()));
        assert_eq!(paths(&c.committed), vec!["a.txt", "b.txt", "d.txt"]);
        assert!(c.uncommitted.is_empty());
        assert_eq!(paths(&c.files), paths(&c.committed));

        let by_dev = changes_vs_default(path, Some("dev"), Some("feat")).unwrap();
        assert_eq!(paths(&by_dev.files), vec!["a.txt", "b.txt"]);

        // 파일 diff 의 새 쪽은 작업 트리가 아니라 feat 의 내용이다.
        let b = file_diff_vs_default(path, "b.txt", None, Some("dev"), Some("feat")).unwrap();
        assert_eq!(b.new_content, "new\n");
        let w = file_diff_vs_default(path, "w.txt", None, None, Some("feat")).unwrap();
        assert!(w.hunks.is_empty() && w.new_content.is_empty(), "{w:?}");
    }

    #[test]
    fn an_unrelated_base_reports_no_shared_history_and_bad_names_fail() {
        let dir = tmp_dir("unrelated").join("r");
        stacked_repo(&dir);
        git(&dir, &["checkout", "-q", "--orphan", "island"]);
        git(&dir, &["rm", "-rfq", "--cached", "."]);
        write(&dir, "i.txt", "island\n");
        git(&dir, &["add", "i.txt"]);
        git(&dir, &["commit", "-q", "-m", "island"]);
        git(&dir, &["checkout", "-q", "-f", "feat"]);
        let path = dir.to_str().unwrap();

        let c = changes_vs_default(path, Some("island"), None).unwrap();
        assert_eq!(c.base_status, Some(BaseStatus::NoSharedHistory));
        assert!(c.committed.is_empty());
        assert!(changes_vs_default(path, Some("nope"), None).is_err());
        assert!(changes_vs_default(path, Some("--all"), None).is_err());
        assert!(changes_vs_default(path, None, Some("")).is_err());
    }
}
