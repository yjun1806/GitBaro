//! 사이드바의 「작업 중인 브랜치」 줄을 고르는 데 쓰는 로컬 브랜치 정보.
//!
//! 줄을 가질지는 화면이 정한다(워크트리에 체크아웃됨 · 원격에 없는 커밋이 있음 · 열린 PR 이 있음 ·
//! 최근 N일 안에 커밋했고 기본 브랜치에 병합되지 않음). 여기서는 그 판단에 드는 git 사실만 준다.
//! PR 은 GitHub 목록이라 화면이 붙이고, N 은 앱 설정(`workingBranchRecentDays`)이다.
//!
//! 「원격에 없는 커밋」은 `git::unpushed` 와 같은 규칙이다(추적 브랜치가 없어도 센다). 브랜치마다
//! revwalk 을 따로 돌리면 오래된 브랜치마다 원격 main 의 최근 이력을 다시 훑으므로, 모든 브랜치 끝을
//! 한 번에 걸어 원격에 없는 커밋 집합을 만들고 브랜치마다 그 집합 안에서만 센다.

use std::collections::{HashMap, HashSet};

use git2::{BranchType, Oid, Repository};
use serde::Serialize;

use crate::git::review_worktrees::list_review_worktrees;
use crate::git::unpushed::{commits_not_on_any_remote, UNPUSHED_LIMIT};
use crate::git::worktree_base::default_branch_with_fallback;

/// 로컬 브랜치 하나. TS `WorkingBranch` 와 같은 모양이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingBranch {
    /// 로컬 브랜치 이름(`feat/x`).
    pub name: String,
    /// 저장소의 기본 브랜치다. 사이드바는 이 브랜치에 줄을 따로 주지 않는다(저장소 줄이 대신한다).
    pub is_default: bool,
    /// 이 브랜치를 체크아웃한 작업 트리(메인 작업 트리 포함). 경로는 `review_status` 의 워크트리 경로와 같다.
    /// 체크아웃하지 않았으면 `None`.
    pub worktree_path: Option<String>,
    /// 추적 브랜치 이름(`origin/feat/x`). 없으면 `None`.
    pub upstream: Option<String>,
    /// 추적 브랜치에만 있는 커밋 수(받을 커밋). 추적 브랜치가 없으면 0.
    pub behind: usize,
    /// 어느 원격에도 없는 커밋 수(올릴 커밋, 많아야 `UNPUSHED_LIMIT`). 원격이 하나도 없으면 0.
    pub unpushed: usize,
    /// 끝 커밋의 커미터 시각(유닉스 초). `get_branches` 의 `lastCommitTime` 과 같다.
    pub last_commit_time: i64,
    /// 끝 커밋이 기본 브랜치(로컬 또는 `origin/<기본>`)에서 닿는다(같은 커밋 포함). 기본 브랜치 자신이거나
    /// 기본 브랜치를 못 찾았으면 `false`.
    pub merged_into_default: bool,
}

/// 저장소(작업 트리) 하나의 결과. TS `RepoWorkingBranches` 와 같은 모양이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoWorkingBranches {
    /// 요청에 넘긴 경로 그대로.
    pub path: String,
    /// 기본 브랜치 이름(`default_branch_with_fallback`). 못 찾으면 `None`.
    pub default_branch: Option<String>,
    /// 로컬 브랜치 전부, 마지막 커밋이 늦은 순.
    pub branches: Vec<WorkingBranch>,
    /// 이 저장소를 읽지 못한 이유. 있으면 나머지는 비어 있다.
    pub error: Option<String>,
}

/// 저장소 하나를 읽는다. 실패는 `error` 에 담는다.
pub fn repo_working_branches(path: &str) -> RepoWorkingBranches {
    read(path).unwrap_or_else(|e| {
        tracing::warn!("[branch] working branches skipped {}: {}", path, e);
        RepoWorkingBranches {
            path: path.to_string(),
            default_branch: None,
            branches: Vec::new(),
            error: Some(e.message().to_string()),
        }
    })
}

/// 계산에 쓰는 로컬 브랜치 하나.
struct Local {
    name: String,
    tip: Oid,
    upstream_name: Option<String>,
    upstream_tip: Option<Oid>,
    /// 추적 브랜치가 로컬 브랜치다(`branch.<x>.remote = .`). 원격 참조를 숨기는 것만으로는 규칙과 같지 않다.
    upstream_is_local: bool,
}

