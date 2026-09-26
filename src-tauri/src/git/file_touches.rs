//! 원격에 없는 커밋이 파일마다 어떻게 닿았나(워크스페이스 리뷰의 「파일별 보기」).
//!
//! 두 가지를 함께 준다.
//! - 파일 목록과 파일마다의 합친 변경: push 하면 실제로 바뀌는 것, 곧 `range_base` → HEAD 비교다
//!   (`push_base` 가 `range_base` 를 고른다). `git pull` 로 병합해 들어온 동료의 변경은 이미 원격에
//!   있으므로 목록에 없다.
//! - 파일마다 그 파일을 건드린 커밋: `git::unpushed` 기준(`git rev-list HEAD --not --remotes`)의
//!   원격에 없는 커밋 중 병합 커밋이 아닌 것만, 커밋마다 첫 부모와 비교한다. 병합 커밋은 첫 부모 대비
//!   diff 에 병합해 들여온 남의 변경이 섞이므로 파일별 목록에 넣지 않고 수(`merges`)만 센다.
//!
//! 이름을 바꾼 파일은 지금(HEAD) 이름으로 묶는다. 결과는 입력(HEAD·추적 브랜치·원격 참조)이 그대로면
//! 다시 계산하지 않는다(`repo_file_touches_cached`).

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use git2::{BranchType, ErrorCode, Oid, Repository};
use serde::Serialize;

use crate::git::commit::subject_line;
use crate::git::engine::FileStatus;
use crate::git::file_diff::{changed_files_between, ChangedFile};
use crate::git::unpushed::{commits_not_on_any_remote, upstream_tip};
use crate::git::worktree_base::default_branch_with_fallback;

/// 커밋을 이만큼만 읽는다(커밋마다 diff 를 만드는 것도 이만큼만). 넘으면 `truncated`.
pub const FILE_TOUCHES_LIMIT: usize = 500;

/// 캐시에 두는 저장소(워크트리) 수. 넘으면 비운다.
const CACHE_LIMIT: usize = 256;

/// 파일 하나를 건드린 커밋 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTouch {
    pub oid: String,
    pub short_oid: String,
    /// 커밋 메시지 첫 줄.
    pub subject: String,
    /// 작성 시각(유닉스 초).
    pub author_time: i64,
    /// 부모. 이 커밋만의 diff 는 `parent_oid` → `oid` 로 본다. 첫 커밋이면 `None`(빈 트리).
    /// 병합 커밋은 목록에 오지 않으므로 부모는 하나다.
    pub parent_oid: Option<String>,
    /// 이 커밋에서의 경로. 뒤에서 이름을 바꿨으면 파일의 지금 경로와 다르다.
    pub path: String,
    /// 이 커밋에서 이름을 바꿨으면 이전 경로.
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    pub too_large: bool,
}

/// push 하면 바뀌는 파일 하나, 또는 원격에 없는 커밋이 건드렸지만 결과가 base 와 같은 파일.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTouches {
    /// HEAD 기준 경로. 지운 파일은 지우기 전 경로.
    pub path: String,
    /// `range_base` → HEAD 에서 이름이 바뀌었으면 base 쪽 경로. 이름을 바꾸며 내용도 많이 고쳐 git 이
    /// 이름 바꾸기로 보지 않으면 `None` 이고 `status` 는 `added` 다(`git diff` 와 같다).
    pub old_path: Option<String>,
    /// `range_base` → HEAD 의 합친 변경. `None` 이면 커밋들이 건드렸지만 결과가 base 와 같다
    /// (넣었다 되돌림, 만들었다 지움).
    pub status: Option<FileStatus>,
    /// `range_base` → HEAD 의 줄 수. `status` 가 `None` 이면 0.
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    pub too_large: bool,
    /// 이 파일을 건드린 원격에 없는 병합 아닌 커밋, 최신 순. 비어 있으면 병합 커밋에서만 바뀌었다
    /// (충돌 해결 등).
    pub commits: Vec<CommitTouch>,
}

/// 저장소(워크트리) 하나의 결과.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFileTouches {
    /// 요청에 넘긴 경로 그대로.
    pub path: String,
    /// 이 저장소를 읽지 못한 이유. 있으면 나머지는 비어 있다.
    pub error: Option<String>,
    /// 원격에 없는 커밋이 `FILE_TOUCHES_LIMIT` 보다 많아 최신 커밋만 읽었다. 파일별 커밋 목록은 읽은
    /// 커밋만 담는다.
    pub truncated: bool,
    /// 합친 diff 의 옛 쪽(`push_base`). 원격에 없는 커밋이 없으면 `head` 와 같다. 처음 커밋까지 원격에
    /// 없으면 `None`(빈 트리).
    pub range_base: Option<String>,
    /// HEAD 커밋. 커밋이 없는 저장소면 `None`.
    pub head: Option<String>,
    /// 읽은 커밋 중 병합 커밋 수. 이 커밋들은 파일별 커밋 목록에 없다.
    pub merges: usize,
    /// 커밋 2개 이상이 건드린 파일 먼저, 그다음 파일의 커밋 중 가장 늦은 작성 시각 순, 그다음 경로 순.
    pub files: Vec<FileTouches>,
}

