//! main 대비 변경: 저장소 하나가 기본 브랜치(main)와 갈라진 지점 이후로 바꾼 파일.
//!
//! 「파일별 변경」 화면(W7)이 저장소마다 따로 부른다. 브랜치 이름이 같아도 저장소를 합치지 않는다.
//! 갈라진 지점은 워크스페이스 타임라인과 같은 규칙(`git::merge_base::divergence_point`)으로 고른다.
//!
//! 세 목록을 돌려준다.
//! - `committed`: 갈라진 지점 → HEAD. 커밋한 변경.
//! - `uncommitted`: HEAD → 작업 트리(스테이징 포함, 추적하지 않는 파일 포함). 커밋하지 않은 변경.
//! - `files`: 갈라진 지점 → 작업 트리. 둘을 합친 최종 결과(고쳤다가 되돌린 파일은 빠진다).

use git2::{Delta, Diff, DiffFindOptions, DiffOptions, ErrorCode, Oid, Repository, Tree};
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
    /// 갈라진 지점 → HEAD.
    pub committed: Vec<ChangedFile>,
    /// HEAD → 작업 트리(스테이징·추적하지 않는 파일 포함).
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
    changed_files(&mut diff)
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

        let patch = git2::Patch::from_diff(diff, idx)?;
        if status == FileStatus::Modified && is_unchanged(&delta, patch.as_ref()) {
            // 트리 → 인덱스 → 작업 트리를 합친 diff 는 고쳤다가 되돌린 파일도 「수정」으로 남긴다.
            continue;
        }
        let (additions, deletions, is_binary) = match patch {
            Some(patch) if !patch.delta().flags().is_binary() => {
                let (_, add, del) = patch.line_stats()?;
                (add, del, false)
            }
            Some(_) => (0, 0, true),
            None => (0, 0, delta.flags().is_binary()),
        };

        files.push(ChangedFile { path, old_path, status, additions, deletions, is_binary });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// 「수정」으로 나왔지만 내용·모드가 그대로인가. 내용 id 가 같거나, 모드가 같고 바뀐 구간이 없으면 그대로다.
fn is_unchanged(delta: &git2::DiffDelta, patch: Option<&git2::Patch>) -> bool {
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
    async fn each_repo_is_called_separately_even_on_the_same_branch_name() {
        let root = tmp_dir("separate");
        let a = root.join("a");
        let b = root.join("b");
        feature_repo(&a);
        feature_repo(&b);
        write(&b, "only-b.txt", "b\n");
        commit_all(&b, "b only");

        let ca = get_changes_vs_default(a.to_str().unwrap().to_string()).await.unwrap();
        let cb = get_changes_vs_default(b.to_str().unwrap().to_string()).await.unwrap();
        assert_eq!(ca.path, a.to_str().unwrap());
        assert_eq!(cb.path, b.to_str().unwrap());
        assert_eq!(paths(&ca.committed), vec!["a.txt", "b.txt"]);
        assert_eq!(paths(&cb.committed), vec!["a.txt", "b.txt", "only-b.txt"]);
    }

    #[tokio::test]
    async fn a_missing_repo_is_an_error() {
        let missing = tmp_dir("missing").join("nope");
        let err = get_changes_vs_default(missing.to_str().unwrap().to_string()).await;
        assert!(err.is_err());
    }
}