fn read(path: &str) -> Result<RepoWorkingBranches, git2::Error> {
    let repo = Repository::open(path)?;
    let default_branch = default_branch_with_fallback(&repo);
    let locals = local_branches(&repo)?;
    let checked_out: HashMap<String, String> = list_review_worktrees(path)?
        .worktrees
        .into_iter()
        .filter_map(|wt| Some((wt.branch?, wt.path)))
        .collect();
    let default_tips = default_tips(&repo, default_branch.as_deref());
    let unpushed = unpushed_counts(&repo, &locals)?;

    let mut branches = Vec::with_capacity(locals.len());
    for local in &locals {
        let is_default = default_branch.as_deref() == Some(local.name.as_str());
        let behind = match local.upstream_tip {
            Some(up) if up != local.tip => repo.graph_ahead_behind(local.tip, up)?.1,
            _ => 0,
        };
        let merged_into_default = !is_default && is_reachable_from_any(&repo, local.tip, &default_tips)?;
        branches.push(WorkingBranch {
            name: local.name.clone(),
            is_default,
            worktree_path: checked_out.get(&local.name).cloned(),
            upstream: local.upstream_name.clone(),
            behind,
            unpushed: unpushed.get(&local.tip_key()).copied().unwrap_or(0),
            last_commit_time: repo.find_commit(local.tip)?.time().seconds(),
            merged_into_default,
        });
    }
    branches.sort_by(|a, b| b.last_commit_time.cmp(&a.last_commit_time).then(a.name.cmp(&b.name)));

    Ok(RepoWorkingBranches { path: path.to_string(), default_branch, branches, error: None })
}

impl Local {
    /// 같은 끝·같은 추적 브랜치면 답이 같다.
    fn tip_key(&self) -> (Oid, Option<Oid>) {
        (self.tip, self.upstream_is_local.then_some(self.upstream_tip).flatten())
    }
}

fn local_branches(repo: &Repository) -> Result<Vec<Local>, git2::Error> {
    let mut out = Vec::new();
    for item in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = item?;
        let Some(name) = branch.name()?.map(str::to_string) else { continue };
        // 커밋을 가리키지 않는 참조(깨진 참조)는 건너뛴다.
        let Some(tip) = branch.get().peel_to_commit().ok().map(|c| c.id()) else { continue };
        let upstream = branch.upstream().ok();
        out.push(Local {
            name,
            tip,
            upstream_name: upstream.as_ref().and_then(|u| u.name().ok().flatten().map(str::to_string)),
            upstream_tip: upstream.as_ref().and_then(|u| u.get().target()),
            upstream_is_local: upstream.as_ref().is_some_and(|u| !u.get().is_remote()),
        });
    }
    Ok(out)
}

/// 병합 판정에 쓰는 기본 브랜치 끝: 로컬 기본 브랜치와 `origin/<기본>`. 원격에서 PR 을 병합했지만 로컬
/// main 을 받지 않은 경우도 병합된 것으로 본다.
fn default_tips(repo: &Repository, name: Option<&str>) -> Vec<Oid> {
    let Some(name) = name else { return Vec::new() };
    let local = repo.find_branch(name, BranchType::Local).ok().and_then(|b| b.get().target());
    let remote = repo
        .find_branch(&format!("origin/{name}"), BranchType::Remote)
        .ok()
        .and_then(|b| b.get().target());
    let mut tips: Vec<Oid> = local.into_iter().chain(remote).collect();
    tips.dedup();
    tips
}