impl RepoFileTouches {
    fn empty(path: &str) -> Self {
        RepoFileTouches {
            path: path.to_string(),
            error: None,
            truncated: false,
            range_base: None,
            head: None,
            merges: 0,
            files: Vec::new(),
        }
    }
}

/// 결과를 바꿀 수 있는 입력. HEAD, 추적 브랜치 끝, 모든 원격 추적 참조(원격에 없는 커밋과 기본
/// 브랜치를 정한다). 작업 트리·인덱스는 결과와 상관없다.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Inputs {
    head: Option<Oid>,
    upstream: Option<Oid>,
    remotes: usize,
    remote_refs: Vec<(String, String)>,
}

/// (저장소 경로, 한도) → (입력, 결과)
type TouchesCache = HashMap<(String, usize), (Inputs, RepoFileTouches)>;

/// 저장소 하나를 읽는다. 실패는 `error` 에 담고 에러로 올리지 않는다.
pub fn repo_file_touches(path: &str, limit: usize) -> RepoFileTouches {
    match Repository::open(path).and_then(|repo| file_touches(&repo, path, limit)) {
        Ok(result) => result,
        Err(e) => failed(path, e),
    }
}

/// `repo_file_touches` 와 같지만, HEAD·추적 브랜치·원격 참조가 지난번과 같으면 지난 결과를 준다.
/// 화면이 주기적으로 다시 묻고, 파일 저장·스테이징처럼 결과와 상관없는 변화에도 다시 묻기 때문이다.
pub fn repo_file_touches_cached(path: &str, limit: usize) -> RepoFileTouches {
    static CACHE: OnceLock<Mutex<TouchesCache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let repo = match Repository::open(path) {
        Ok(repo) => repo,
        Err(e) => return failed(path, e),
    };
    let key = (path.to_string(), limit);
    let inputs = match inputs(&repo) {
        Ok(inputs) => inputs,
        Err(e) => return failed(path, e),
    };
    if let Some((cached_inputs, cached)) = cache.lock().ok().as_ref().and_then(|map| map.get(&key)) {
        if *cached_inputs == inputs {
            return cached.clone();
        }
    }
    let result = match file_touches(&repo, path, limit) {
        Ok(result) => result,
        Err(e) => return failed(path, e),
    };
    if let Ok(mut map) = cache.lock() {
        if map.len() >= CACHE_LIMIT {
            map.clear();
        }
        map.insert(key, (inputs, result.clone()));
    }
    result
}

fn failed(path: &str, e: git2::Error) -> RepoFileTouches {
    RepoFileTouches { error: Some(e.message().to_string()), ..RepoFileTouches::empty(path) }
}

/// HEAD 참조와 그 추적 브랜치 끝. HEAD 가 없으면(빈 저장소) `None`.
fn head_and_upstream(repo: &Repository) -> Result<Option<(Oid, Option<Oid>)>, git2::Error> {
    let head_ref = match repo.head() {
        Ok(head_ref) => head_ref,
        Err(e) if e.code() == ErrorCode::UnbornBranch => return Ok(None),
        Err(e) => return Err(e),
    };
    let head = head_ref.peel_to_commit()?.id();
    let upstream = head_ref
        .is_branch()
        .then(|| head_ref.shorthand())
        .flatten()
        .and_then(|name| repo.find_branch(name, BranchType::Local).ok())
        .as_ref()
        .and_then(upstream_tip);
    Ok(Some((head, upstream)))
}

fn inputs(repo: &Repository) -> Result<Inputs, git2::Error> {
    let (head, upstream) = head_and_upstream(repo)?.map_or((None, None), |(h, u)| (Some(h), u));
    let mut remote_refs = Vec::new();
    for reference in repo.references_glob("refs/remotes/*")? {
        let reference = reference?;
        let name = reference.name().unwrap_or("").to_string();
        // origin/HEAD 는 이름을 가리킨다(기본 브랜치가 바뀌면 달라진다).
        let target = match reference.target() {
            Some(oid) => oid.to_string(),
            None => reference.symbolic_target().unwrap_or("").to_string(),
        };
        remote_refs.push((name, target));
    }
    remote_refs.sort();
    Ok(Inputs { head, upstream, remotes: repo.remotes()?.len(), remote_refs })
}

