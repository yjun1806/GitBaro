//! 등록된 저장소마다 워크트리 목록(메인 작업 트리 포함)과 각 워크트리의 브랜치·HEAD 를 읽는다.
//! 사이드바와 커밋 그래프가 워크트리를 그리는 데 쓴다(`review_status` 커맨드).

use std::path::Path;

use git2::Repository;
use serde::Serialize;

/// 저장소 하나의 워크트리 목록(메인 작업 트리 포함).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoReviewStatus {
    /// 요청에 넘긴 저장소 경로 그대로.
    pub repo_path: String,
    pub worktrees: Vec<ReviewWorktree>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewWorktree {
    /// 작업 트리 경로(끝의 `/` 없음). 화면의 조회 키로 쓴다. 메인 작업 트리는 요청한
    /// 저장소 경로를 그대로 쓴다(심볼릭 링크를 풀지 않는다). 링크된 워크트리로 요청했으면
    /// libgit2 가 돌려준 경로다.
    pub path: String,
    /// 체크아웃한 로컬 브랜치. detached HEAD 면 `None`.
    pub branch: Option<String>,
    /// HEAD 커밋. 커밋이 하나도 없는(unborn) 저장소면 `None`.
    pub head_oid: Option<String>,
    pub is_main: bool,
}

/// `repo_path`(메인 작업 트리든 링크된 워크트리든)가 속한 저장소의 모든 워크트리.
/// 메인 작업 트리가 맨 앞이다. bare 저장소는 메인 작업 트리가 없어 링크된 것만 돌려준다.
/// 작업 디렉토리가 사라진(prune 대기) 워크트리는 뺀다.
///
/// `repo_path` 가 메인 작업 트리면 그 경로를 그대로 메인 작업 트리의 `path` 로 쓴다. libgit2 의
/// `workdir()` 는 심볼릭 링크를 풀어 버려서(`/tmp` → `/private/tmp`), 앱이 저장한 저장소 경로와
/// 달라진다. 화면의 조회 키가 저장소 목록의 경로와 같아야 한다.
pub fn list_review_worktrees(repo_path: &str) -> Result<RepoReviewStatus, git2::Error> {
    let opened = Repository::open(repo_path)?;
    let opened_main = !opened.is_worktree();
    let main = if opened_main { opened } else { Repository::open(common_git_dir(&opened))? };

    let mut worktrees = Vec::new();
    if let Some(workdir) = main.workdir() {
        let (branch, head_oid) = head_info(&main);
        let path = if opened_main { normalize_path(Path::new(repo_path)) } else { normalize_path(workdir) };
        worktrees.push(ReviewWorktree {
            path,
            branch,
            head_oid,
            is_main: true,
        });
    }

    let names = main.worktrees()?;
    for name in names.iter().flatten() {
        let Ok(wt) = main.find_worktree(name) else { continue };
        if wt.validate().is_err() {
            continue;
        }
        let Ok(repo) = Repository::open_from_worktree(&wt) else { continue };
        let (branch, head_oid) = head_info(&repo);
        worktrees.push(ReviewWorktree {
            path: normalize_path(wt.path()),
            branch,
            head_oid,
            is_main: false,
        });
    }

    Ok(RepoReviewStatus { repo_path: repo_path.to_string(), worktrees })
}

/// 링크된 워크트리의 `.git/worktrees/<name>/commondir` 가 가리키는 공용 git 디렉토리.
fn common_git_dir(repo: &Repository) -> std::path::PathBuf {
    let git_dir = repo.path();
    std::fs::read_to_string(git_dir.join("commondir"))
        .map(|rel| git_dir.join(rel.trim()))
        .unwrap_or_else(|_| git_dir.to_path_buf())
}

fn head_info(repo: &Repository) -> (Option<String>, Option<String>) {
    let Ok(head) = repo.head() else { return (None, None) };
    let branch = head.is_branch().then(|| head.shorthand().map(str::to_string)).flatten();
    let oid = head.target().map(|o| o.to_string());
    (branch, oid)
}

fn normalize_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    let trimmed = s.trim_end_matches('/');
    if trimmed.is_empty() { s.to_string() } else { trimmed.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, msg: &str) {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
    }

    fn head(dir: &Path) -> String {
        git(dir, &["rev-parse", "HEAD"])
    }

    /// main 에 커밋 1개가 있는 저장소. 반환값은 메인 작업 트리 경로.
    fn init_repo(name: &str) -> PathBuf {
        let tmp = std::env::temp_dir()
            .join(format!("gitbaro-review-worktrees-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let main = tmp.join("main");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["config", "user.email", "t@t"]);
        git(&main, &["config", "user.name", "t"]);
        commit(&main, "init");
        main.canonicalize().unwrap()
    }

    fn add_worktree(main: &Path, name: &str, branch: &str, from: &str) -> PathBuf {
        let wt = main.parent().unwrap().join(name);
        git(main, &["worktree", "add", "-q", "-b", branch, wt.to_str().unwrap(), from]);
        wt
    }

    #[test]
    fn lists_the_main_worktree_first_then_linked_ones() {
        let main = init_repo("list");
        let wt = add_worktree(&main, "wt-list", "feat/list", "main");
        commit(&wt, "feat 1");

        let status = list_review_worktrees(main.to_str().unwrap()).unwrap();
        assert_eq!(status.repo_path, main.to_str().unwrap());
        assert_eq!(status.worktrees.len(), 2);

        let m = &status.worktrees[0];
        assert!(m.is_main);
        assert_eq!(m.path, main.to_str().unwrap());
        assert_eq!(m.branch.as_deref(), Some("main"));
        assert_eq!(m.head_oid.as_deref(), Some(head(&main).as_str()));

        let l = &status.worktrees[1];
        assert!(!l.is_main);
        assert_eq!(Path::new(&l.path).canonicalize().unwrap(), wt.canonicalize().unwrap());
        assert_eq!(l.branch.as_deref(), Some("feat/list"));
        assert_eq!(l.head_oid.as_deref(), Some(head(&wt).as_str()));

        // 링크된 워크트리 경로로 물어도 같은 저장소의 목록이 나온다.
        let from_wt = list_review_worktrees(wt.to_str().unwrap()).unwrap();
        assert_eq!(from_wt.worktrees.len(), 2);
        assert!(from_wt.worktrees[0].is_main);
        assert_eq!(from_wt.worktrees[0].path, main.to_str().unwrap());
    }

    #[test]
    fn a_detached_worktree_has_no_branch() {
        let main = init_repo("detached");
        git(&main, &["checkout", "-q", "--detach"]);
        let status = list_review_worktrees(main.to_str().unwrap()).unwrap();
        assert_eq!(status.worktrees[0].branch, None);
        assert!(status.worktrees[0].head_oid.is_some());
    }

    #[test]
    fn the_main_worktree_keeps_the_requested_path_through_a_symlink() {
        let main = init_repo("symlink");
        let link = main.parent().unwrap().join("link");
        std::os::unix::fs::symlink(&main, &link).unwrap();
        let requested = link.to_str().unwrap();

        let status = list_review_worktrees(requested).unwrap();
        assert_eq!(status.repo_path, requested);
        assert_eq!(status.worktrees[0].path, requested);
    }
}