fn is_reachable_from_any(repo: &Repository, commit: Oid, tips: &[Oid]) -> Result<bool, git2::Error> {
    for &tip in tips {
        if tip == commit || repo.graph_descendant_of(tip, commit)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 브랜치(끝, 로컬 추적 브랜치 끝)마다 원격에 없는 커밋 수.
///
/// 원격 추적 참조가 있으면 모든 브랜치 끝을 한 번에 걸어 원격에 없는 커밋 집합과 그 부모를 모으고, 브랜치마다
/// 그 집합 안에서 닿는 커밋만 센다. 집합이 `UNPUSHED_LIMIT` 를 넘거나(한 번도 fetch 하지 않은 원격 등),
/// 추적 브랜치가 로컬 브랜치면 그 브랜치만 `commits_not_on_any_remote` 로 따로 센다.
fn unpushed_counts(repo: &Repository, locals: &[Local]) -> Result<HashMap<(Oid, Option<Oid>), usize>, git2::Error> {
    let mut counts = HashMap::new();
    if locals.is_empty() || repo.remotes()?.is_empty() {
        return Ok(counts);
    }
    let has_remote_refs = repo.references_glob("refs/remotes/*")?.next().is_some();
    let shared = if has_remote_refs { unpushed_graph(repo, locals)? } else { None };

    for local in locals {
        let key = local.tip_key();
        if counts.contains_key(&key) {
            continue;
        }
        let count = match (&shared, local.upstream_is_local) {
            (Some(graph), false) => count_within(graph, local.tip),
            _ => commits_not_on_any_remote(repo, &[local.tip], local.upstream_tip, UNPUSHED_LIMIT)?.len(),
        };
        counts.insert(key, count);
    }
    Ok(counts)
}

/// 모든 로컬 브랜치 끝에서 닿지만 어느 원격 추적 참조에서도 닿지 않는 커밋과 그 부모. 많아서 잘리면 `None`.
fn unpushed_graph(repo: &Repository, locals: &[Local]) -> Result<Option<HashMap<Oid, Vec<Oid>>>, git2::Error> {
    let mut walk = repo.revwalk()?;
    let mut pushed = HashSet::new();
    for local in locals {
        if pushed.insert(local.tip) {
            walk.push(local.tip)?;
        }
    }
    walk.hide_glob("refs/remotes/*")?;
    let oids = walk.take(UNPUSHED_LIMIT + 1).collect::<Result<Vec<_>, _>>()?;
    if oids.len() > UNPUSHED_LIMIT {
        return Ok(None);
    }
    let mut graph = HashMap::with_capacity(oids.len());
    for oid in oids {
        graph.insert(oid, repo.find_commit(oid)?.parent_ids().collect());
    }
    Ok(Some(graph))
}

/// `graph` 안에서 `tip` 부터 부모를 따라 닿는 커밋 수(`tip` 포함). `tip` 이 밖이면 0.
fn count_within(graph: &HashMap<Oid, Vec<Oid>>, tip: Oid) -> usize {
    let mut seen = HashSet::new();
    let mut stack = vec![tip];
    while let Some(oid) = stack.pop() {
        let Some(parents) = graph.get(&oid) else { continue };
        if seen.insert(oid) {
            stack.extend(parents.iter().copied());
        }
    }
    seen.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// 끝나면(테스트가 실패해도) 지우는 임시 폴더.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir()
                .join(format!("gitbaro-working-branches-{name}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, msg: &str) {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
    }

    /// 커미터 시각을 정해 커밋한다.
    fn commit_at(dir: &Path, msg: &str, unix: i64) {
        let date = format!("@{unix} +0000");
        let out = Command::new("git")
            .args(["commit", "-q", "--allow-empty", "-m", msg])
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .output()
            .unwrap();
        assert!(out.status.success());
    }

    /// 원격(bare)과 그 클론. 원격 main 에 커밋 하나.
    fn clone_pair(tmp: &TempDir) -> PathBuf {
        let seed = tmp.0.join("seed");
        std::fs::create_dir_all(&seed).unwrap();
        git(&seed, &["init", "-q", "-b", "main"]);
        commit(&seed, "init");
        git(&tmp.0, &["clone", "-q", "--bare", "seed", "origin.git"]);
        git(&tmp.0, &["clone", "-q", "origin.git", "work"]);
        tmp.0.join("work")
    }

    fn branch<'a>(r: &'a RepoWorkingBranches, name: &str) -> &'a WorkingBranch {
        r.branches.iter().find(|b| b.name == name).unwrap_or_else(|| panic!("{name} 없음"))
    }

    #[test]
    fn counts_commits_not_on_any_remote_for_branches_not_checked_out() {
        let tmp = TempDir::new("unpushed");
        let work = clone_pair(&tmp);
        git(&work, &["checkout", "-q", "-b", "feat/a"]);
        commit(&work, "a1");
        commit(&work, "a2");
        git(&work, &["checkout", "-q", "-b", "feat/b", "main"]);
        commit(&work, "b1");
        git(&work, &["push", "-q", "-u", "origin", "feat/b"]);
        commit(&work, "b2");
        // feat/c 는 feat/a 위에 쌓았다. feat/a 의 두 커밋도 원격에 없으므로 함께 센다.
        git(&work, &["checkout", "-q", "-b", "feat/c", "feat/a"]);
        commit(&work, "c1");
        git(&work, &["checkout", "-q", "main"]);

        let r = repo_working_branches(work.to_str().unwrap());
        assert_eq!(r.error, None);
        assert_eq!(r.default_branch.as_deref(), Some("main"));
        assert_eq!(branch(&r, "feat/a").unpushed, 2);
        assert_eq!(branch(&r, "feat/a").upstream, None);
        assert_eq!(branch(&r, "feat/b").unpushed, 1);
        assert_eq!(branch(&r, "feat/b").upstream.as_deref(), Some("origin/feat/b"));
        assert_eq!(branch(&r, "feat/c").unpushed, 3);
        assert_eq!(branch(&r, "main").unpushed, 0);
        assert!(branch(&r, "main").is_default);
    }

    #[test]
    fn counts_match_the_per_branch_rule() {
        let tmp = TempDir::new("same-rule");
        let work = clone_pair(&tmp);
        for (name, n) in [("x", 1), ("y", 3), ("z", 0)] {
            git(&work, &["checkout", "-q", "-b", name, "main"]);
            for i in 0..n {
                commit(&work, &format!("{name}{i}"));
            }
        }
        git(&work, &["checkout", "-q", "-b", "m", "x"]);
        git(&work, &["merge", "-q", "--no-ff", "--no-edit", "y"]);

        let repo = Repository::open(&work).unwrap();
        let r = repo_working_branches(work.to_str().unwrap());
        for b in &r.branches {
            let tip = repo.find_branch(&b.name, BranchType::Local).unwrap().get().target().unwrap();
            let expected = commits_not_on_any_remote(&repo, &[tip], None, UNPUSHED_LIMIT).unwrap().len();
            assert_eq!(b.unpushed, expected, "{}", b.name);
        }
        assert_eq!(branch(&r, "m").unpushed, 5, "병합 커밋 + x 1 + y 3");
    }

    #[test]
    fn a_local_upstream_counts_as_pushed() {
        let tmp = TempDir::new("local-upstream");
        let work = clone_pair(&tmp);
        git(&work, &["checkout", "-q", "-b", "base"]);
        commit(&work, "on base");
        git(&work, &["checkout", "-q", "-b", "feat"]);
        git(&work, &["branch", "-q", "--set-upstream-to=base"]);
        commit(&work, "mine");

        let r = repo_working_branches(work.to_str().unwrap());
        assert_eq!(branch(&r, "feat").unpushed, 1);
        assert_eq!(branch(&r, "base").unpushed, 1);
    }

    #[test]
    fn without_any_remote_nothing_is_unpushed() {
        let tmp = TempDir::new("no-remote");
        let dir = tmp.0.join("r");
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        commit(&dir, "m");
        git(&dir, &["checkout", "-q", "-b", "feat"]);
        commit(&dir, "f");

        let r = repo_working_branches(dir.to_str().unwrap());
        assert!(r.branches.iter().all(|b| b.unpushed == 0));
    }

    #[test]
    fn a_never_fetched_remote_counts_every_commit() {
        let tmp = TempDir::new("never-fetched");
        let dir = tmp.0.join("r");
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        commit(&dir, "m1");
        commit(&dir, "m2");
        git(&dir, &["remote", "add", "origin", "https://example.invalid/r.git"]);

        let r = repo_working_branches(dir.to_str().unwrap());
        assert_eq!(branch(&r, "main").unpushed, 2);
    }

    #[test]
    fn merged_last_commit_behind_and_worktree_are_reported() {
        let tmp = TempDir::new("facts");
        let work = clone_pair(&tmp);
        git(&work, &["checkout", "-q", "-b", "merged"]);
        commit_at(&work, "merged work", 1_700_000_100);
        git(&work, &["checkout", "-q", "-b", "open", "main"]);
        commit_at(&work, "open work", 1_700_000_200);
        git(&work, &["checkout", "-q", "main"]);
        git(&work, &["merge", "-q", "--ff-only", "merged"]);
        // 원격에서만 병합된 브랜치: origin/main 에만 있다.
        git(&work, &["checkout", "-q", "-b", "remote-merged", "main"]);
        commit_at(&work, "remote merged", 1_700_000_300);
        git(&work, &["push", "-q", "origin", "remote-merged:main"]);
        git(&work, &["checkout", "-q", "main"]);
        // 받을 커밋: 원격 feat 에 한 커밋 더.
        git(&work, &["checkout", "-q", "-b", "behind", "main"]);
        git(&work, &["push", "-q", "-u", "origin", "behind"]);
        commit(&work, "ahead");
        git(&work, &["push", "-q", "origin", "behind"]);
        git(&work, &["reset", "-q", "--hard", "HEAD~1"]);
        git(&work, &["checkout", "-q", "main"]);
        let wt = tmp.0.join("wt");
        git(&work, &["worktree", "add", "-q", wt.to_str().unwrap(), "open"]);

        let r = repo_working_branches(work.to_str().unwrap());
        assert!(branch(&r, "merged").merged_into_default);
        assert!(!branch(&r, "open").merged_into_default);
        assert!(branch(&r, "remote-merged").merged_into_default, "origin/main 에서 닿으면 병합된 것");
        assert!(!branch(&r, "main").merged_into_default, "기본 브랜치 자신은 false");
        assert_eq!(branch(&r, "open").last_commit_time, 1_700_000_200);
        assert_eq!(branch(&r, "behind").behind, 1);
        // 링크된 워크트리 경로는 `review_status` 와 같이 libgit2 가 준 경로다(심볼릭 링크가 풀린다).
        let wt_real = wt.canonicalize().unwrap();
        assert_eq!(branch(&r, "open").worktree_path.as_deref(), Some(wt_real.to_str().unwrap()));
        assert_eq!(branch(&r, "main").worktree_path.as_deref(), Some(work.to_str().unwrap()));
        assert_eq!(branch(&r, "merged").worktree_path, None);
        // 마지막 커밋이 늦은 순.
        let times: Vec<i64> = r.branches.iter().map(|b| b.last_commit_time).collect();
        assert!(times.windows(2).all(|w| w[0] >= w[1]));
    }

    #[test]
    fn a_linked_worktree_path_reads_the_same_branches() {
        let tmp = TempDir::new("linked");
        let work = clone_pair(&tmp);
        let wt = tmp.0.join("wt");
        git(&work, &["worktree", "add", "-q", "-b", "feat", wt.to_str().unwrap()]);
        commit(&wt, "f");

        let r = repo_working_branches(wt.to_str().unwrap());
        assert_eq!(r.error, None);
        assert_eq!(r.path, wt.to_str().unwrap());
        assert_eq!(branch(&r, "feat").unpushed, 1);
        let wt_real = wt.canonicalize().unwrap();
        assert_eq!(branch(&r, "feat").worktree_path.as_deref(), Some(wt_real.to_str().unwrap()));
    }

    #[test]
    fn a_missing_repository_fills_only_its_error() {
        let r = repo_working_branches("/definitely/not/a/repo");
        assert!(r.error.is_some());
        assert!(r.branches.is_empty());
    }

    #[test]
    fn serialized_shape_matches_the_typescript_types() {
        let r = RepoWorkingBranches {
            path: "/r".into(),
            default_branch: Some("main".into()),
            branches: vec![WorkingBranch {
                name: "feat".into(),
                is_default: false,
                worktree_path: None,
                upstream: Some("origin/feat".into()),
                behind: 1,
                unpushed: 2,
                last_commit_time: 3,
                merged_into_default: false,
            }],
            error: None,
        };
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            serde_json::json!({
                "path": "/r",
                "defaultBranch": "main",
                "branches": [{
                    "name": "feat", "isDefault": false, "worktreePath": null, "upstream": "origin/feat",
                    "behind": 1, "unpushed": 2, "lastCommitTime": 3, "mergedIntoDefault": false
                }],
                "error": null
            })
        );
    }
}