fn file_touches(repo: &Repository, path: &str, limit: usize) -> Result<RepoFileTouches, git2::Error> {
    let Some((head, upstream)) = head_and_upstream(repo)? else {
        return Ok(RepoFileTouches::empty(path));
    };

    // 하나 더 읽어 한도를 넘었는지 안다.
    let mut oids = commits_not_on_any_remote(repo, &[head], upstream, limit + 1)?;
    let truncated = oids.len() > limit;
    oids.truncate(limit);
    let base = RepoFileTouches { head: Some(head.to_string()), truncated, ..RepoFileTouches::empty(path) };
    if oids.is_empty() {
        return Ok(RepoFileTouches { range_base: Some(head.to_string()), ..base });
    }

    let range_base = push_base(repo, head, upstream, &oids.iter().copied().collect())?;
    let base_tree = range_base.map(|oid| repo.find_commit(oid).and_then(|c| c.tree())).transpose()?;
    let head_tree = repo.find_commit(head)?.tree()?;
    let combined = changed_files_between(repo, base_tree.as_ref(), &head_tree)?;

    // 최신 커밋부터 읽으며, 그 시점의 경로 → 지금 경로를 이어 간다(이름 바꾸기를 거슬러 올라간다).
    let mut current_path: HashMap<String, String> = HashMap::new();
    let mut groups: HashMap<String, Vec<CommitTouch>> = HashMap::new();
    let mut merges = 0;
    for oid in &oids {
        let commit = repo.find_commit(*oid)?;
        if commit.parent_count() > 1 {
            merges += 1;
            continue;
        }
        let parent = commit.parent_ids().next();
        let parent_tree = parent.map(|p| repo.find_commit(p).and_then(|c| c.tree())).transpose()?;
        for file in changed_files_between(repo, parent_tree.as_ref(), &commit.tree()?)? {
            let key = current_path.get(&file.path).cloned().unwrap_or_else(|| file.path.clone());
            if let Some(old) = &file.old_path {
                current_path.insert(old.clone(), key.clone());
            }
            groups.entry(key).or_default().push(commit_touch(&commit, parent, file));
        }
    }

    // push 하면 바뀌는 파일 전부 + 커밋이 건드렸지만 결과가 base 와 같은 파일.
    let mut files: Vec<FileTouches> = combined
        .into_iter()
        .map(|range| {
            let commits = groups.remove(&range.path).unwrap_or_default();
            FileTouches {
                old_path: range.old_path,
                status: Some(range.status),
                additions: range.additions,
                deletions: range.deletions,
                is_binary: range.is_binary,
                too_large: range.too_large,
                path: range.path,
                commits,
            }
        })
        .collect();
    files.extend(groups.into_iter().map(|(path, commits)| FileTouches {
        old_path: None,
        status: None,
        additions: 0,
        deletions: 0,
        is_binary: commits.iter().any(|c| c.is_binary),
        too_large: commits.iter().any(|c| c.too_large),
        path,
        commits,
    }));
    files.sort_by(|a, b| {
        (b.commits.len() >= 2)
            .cmp(&(a.commits.len() >= 2))
            .then(latest_touch_time(b).cmp(&latest_touch_time(a)))
            .then(a.path.cmp(&b.path))
    });

    Ok(RepoFileTouches { range_base: range_base.map(|o| o.to_string()), merges, files, ..base })
}

/// 파일의 정렬 시각: 그 파일을 건드린 커밋 중 가장 늦은 작성 시각. 커밋이 없으면 0.
/// 화면(`file-touches-model.ts`의 `latestTouchTime`)도 저장소를 넘나들어 같은 규칙으로 다시 정렬한다.
pub fn latest_touch_time(file: &FileTouches) -> i64 {
    file.commits.iter().map(|c| c.author_time).max().unwrap_or(0)
}

/// 합친 diff 의 옛 쪽: push 하면 원격에서 HEAD 로 바뀌는 범위의 시작.
///
/// - 추적 브랜치가 있으면 HEAD 와 그 끝의 공통 조상(`git diff @{u}...HEAD`). HEAD 가 추적 브랜치를
///   품고 있으면(pull 한 뒤) 추적 브랜치 끝 자신이라 `git diff @{u} HEAD` 와 같다. 아직 pull 하지
///   않아 갈라져 있으면 동료의 새 커밋을 되돌리는 것처럼 보이지 않게 갈라진 지점을 쓴다.
/// - 추적 브랜치가 없으면(publish 전, detached) 두 후보 중 HEAD 에 가까운 쪽.
///   1. 원격 기본 브랜치(`origin/<기본 브랜치>`)와의 공통 조상. 기본 브랜치를 병합해 들였으면
///      그 병합 뒤라서 들여온 남의 변경이 빠진다. PR 이 보여 줄 범위와 같다.
///   2. HEAD 에서 첫 부모를 따라 내려가 원격에 없는 커밋 밖에서 처음 만나는 커밋. 이미 올린 다른
///      브랜치(`origin/feat-a`) 위에 쌓은 브랜치면 이쪽이 가깝다. 읽은 커밋이 잘렸으면 읽은 범위의 끝이다.
///
/// 두 후보가 서로의 조상이 아니면(쌓은 브랜치에 기본 브랜치를 병합) 1 을 쓴다.
fn push_base(repo: &Repository, head: Oid, upstream: Option<Oid>, read: &HashSet<Oid>) -> Result<Option<Oid>, git2::Error> {
    if let Some(upstream) = upstream {
        if let Some(base) = merge_base(repo, head, upstream)? {
            return Ok(Some(base));
        }
    }
    let below = first_parent_below(repo, head, read)?;
    let default = default_remote_tip(repo).map(|tip| merge_base(repo, head, tip)).transpose()?.flatten();
    Ok(match (below, default) {
        (Some(below), Some(default)) if below != default && repo.graph_descendant_of(below, default)? => Some(below),
        (_, Some(default)) => Some(default),
        (below, None) => below,
    })
}

