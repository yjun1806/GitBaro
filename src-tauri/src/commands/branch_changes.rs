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

use std::collections::HashSet;
use std::path::{Component, Path};

use git2::{Delta, Diff, DiffFindOptions, DiffOptions, ErrorCode, Oid, Patch, Repository, Tree};
use serde::Serialize;

use crate::error::AppError;
use crate::git::engine::FileStatus;
use crate::git::merge_base::{divergence_point, BaseStatus};
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

/// 저장소 하나의 main 대비 변경.
pub fn changes_vs_default(path: &str) -> Result<BranchChanges, AppError> {
    let repo = Repository::open(path)?;
    if repo.is_bare() {
        return Err(AppError::BareRepository(path.to_string()));
    }

    let head = match repo.head() {
        Ok(head_ref) => Some(head_ref),
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.into()),
    };
    let Some(head_ref) = head else {
        // 커밋이 없는 저장소: 모든 변경이 커밋하지 않은 변경이다.
        let uncommitted = to_workdir(&repo, None)?;
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

    let point = divergence_point(&repo, head_oid, branch.as_deref())?;
    let base_tree = point.merge_base.map(|oid| tree_of(&repo, oid)).transpose()?;

    let uncommitted = to_workdir(&repo, Some(&head_tree))?;
    let (committed, files) = match &base_tree {
        Some(base) => (tree_to_tree(&repo, base, &head_tree)?, to_workdir(&repo, Some(base))?),
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
    changed_files(&mut diff)
}

/// `old`(없으면 빈 트리) → 작업 트리. 스테이징한 변경과 추적하지 않는 파일(폴더 안까지)을 넣는다.
fn to_workdir(repo: &Repository, old: Option<&Tree>) -> Result<Vec<ChangedFile>, git2::Error> {
    let mut opts = DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .include_typechange(true);
    let mut diff = repo.diff_tree_to_workdir_with_index(old, Some(&mut opts))?;
    let mut files = changed_files(&mut diff)?;
    let untracked_copies = untracked_copies_of_deleted(repo, &files)?;
    if untracked_copies.is_empty() {
        return Ok(files);
    }
    files.extend(untracked_copies);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// 「삭제」로 나온 파일 중 디스크에 추적하지 않는 파일로 남아 있는 것(`git rm --cached`).
///
/// 트리 → 인덱스 → 작업 트리를 합친 diff 는 인덱스에서 뺀 파일을 「삭제」 하나로만 남긴다.
/// `git status` 는 같은 파일을 추적하지 않는 파일로도 보여 주므로 그 항목을 더한다.
fn untracked_copies_of_deleted(
    repo: &Repository,
    files: &[ChangedFile],
) -> Result<Vec<ChangedFile>, git2::Error> {
    let deleted: Vec<&str> = files
        .iter()
        .filter(|f| f.status == FileStatus::Deleted)
        .map(|f| f.path.as_str())
        .collect();
    if deleted.is_empty() {
        return Ok(Vec::new());
    }
    let listed: HashSet<&str> = files
        .iter()
        .filter(|f| f.status != FileStatus::Deleted)
        .map(|f| f.path.as_str())
        .collect();

    let mut opts = DiffOptions::new();
    opts.include_untracked(true).show_untracked_content(true).disable_pathspec_match(true);
    for path in &deleted {
        opts.pathspec(path);
    }
    let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;

    let mut copies = Vec::new();
    for (idx, delta) in diff.deltas().enumerate() {
        if delta.status() != Delta::Untracked {
            continue;
        }
        let Some(path) = delta.new_file().path().map(|p| p.to_string_lossy().into_owned()) else {
            continue;
        };
        if listed.contains(path.as_str()) {
            continue;
        }
        let (additions, deletions, is_binary) = line_counts(&delta, Patch::from_diff(&diff, idx)?)?;
        copies.push(ChangedFile {
            path,
            old_path: None,
            status: FileStatus::Untracked,
            additions,
            deletions,
            is_binary,
        });
    }
    Ok(copies)
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

fn changed_files(diff: &mut Diff) -> Result<Vec<ChangedFile>, git2::Error> {
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

        let patch = Patch::from_diff(diff, idx)?;
        if status == FileStatus::Modified && is_unchanged(&delta, patch.as_ref()) {
            // 트리 → 인덱스 → 작업 트리를 합친 diff 는 고쳤다가 되돌린 파일도 「수정」으로 남긴다.
            continue;
        }
        let (additions, deletions, is_binary) = line_counts(&delta, patch)?;

        files.push(ChangedFile { path, old_path, status, additions, deletions, is_binary });
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
}

/// 파일 하나의 main 대비 diff: 갈라진 지점 → 작업 트리(스테이징 포함).
/// `old_path` 는 `ChangedFile::old_path`(이름을 바꾼 파일의 이전 경로)를 그대로 넘긴다.
pub fn file_diff_vs_default(
    path: &str,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<FileDiffVsDefault, AppError> {
    ensure_relative(file_path)?;
    if let Some(old) = old_path {
        ensure_relative(old)?;
    }
    let repo = Repository::open(path)?;
    if repo.is_bare() {
        return Err(AppError::BareRepository(path.to_string()));
    }
    let (base_tree, base_oid, is_point) = comparison_base(&repo)?;

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
    let mut diff = repo.diff_tree_to_workdir_with_index(base_tree.as_ref(), Some(&mut opts))?;
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
    let new_bytes = repo.workdir().and_then(|dir| std::fs::read(dir.join(file_path)).ok());
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
    })
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

/// `files` 와 같은 비교 기준: 갈라진 지점, 못 찾으면 HEAD, 커밋이 없으면 빈 트리.
/// 세 번째 값은 기준이 갈라진 지점인가.
fn comparison_base(repo: &Repository) -> Result<(Option<Tree<'_>>, Option<Oid>, bool), AppError> {
    let head_ref = match repo.head() {
        Ok(head_ref) => head_ref,
        Err(e) if e.code() == ErrorCode::UnbornBranch => return Ok((None, None, false)),
        Err(e) => return Err(e.into()),
    };
    let head_oid = head_ref.peel_to_commit()?.id();
    let branch = head_ref.is_branch().then(|| head_ref.shorthand().map(str::to_string)).flatten();
    let point = divergence_point(repo, head_oid, branch.as_deref())?;
    let (oid, is_point) = match point.merge_base {
        Some(base) => (base, true),
        None => (head_oid, false),
    };
    Ok((Some(tree_of(repo, oid)?), Some(oid), is_point))
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

/// 파일 하나를 그 저장소 main 과 갈라진 지점 → 작업 트리로 비교한 줄 단위 diff.
#[tauri::command]
pub async fn get_file_diff_vs_default(
    path: String,
    file_path: String,
    old_path: Option<String>,
) -> Result<FileDiffVsDefault, AppError> {
    tokio::task::spawn_blocking(move || file_diff_vs_default(&path, &file_path, old_path.as_deref()))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

/// 저장소 하나가 main 과 갈라진 지점 이후로 바꾼 파일과 커밋하지 않은 변경.
/// 여러 저장소는 저장소마다 따로 부른다.
#[tauri::command]
pub async fn get_changes_vs_default(path: String) -> Result<BranchChanges, AppError> {
    tokio::task::spawn_blocking(move || changes_vs_default(&path))
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(clone.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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

        let ca = get_changes_vs_default(a.to_str().unwrap().to_string()).await.unwrap();
        let cb = get_changes_vs_default(b.to_str().unwrap().to_string()).await.unwrap();
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

        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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
        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
        assert_eq!(paths(&c.uncommitted), vec!["keep.txt"]);
        assert_eq!(c.uncommitted[0].status, FileStatus::Deleted);
    }

    #[test]
    fn serialized_shape_matches_the_typescript_types() {
        // src/types/index.ts 의 BranchChanges·BranchChangedFile 와 키가 같아야 한다.
        let dir = tmp_dir("shape").join("r");
        feature_repo(&dir);
        let c = changes_vs_default(dir.to_str().unwrap()).unwrap();
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
            vec!["additions", "deletions", "isBinary", "oldPath", "path", "status"]
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

        let d = file_diff_vs_default(dir.to_str().unwrap(), "a.txt", None).unwrap();
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
        let b = file_diff_vs_default(path, "b.txt", None).unwrap();
        assert_eq!(lines_of(&b, "addition"), vec!["new"]);
        assert_eq!(b.old_content, "");

        let u = file_diff_vs_default(path, "later.txt", None).unwrap();
        assert_eq!(lines_of(&u, "addition"), vec!["l"]);

        let moved = file_diff_vs_default(path, "moved.txt", Some("keep.txt")).unwrap();
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

        let d = file_diff_vs_default(dir.to_str().unwrap(), "a.txt", None).unwrap();
        assert!(!d.base_is_divergence_point);
        assert_eq!(d.base_oid, Some(head_of(&dir, "HEAD")));
        assert_eq!(lines_of(&d, "addition"), vec!["b"]);
    }

    #[test]
    fn file_diff_rejects_paths_outside_the_repository() {
        let dir = tmp_dir("file-diff-escape").join("r");
        feature_repo(&dir);
        let path = dir.to_str().unwrap();
        assert!(file_diff_vs_default(path, "../secret", None).is_err());
        assert!(file_diff_vs_default(path, "/etc/hosts", None).is_err());
        assert!(file_diff_vs_default(path, "a.txt", Some("../x")).is_err());
    }

    #[tokio::test]
    async fn a_missing_repo_is_an_error() {
        let missing = tmp_dir("missing").join("nope");
        let err = get_changes_vs_default(missing.to_str().unwrap().to_string()).await;
        assert!(err.is_err());
    }
}