/// 공통 조상. 이력이 이어지지 않으면 `None`.
fn merge_base(repo: &Repository, a: Oid, b: Oid) -> Result<Option<Oid>, git2::Error> {
    match repo.merge_base(a, b) {
        Ok(base) => Ok(Some(base)),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// `origin/<기본 브랜치>` 의 끝. 기본 브랜치는 `merge_base::divergence_point` 와 같은 규칙으로 고른다.
fn default_remote_tip(repo: &Repository) -> Option<Oid> {
    let name = default_branch_with_fallback(repo)?;
    repo.find_branch(&format!("origin/{name}"), BranchType::Remote).ok()?.get().target()
}

/// HEAD 에서 첫 부모를 따라 내려가 `range` 밖에서 처음 만나는 커밋. 처음 커밋까지 닿으면 `None`.
fn first_parent_below(repo: &Repository, head: Oid, range: &HashSet<Oid>) -> Result<Option<Oid>, git2::Error> {
    let mut at = head;
    while range.contains(&at) {
        match repo.find_commit(at)?.parent_ids().next() {
            Some(parent) => at = parent,
            None => return Ok(None),
        }
    }
    Ok(Some(at))
}

fn commit_touch(commit: &git2::Commit, parent: Option<Oid>, file: ChangedFile) -> CommitTouch {
    let oid = commit.id().to_string();
    CommitTouch {
        short_oid: oid[..8].to_string(),
        oid,
        subject: subject_line(commit.message().unwrap_or("")).to_string(),
        author_time: commit.author().when().seconds(),
        parent_oid: parent.map(|p| p.to_string()),
        path: file.path,
        old_path: file.old_path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        is_binary: file.is_binary,
        too_large: file.too_large,
    }
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
                .join(format!("gitbaro-touches-{name}-{}-{nanos}", std::process::id()));
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

    fn write(dir: &Path, rel: &str, content: &str) {
        let file = dir.join(rel);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }

    /// 작성 시각을 기준 시각 + `at` 초로 고정해 커밋한다(정렬을 시각으로 확인한다).
    fn commit_at(dir: &Path, msg: &str, at: i64) -> String {
        let date = format!("@{} +0000", 1_700_000_000 + at);
        git(dir, &["add", "-A"]);
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
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        git(dir, &["rev-parse", "HEAD"])
    }

    /// 원격(bare)에 커밋 하나(`base.txt`, `a.txt`)를 올리고 clone 한 작업 폴더와 그 커밋.
    fn cloned(tmp: &TempDir) -> (PathBuf, String) {
        let seed = tmp.0.join("seed");
        std::fs::create_dir_all(&seed).unwrap();
        git(&seed, &["init", "-q", "-b", "main"]);
        write(&seed, "a.txt", "one\n");
        write(&seed, "base.txt", "base\n");
        let pushed = commit_at(&seed, "base", 1_000);
        git(&tmp.0, &["clone", "-q", "--bare", "seed", "origin.git"]);
        git(&tmp.0, &["clone", "-q", "origin.git", "work"]);
        (tmp.0.join("work"), pushed)
    }

    fn touches(dir: &Path) -> RepoFileTouches {
        repo_file_touches(dir.to_str().unwrap(), FILE_TOUCHES_LIMIT)
    }

    fn file<'a>(r: &'a RepoFileTouches, path: &str) -> &'a FileTouches {
        r.files.iter().find(|f| f.path == path).unwrap_or_else(|| panic!("{path} 없음: {:?}", r.files))
    }

    fn oids(f: &FileTouches) -> Vec<&str> {
        f.commits.iter().map(|c| c.oid.as_str()).collect()
    }

    #[test]
    fn groups_commits_by_file_newest_first_with_combined_counts() {
        let tmp = TempDir::new("group");
        let (work, pushed) = cloned(&tmp);
        write(&work, "a.txt", "one\ntwo\n");
        let c1 = commit_at(&work, "[XMS-1] two", 2_000);
        write(&work, "b.txt", "b\n");
        let c2 = commit_at(&work, "b", 3_000);
        write(&work, "a.txt", "one\ntwo\nthree\nfour\n");
        let c3 = commit_at(&work, "[XMS-2] more", 4_000);

        let r = touches(&work);
        assert_eq!(r.error, None);
        assert!(!r.truncated);
        assert_eq!(r.range_base.as_deref(), Some(pushed.as_str()));
        assert_eq!(r.head.as_deref(), Some(c3.as_str()));
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["a.txt", "b.txt"], "커밋 2개가 건드린 파일 먼저");

        let a = file(&r, "a.txt");
        assert_eq!(oids(a), vec![c3.as_str(), c1.as_str()]);
        assert_eq!((a.status.clone(), a.additions, a.deletions), (Some(FileStatus::Modified), 3, 0), "base → HEAD 합친 줄 수");
        let newest = &a.commits[0];
        assert_eq!((newest.additions, newest.deletions, newest.status.clone()), (2, 0, FileStatus::Modified));
        assert_eq!(newest.subject, "[XMS-2] more");
        assert_eq!(newest.author_time, 1_700_004_000);
        assert_eq!(newest.short_oid, &c3[..8]);
        assert_eq!(newest.parent_oid.as_deref(), Some(c2.as_str()));
        assert_eq!(a.commits[1].parent_oid.as_deref(), Some(pushed.as_str()));

        let b = file(&r, "b.txt");
        assert_eq!((b.status.clone(), oids(b)), (Some(FileStatus::Added), vec![c2.as_str()]));
    }

    #[test]
    fn single_touch_files_are_ordered_by_newest_commit() {
        let tmp = TempDir::new("order");
        let (work, _) = cloned(&tmp);
        write(&work, "old.txt", "x\n");
        commit_at(&work, "old", 2_000);
        write(&work, "new.txt", "x\n");
        commit_at(&work, "new", 3_000);
        let r = touches(&work);
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["new.txt", "old.txt"]);
    }

    #[test]
    fn a_rename_keeps_the_file_under_its_current_name() {
        let tmp = TempDir::new("rename");
        let (work, _) = cloned(&tmp);
        let lines = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n";
        write(&work, "doc.txt", lines);
        commit_at(&work, "doc", 1_500);
        git(&work, &["push", "-q", "origin", "main"]);
        write(&work, "doc.txt", &format!("{lines}l9\n"));
        let edit = commit_at(&work, "edit doc", 2_000);
        git(&work, &["mv", "doc.txt", "renamed.txt"]);
        let mv = commit_at(&work, "rename", 3_000);
        write(&work, "renamed.txt", &format!("{lines}l9\nl10\n"));
        let after = commit_at(&work, "edit renamed", 4_000);

        let r = touches(&work);
        assert_eq!(r.files.len(), 1, "{:?}", r.files);
        let f = file(&r, "renamed.txt");
        assert_eq!(oids(f), vec![after.as_str(), mv.as_str(), edit.as_str()]);
        assert_eq!((f.status.clone(), f.old_path.as_deref()), (Some(FileStatus::Renamed), Some("doc.txt")));
        assert_eq!((f.additions, f.deletions), (2, 0));
        let rename = &f.commits[1];
        assert_eq!(
            (rename.status.clone(), rename.path.as_str(), rename.old_path.as_deref()),
            (FileStatus::Renamed, "renamed.txt", Some("doc.txt"))
        );
        assert_eq!(f.commits[2].path, "doc.txt", "이름 바꾸기 전 커밋은 그때의 경로로 diff 를 본다");

        // 화면은 이 값을 그대로 `get_range_file_diff` 에 넘긴다.
        use crate::commands::range_changes::range_file_diff;
        let dir = work.to_str().unwrap();
        let combined = range_file_diff(dir, r.range_base.as_deref(), r.head.as_deref().unwrap(), &f.path, f.old_path.as_deref()).unwrap();
        assert_eq!((combined.insertions, combined.deletions), (2, 0));
        for c in &f.commits {
            let one = range_file_diff(dir, c.parent_oid.as_deref(), &c.oid, &c.path, c.old_path.as_deref()).unwrap();
            assert_eq!((one.insertions, one.deletions), (c.additions, c.deletions), "{}", c.subject);
        }
    }

    #[test]
    fn binary_files_are_marked_without_line_counts() {
        let tmp = TempDir::new("binary");
        let (work, _) = cloned(&tmp);
        std::fs::write(work.join("img.bin"), [0u8, 1, 2, 0, 255]).unwrap();
        commit_at(&work, "img", 2_000);
        std::fs::write(work.join("img.bin"), [0u8, 9, 9, 0, 255, 7]).unwrap();
        commit_at(&work, "img again", 3_000);
        let f = file(&touches(&work), "img.bin").clone();
        assert!(f.is_binary);
        assert_eq!((f.additions, f.deletions), (0, 0));
        assert!(f.commits.iter().all(|c| c.is_binary && c.additions == 0 && c.deletions == 0));
    }

    #[test]
    fn a_merge_commit_is_left_out_of_per_file_lists() {
        // 로컬 브랜치 둘을 병합했다. 병합 커밋의 첫 부모 대비 diff 는 side.txt 를 담지만, 그 변경은
        // side 커밋이 이미 목록에 있다. 병합을 넣으면 같은 변경을 두 번 센다.
        let tmp = TempDir::new("merge");
        let (work, pushed) = cloned(&tmp);
        git(&work, &["checkout", "-q", "-b", "side"]);
        write(&work, "side.txt", "s\n");
        let side = commit_at(&work, "side", 2_000);
        git(&work, &["checkout", "-q", "main"]);
        write(&work, "main.txt", "m\n");
        let on_main = commit_at(&work, "main", 3_000);
        git(&work, &["merge", "-q", "--no-ff", "--no-edit", "side"]);

        let r = touches(&work);
        assert_eq!(r.range_base.as_deref(), Some(pushed.as_str()), "추적 브랜치(origin/main) 끝");
        assert_eq!(r.merges, 1);
        let s = file(&r, "side.txt");
        assert_eq!(oids(s), vec![side.as_str()]);
        assert_eq!(s.status, Some(FileStatus::Added));
        assert_eq!(oids(file(&r, "main.txt")), vec![on_main.as_str()]);
        assert_eq!(r.files.len(), 2);
    }

    /// `origin.git` 을 따로 clone 해 `rel` 을 커밋하고 올린다(동료의 push). 올린 커밋을 돌려준다.
    fn teammate_pushes(tmp: &TempDir, branch: &str, rel: &str, at: i64) -> String {
        let mate = tmp.0.join("mate");
        if !mate.exists() {
            git(&tmp.0, &["clone", "-q", "origin.git", "mate"]);
        }
        git(&mate, &["checkout", "-q", branch]);
        write(&mate, rel, "theirs\n");
        let oid = commit_at(&mate, "teammate", at);
        git(&mate, &["push", "-q", "origin", branch]);
        oid
    }

    #[test]
    fn remote_changes_merged_in_by_a_pull_are_not_unpushed_work() {
        let tmp = TempDir::new("pull-merge");
        let (work, _) = cloned(&tmp);
        let theirs = teammate_pushes(&tmp, "main", "teammate.txt", 1_500);
        write(&work, "mine.txt", "mine\n");
        let mine = commit_at(&work, "mine", 2_000);
        // `git pull --no-rebase` 와 같다.
        git(&work, &["fetch", "-q"]);
        git(&work, &["merge", "-q", "--no-edit", "origin/main"]);

        let r = touches(&work);
        assert_eq!(r.range_base.as_deref(), Some(theirs.as_str()), "push 는 origin/main 끝 위에 올린다");
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["mine.txt"]);
        assert_eq!(oids(file(&r, "mine.txt")), vec![mine.as_str()]);
        assert_eq!(r.merges, 1);
    }

    #[test]
    fn a_never_published_branch_that_merged_the_default_branch_hides_those_changes() {
        let tmp = TempDir::new("feature-merge");
        let (work, _) = cloned(&tmp);
        git(&work, &["checkout", "-q", "-b", "feat"]);
        write(&work, "f.txt", "f\n");
        let f = commit_at(&work, "f", 2_000);
        let theirs = teammate_pushes(&tmp, "main", "teammate.txt", 2_500);
        git(&work, &["fetch", "-q"]);
        git(&work, &["merge", "-q", "--no-edit", "origin/main"]);

        let r = touches(&work);
        assert_eq!(r.range_base.as_deref(), Some(theirs.as_str()), "origin/main 과의 공통 조상");
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["f.txt"]);
        assert_eq!(oids(file(&r, "f.txt")), vec![f.as_str()]);
    }

    #[test]
    fn a_branch_stacked_on_another_pushed_branch_starts_from_that_branch() {
        let tmp = TempDir::new("stacked");
        let (work, _) = cloned(&tmp);
        git(&work, &["checkout", "-q", "-b", "feat-a"]);
        write(&work, "a2.txt", "a\n");
        let a = commit_at(&work, "a", 2_000);
        git(&work, &["push", "-q", "origin", "feat-a"]);
        git(&work, &["checkout", "-q", "-b", "feat-b"]);
        write(&work, "b.txt", "b\n");
        commit_at(&work, "b", 3_000);

        let r = touches(&work);
        assert_eq!(r.range_base.as_deref(), Some(a.as_str()), "origin/main 보다 가까운 origin/feat-a");
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["b.txt"]);
    }

    #[test]
    fn a_change_made_only_in_a_merge_is_listed_without_commits() {
        // 병합하며 고친 파일(충돌 해결 등)도 push 하면 바뀐다. 건드린 병합 아닌 커밋이 없을 뿐이다.
        let tmp = TempDir::new("evil-merge");
        let (work, _) = cloned(&tmp);
        git(&work, &["checkout", "-q", "-b", "side"]);
        write(&work, "side.txt", "s\n");
        commit_at(&work, "side", 2_000);
        git(&work, &["checkout", "-q", "main"]);
        git(&work, &["merge", "-q", "--no-ff", "--no-commit", "side"]);
        write(&work, "base.txt", "fixed in merge\n");
        git(&work, &["add", "-A"]);
        git(&work, &["commit", "-q", "--no-edit"]);

        let r = touches(&work);
        let fixed = file(&r, "base.txt");
        assert_eq!(fixed.status, Some(FileStatus::Modified));
        assert!(fixed.commits.is_empty());
        assert_eq!(r.files.last().map(|f| f.path.as_str()), Some("base.txt"), "커밋이 없어 맨 뒤");
    }

    #[test]
    fn a_diverged_upstream_is_compared_from_the_split_point() {
        // 동료가 올렸지만 아직 pull 하지 않았다. 추적 브랜치 끝과 비교하면 동료의 파일을 지우는 것처럼 보인다.
        let tmp = TempDir::new("diverged");
        let (work, pushed) = cloned(&tmp);
        teammate_pushes(&tmp, "main", "teammate.txt", 1_500);
        git(&work, &["fetch", "-q"]);
        write(&work, "mine.txt", "mine\n");
        commit_at(&work, "mine", 2_000);

        let r = touches(&work);
        assert_eq!(r.range_base.as_deref(), Some(pushed.as_str()));
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["mine.txt"]);
    }

    #[test]
    fn files_are_ordered_by_their_latest_commit_time_not_walk_order() {
        // 작성 시각이 커밋 순서와 거꾸로다(rebase·cherry-pick 뒤 흔하다). 파일의 커밋 중 가장 늦은
        // 작성 시각으로 줄 세운다. 화면의 `latestTouchTime` 과 같은 규칙이다.
        let tmp = TempDir::new("time-order");
        let (work, _) = cloned(&tmp);
        write(&work, "late.txt", "x\n");
        commit_at(&work, "late authored, older commit", 9_000);
        write(&work, "early.txt", "x\n");
        commit_at(&work, "early authored, newer commit", 3_000);
        let r = touches(&work);
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["late.txt", "early.txt"]);
        assert_eq!(latest_touch_time(&r.files[0]), 1_700_009_000);
    }

    #[test]
    fn the_cached_result_is_reused_until_head_or_a_remote_ref_moves() {
        let tmp = TempDir::new("cache");
        let (work, _) = cloned(&tmp);
        write(&work, "a.txt", "two\n");
        let old = commit_at(&work, "old", 2_000);
        write(&work, "a.txt", "three\n");
        commit_at(&work, "new", 3_000);
        let dir = work.to_str().unwrap();
        let first = repo_file_touches_cached(dir, FILE_TOUCHES_LIMIT);
        assert_eq!(first.error, None);

        // 다시 계산하면 깨진 커밋을 읽다 실패한다. 입력이 그대로면 읽지 않는다.
        let hex = &old;
        std::fs::remove_file(work.join(".git/objects").join(&hex[..2]).join(&hex[2..])).unwrap();
        write(&work, "untracked.txt", "wip\n");
        assert_eq!(repo_file_touches_cached(dir, FILE_TOUCHES_LIMIT), first, "작업 트리 변화는 입력이 아니다");

        write(&work, "a.txt", "four\n");
        commit_at(&work, "newer", 4_000);
        assert!(repo_file_touches_cached(dir, FILE_TOUCHES_LIMIT).error.is_some(), "HEAD 가 옮겨 다시 계산했다");
    }

    #[test]
    fn the_cache_notices_a_push_made_elsewhere() {
        let tmp = TempDir::new("cache-push");
        let (work, _) = cloned(&tmp);
        write(&work, "a.txt", "two\n");
        commit_at(&work, "c", 2_000);
        let dir = work.to_str().unwrap();
        assert_eq!(repo_file_touches_cached(dir, FILE_TOUCHES_LIMIT).files.len(), 1);
        git(&work, &["push", "-q", "origin", "main"]);
        assert!(repo_file_touches_cached(dir, FILE_TOUCHES_LIMIT).files.is_empty(), "원격 추적 참조가 옮겨 다시 계산했다");
    }

    #[test]
    fn a_change_that_was_undone_has_no_combined_status() {
        let tmp = TempDir::new("undone");
        let (work, _) = cloned(&tmp);
        write(&work, "tmp.txt", "t\n");
        commit_at(&work, "add tmp", 2_000);
        std::fs::remove_file(work.join("tmp.txt")).unwrap();
        commit_at(&work, "drop tmp", 3_000);
        let f = file(&touches(&work), "tmp.txt").clone();
        assert_eq!(f.status, None);
        assert_eq!(f.commits.len(), 2);
        assert_eq!(f.commits[0].status, FileStatus::Deleted);
    }

    #[test]
    fn a_never_published_branch_counts_every_local_commit_but_not_the_remote_ones() {
        let tmp = TempDir::new("unpublished");
        let (work, pushed) = cloned(&tmp);
        git(&work, &["checkout", "-q", "-b", "feat"]);
        write(&work, "f.txt", "f\n");
        commit_at(&work, "f", 2_000);
        let r = touches(&work);
        assert_eq!(r.range_base.as_deref(), Some(pushed.as_str()));
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["f.txt"]);
    }

    #[test]
    fn a_remote_that_was_never_fetched_makes_every_commit_unpushed() {
        let tmp = TempDir::new("never-fetched");
        let work = tmp.0.join("work");
        std::fs::create_dir_all(&work).unwrap();
        git(&work, &["init", "-q", "-b", "main"]);
        git(&work, &["remote", "add", "origin", "https://example.invalid/r.git"]);
        write(&work, "a.txt", "a\n");
        commit_at(&work, "first", 1_000);
        write(&work, "a.txt", "a\nb\n");
        commit_at(&work, "second", 2_000);
        let r = touches(&work);
        assert_eq!(r.range_base, None, "처음 커밋까지 원격에 없다: 빈 트리와 비교");
        let a = file(&r, "a.txt");
        assert_eq!((a.status.clone(), a.additions, a.commits.len()), (Some(FileStatus::Added), 2, 2));
        assert_eq!(a.commits[1].parent_oid, None);
    }

    #[test]
    fn a_repository_without_any_remote_reports_nothing() {
        // `git::unpushed` 와 같은 규칙: 올릴 곳이 없으면 원격에 없는 커밋도 없다.
        let tmp = TempDir::new("no-remote");
        let (work, _) = cloned(&tmp);
        git(&work, &["remote", "remove", "origin"]);
        write(&work, "a.txt", "changed\n");
        let head = commit_at(&work, "local", 2_000);
        let r = touches(&work);
        assert!(r.files.is_empty());
        assert_eq!((r.head.as_deref(), r.range_base.as_deref()), (Some(head.as_str()), Some(head.as_str())));
    }

    #[test]
    fn a_fully_pushed_branch_is_empty() {
        let tmp = TempDir::new("pushed");
        let (work, _) = cloned(&tmp);
        write(&work, "a.txt", "two\n");
        let head = commit_at(&work, "pushed", 2_000);
        git(&work, &["push", "-q", "origin", "main"]);
        let r = touches(&work);
        assert!(r.files.is_empty() && !r.truncated);
        assert_eq!(r.range_base.as_deref(), Some(head.as_str()));
    }

    #[test]
    fn the_walk_stops_at_the_limit() {
        let tmp = TempDir::new("limit");
        let (work, pushed) = cloned(&tmp);
        let mut made = Vec::new();
        for i in 0..5 {
            write(&work, "a.txt", &format!("v{i}\n"));
            made.push(commit_at(&work, &format!("c{i}"), 2_000 + i));
        }
        let r = repo_file_touches(work.to_str().unwrap(), 3);
        assert!(r.truncated);
        let a = file(&r, "a.txt");
        assert_eq!(oids(a), vec![made[4].as_str(), made[3].as_str(), made[2].as_str()]);
        assert_eq!(r.range_base.as_deref(), Some(pushed.as_str()), "합친 변경은 추적 브랜치부터라 잘리지 않는다");

        let exact = repo_file_touches(work.to_str().unwrap(), 5);
        assert!(!exact.truncated, "딱 한도만큼이면 잘리지 않았다");
    }

    #[test]
    fn a_never_fetched_remote_stops_at_the_limit_and_compares_from_the_end_of_what_was_read() {
        // 원격 참조가 하나도 없으면 모든 커밋이 원격에 없다. 한도 밖 커밋은 읽지도, diff 를 만들지도 않는다.
        use crate::git::walk::tests::delete_commit_object;
        let tmp = TempDir::new("limit-never-fetched");
        let work = tmp.0.join("work");
        std::fs::create_dir_all(&work).unwrap();
        git(&work, &["init", "-q", "-b", "main"]);
        git(&work, &["remote", "add", "origin", "https://example.invalid/r.git"]);
        let mut made = Vec::new();
        for i in 0..6 {
            write(&work, "a.txt", &format!("v{i}\n"));
            made.push(commit_at(&work, &format!("c{i}"), 1_000 + i));
        }
        // 한도보다 하나 더(c5~c2)만 읽는다. 그보다 오래된 c0 이 깨져 있어도 실패하지 않는다.
        delete_commit_object(&work, Oid::from_str(&made[0]).unwrap());
        let r = repo_file_touches(work.to_str().unwrap(), 3);
        assert_eq!(r.error, None);
        assert!(r.truncated);
        assert_eq!(r.range_base.as_deref(), Some(made[2].as_str()), "읽은 범위의 끝");
        assert_eq!(oids(file(&r, "a.txt")), vec![made[5].as_str(), made[4].as_str(), made[3].as_str()]);
    }

    #[test]
    fn a_missing_repository_fills_only_its_error() {
        let r = repo_file_touches("/definitely/not/a/repo", FILE_TOUCHES_LIMIT);
        assert!(r.error.is_some());
        assert!(r.files.is_empty() && r.head.is_none());
    }

    #[test]
    fn an_empty_repository_has_no_head() {
        let tmp = TempDir::new("empty");
        git(&tmp.0, &["init", "-q", "-b", "main"]);
        let r = repo_file_touches(tmp.0.to_str().unwrap(), FILE_TOUCHES_LIMIT);
        assert_eq!((r.error, r.head, r.files.len()), (None, None, 0));
    }

    #[test]
    fn serialized_shape_matches_the_typescript_types() {
        // src/types/index.ts 의 RepoFileTouches·FileTouches·CommitTouch 와 키가 같아야 한다.
        let tmp = TempDir::new("shape");
        let (work, _) = cloned(&tmp);
        write(&work, "a.txt", "two\n");
        commit_at(&work, "c", 2_000);
        let json = serde_json::to_value(touches(&work)).unwrap();
        let keys = |v: &serde_json::Value| {
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort();
            k
        };
        assert_eq!(keys(&json), vec!["error", "files", "head", "merges", "path", "rangeBase", "truncated"]);
        assert_eq!(
            keys(&json["files"][0]),
            vec!["additions", "commits", "deletions", "isBinary", "oldPath", "path", "status", "tooLarge"]
        );
        assert_eq!(
            keys(&json["files"][0]["commits"][0]),
            vec![
                "additions", "authorTime", "deletions", "isBinary", "oid", "oldPath", "parentOid", "path",
                "shortOid", "status", "subject", "tooLarge"
            ]
        );
        assert_eq!(json["files"][0]["status"], "modified");
    }
}
