//! 워크트리 브랜치가 어느 브랜치에서 갈라져 나왔는지(기반 브랜치) 판별한다.
//!
//! 판별 순서:
//! 1. `recorded` — 앱이 워크트리를 만들 때 `branch.<name>.gitbaroBase` 에 적어 둔 값.
//! 2. `reflog` — 브랜치 reflog 의 가장 오래된 항목 `branch: Created from X`.
//!    X 가 `HEAD` 이거나 커밋 해시·태그처럼 브랜치가 아니면 건너뛴다.
//! 3. `inferred` — 후보 브랜치 중 분기점이 가장 가까운 것을 고른 추정값.
//!
//! 1·2 에서 얻은 브랜치가 지금은 없으면(삭제됨) 앞뒤 커밋 수를 셀 수 없으므로
//! 그 값을 버리고 다음 단계로 넘어간다. 결과는 항상 실제로 존재하는 브랜치다.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use git2::{BranchType, Oid, Repository};
use serde::Serialize;

/// `branch.<name>.<BASE_CONFIG_VAR>` 에 앱이 기록한 기반 브랜치 이름을 둔다.
/// 브랜치를 지우면 git 이 `branch.<name>` 섹션을 함께 지운다.
pub const BASE_CONFIG_VAR: &str = "gitbaroBase";

/// 추정 단계에서 살펴볼 로컬 브랜치 수의 상한. 넘으면 기본 브랜치만 후보로 둔다.
const MAX_INFERENCE_CANDIDATES: usize = 30;

const CACHE_LIMIT: usize = 512;

/// (공용 git 디렉토리, 브랜치) → (입력 지문, 결과)
type BaseCache = HashMap<(PathBuf, String), (u64, Option<WorktreeBase>)>;

/// 추정 후보 비교 키: (앞선 커밋 수, 우선순위, 뒤처진 커밋 수, 이름). 작을수록 좋다.
type Score = (usize, u8, usize, String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BaseSource {
    /// 앱이 생성 시 기록한 값.
    Recorded,
    /// 브랜치 reflog 의 생성 기록.
    Reflog,
    /// 기록이 없어 가장 가까운 분기점으로 추정한 값.
    Inferred,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeBase {
    /// `dev`, `origin/main` 처럼 브랜치 목록에 보이는 이름.
    pub name: String,
    pub source: BaseSource,
    /// 기반 브랜치에 없는, 이 브랜치만의 커밋 수.
    pub ahead_of_base: u32,
    /// 이 브랜치에 없는, 기반 브랜치의 커밋 수.
    pub behind_base: u32,
}

pub fn base_config_key(branch: &str) -> String {
    format!("branch.{}.{}", branch, BASE_CONFIG_VAR)
}

/// origin/HEAD 가 가리키는 기본 브랜치의 로컬 이름.
pub fn default_branch_name(repo: &Repository) -> Option<String> {
    repo.find_reference("refs/remotes/origin/HEAD")
        .ok()
        .and_then(|r| r.symbolic_target().map(|s| s.to_string()))
        .and_then(|s| s.strip_prefix("refs/remotes/origin/").map(|n| n.to_string()))
}

/// 캐시를 거쳐 기반 브랜치를 판별한다. 참조·reflog·기록값이 그대로면 이전 결과를 쓴다.
pub fn resolve_worktree_base_cached(repo: &Repository, branch: &str) -> Option<WorktreeBase> {
    static CACHE: OnceLock<Mutex<BaseCache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let key = (common_dir(repo), branch.to_string());
    let fingerprint = fingerprint(repo, branch);

    if let Some((fp, cached)) = cache.lock().ok()?.get(&key) {
        if *fp == fingerprint {
            return cached.clone();
        }
    }

    let base = resolve_worktree_base(repo, branch);
    if let Ok(mut map) = cache.lock() {
        if map.len() >= CACHE_LIMIT {
            map.clear();
        }
        map.insert(key, (fingerprint, base.clone()));
    }
    base
}

/// 캐시 없이 기반 브랜치를 판별한다. 브랜치가 없으면 `None`.
pub fn resolve_worktree_base(repo: &Repository, branch: &str) -> Option<WorktreeBase> {
    let tip = repo.find_branch(branch, BranchType::Local).ok()?.get().target()?;

    let explicit = [
        (recorded_base(repo, branch), BaseSource::Recorded),
        (reflog_base(repo, branch), BaseSource::Reflog),
    ];
    for (name, source) in explicit {
        let Some(name) = name else { continue };
        let Some(resolved) = resolve_branch(repo, &name) else { continue };
        if is_same_branch(branch, &name, &resolved) {
            continue;
        }
        let Ok((ahead, behind)) = repo.graph_ahead_behind(tip, resolved.oid) else {
            continue;
        };
        return Some(WorktreeBase {
            name,
            source,
            ahead_of_base: to_u32(ahead),
            behind_base: to_u32(behind),
        });
    }

    infer_base(repo, branch, tip)
}

// ── 기록·reflog ──────────────────────────────────────────────────────────────

fn recorded_base(repo: &Repository, branch: &str) -> Option<String> {
    let value = repo.config().ok()?.get_string(&base_config_key(branch)).ok()?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// 가장 오래된 reflog 항목의 `branch: Created from X` 에서 X 를 꺼낸다.
fn reflog_base(repo: &Repository, branch: &str) -> Option<String> {
    let reflog = repo.reflog(&format!("refs/heads/{}", branch)).ok()?;
    let oldest = reflog.get(reflog.len().checked_sub(1)?)?;
    parse_created_from(oldest.message()?)
}

/// `branch: Created from X` → 브랜치 이름. X 가 `HEAD`(또는 `HEAD~1` 같은 상대 표기)면
/// 어느 브랜치였는지 알 수 없으므로 `None`.
pub fn parse_created_from(message: &str) -> Option<String> {
    let from = message.trim().strip_prefix("branch: Created from ")?.trim();
    if from.is_empty() || from == "HEAD" || from.starts_with("HEAD~") || from.starts_with("HEAD^") {
        return None;
    }
    let name = from
        .strip_prefix("refs/heads/")
        .or_else(|| from.strip_prefix("refs/remotes/"))
        .unwrap_or(from);
    Some(name.to_string())
}

// ── 추정 ────────────────────────────────────────────────────────────────────

struct Candidate {
    name: String,
    oid: Oid,
    /// 0: 기본 브랜치, 1: origin/기본 브랜치, 2: 그 밖의 로컬 브랜치.
    priority: u8,
}

fn infer_base(repo: &Repository, branch: &str, tip: Oid) -> Option<WorktreeBase> {
    let candidates = inference_candidates(repo, branch);

    let mut best: Option<(Score, String)> = None;
    for cand in candidates {
        // 공통 조상이 없는 브랜치(별도 이력)는 기반이 될 수 없다.
        if repo.merge_base(tip, cand.oid).is_err() {
            continue;
        }
        let Ok((ahead, behind)) = repo.graph_ahead_behind(tip, cand.oid) else {
            continue;
        };
        // 이 브랜치를 통째로 품고 더 나아간 일반 브랜치는 대개 여기서 갈라져 나간
        // 자식 브랜치다. 기본 브랜치는 병합됐을 수 있으므로 그대로 둔다.
        if cand.priority == 2 && ahead == 0 && behind > 0 {
            continue;
        }
        if cand.priority == 2 && is_child_of(repo, &cand.name, branch) {
            continue;
        }
        let score = (ahead, cand.priority, behind, cand.name.clone());
        if best.as_ref().is_none_or(|(s, _)| score < *s) {
            best = Some((score, cand.name));
        }
    }

    best.map(|((ahead, _, behind, _), name)| WorktreeBase {
        name,
        source: BaseSource::Inferred,
        ahead_of_base: to_u32(ahead),
        behind_base: to_u32(behind),
    })
}

fn inference_candidates(repo: &Repository, branch: &str) -> Vec<Candidate> {
    let default = default_branch_name(repo).or_else(|| {
        ["main", "master"]
            .into_iter()
            .find(|n| repo.find_branch(n, BranchType::Local).is_ok())
            .map(str::to_string)
    });

    let locals: Vec<(String, Oid)> = repo
        .branches(Some(BranchType::Local))
        .map(|iter| {
            iter.filter_map(Result::ok)
                .filter_map(|(b, _)| {
                    let name = b.name().ok().flatten()?.to_string();
                    let oid = b.get().target()?;
                    Some((name, oid))
                })
                .filter(|(name, _)| name != branch)
                .collect()
        })
        .unwrap_or_default();
    let too_many = locals.len() > MAX_INFERENCE_CANDIDATES;

    let mut out = Vec::new();
    for (name, oid) in locals {
        let is_default = default.as_deref() == Some(name.as_str());
        if too_many && !is_default {
            continue;
        }
        out.push(Candidate { name, oid, priority: if is_default { 0 } else { 2 } });
    }
    if let Some(default) = default {
        let remote = format!("origin/{}", default);
        if let Ok(b) = repo.find_branch(&remote, BranchType::Remote) {
            if let Some(oid) = b.get().target() {
                out.push(Candidate { name: remote, oid, priority: 1 });
            }
        }
    }
    out
}

/// `candidate` 가 `parent` 에서 만들어졌다고 기록돼 있는가.
fn is_child_of(repo: &Repository, candidate: &str, parent: &str) -> bool {
    recorded_base(repo, candidate).as_deref() == Some(parent)
        || reflog_base(repo, candidate).as_deref() == Some(parent)
}

// ── 공통 ────────────────────────────────────────────────────────────────────

struct ResolvedBranch {
    oid: Oid,
    is_remote: bool,
}

fn resolve_branch(repo: &Repository, name: &str) -> Option<ResolvedBranch> {
    if let Some(oid) = repo.find_branch(name, BranchType::Local).ok().and_then(|b| b.get().target()) {
        return Some(ResolvedBranch { oid, is_remote: false });
    }
    let oid = repo.find_branch(name, BranchType::Remote).ok()?.get().target()?;
    Some(ResolvedBranch { oid, is_remote: true })
}

/// 기반 후보가 이 브랜치 자신이거나 그 원격 사본(`origin/<branch>`)인가.
/// `git checkout -b x origin/x` 로 만든 브랜치의 reflog 는 자기 원격 사본을 가리킨다.
fn is_same_branch(branch: &str, base: &str, resolved: &ResolvedBranch) -> bool {
    base == branch
        || (resolved.is_remote && base.split_once('/').is_some_and(|(_, rest)| rest == branch))
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// 링크된 워크트리에서 연 저장소도 공용 git 디렉토리를 키로 쓴다.
fn common_dir(repo: &Repository) -> PathBuf {
    let git_dir = repo.path();
    std::fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|rel| git_dir.join(rel.trim()))
        .and_then(|p| p.canonicalize().ok())
        .unwrap_or_else(|| git_dir.to_path_buf())
}

/// 결과에 영향을 주는 모든 입력의 지문: 브랜치·원격 참조의 위치, origin/HEAD,
/// 기록값, 이 브랜치 reflog 파일의 수정 시각.
fn fingerprint(repo: &Repository, branch: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    if let Ok(refs) = repo.references() {
        let mut entries: Vec<(String, Option<Oid>, Option<String>)> = refs
            .filter_map(Result::ok)
            .filter_map(|r| {
                let name = r.name()?.to_string();
                if !(name.starts_with("refs/heads/") || name.starts_with("refs/remotes/")) {
                    return None;
                }
                Some((name, r.target(), r.symbolic_target().map(str::to_string)))
            })
            .collect();
        entries.sort();
        entries.hash(&mut hasher);
    }
    recorded_base(repo, branch).hash(&mut hasher);
    reflog_mtime(&common_dir(repo), branch).hash(&mut hasher);
    hasher.finish()
}

fn reflog_mtime(common_dir: &Path, branch: &str) -> Option<std::time::SystemTime> {
    std::fs::metadata(common_dir.join("logs/refs/heads").join(branch))
        .and_then(|m| m.modified())
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn commit(dir: &Path, msg: &str) {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
    }

    /// main 에 커밋 1개, dev 에 커밋 2개가 더 있는 저장소.
    fn init_repo(name: &str) -> PathBuf {
        let tmp = std::env::temp_dir()
            .join(format!("gitbaro-wtbase-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let main = tmp.join("main");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["config", "user.email", "t@t"]);
        git(&main, &["config", "user.name", "t"]);
        commit(&main, "init");
        git(&main, &["branch", "dev"]);
        git(&main, &["checkout", "-q", "dev"]);
        commit(&main, "dev 1");
        commit(&main, "dev 2");
        git(&main, &["checkout", "-q", "main"]);
        main
    }

    fn worktree_path(main: &Path, name: &str) -> String {
        main.parent().unwrap().join(name).to_str().unwrap().to_string()
    }

    #[test]
    fn parses_the_created_from_message() {
        assert_eq!(parse_created_from("branch: Created from dev"), Some("dev".into()));
        assert_eq!(parse_created_from("branch: Created from refs/heads/dev"), Some("dev".into()));
        assert_eq!(
            parse_created_from("branch: Created from refs/remotes/origin/main"),
            Some("origin/main".into())
        );
        assert_eq!(parse_created_from("branch: Created from origin/main"), Some("origin/main".into()));
        assert_eq!(parse_created_from("branch: Created from HEAD"), None);
        assert_eq!(parse_created_from("commit: something"), None);
    }

    #[test]
    fn a_worktree_created_from_a_branch_reports_that_branch_from_the_reflog() {
        let main = init_repo("reflog");
        let wt = worktree_path(&main, "wt-reflog");
        git(&main, &["worktree", "add", "-q", "-b", "feat/x", &wt, "dev"]);
        commit(Path::new(&wt), "feat 1");

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/x").unwrap();
        assert_eq!(base.name, "dev");
        assert_eq!(base.source, BaseSource::Reflog);
        assert_eq!((base.ahead_of_base, base.behind_base), (1, 0));
    }

    #[test]
    fn a_branch_created_from_head_falls_back_to_the_nearest_fork_point() {
        let main = init_repo("head");
        // dev 를 체크아웃한 채 `checkout -b` 로 만들면 reflog 에는 HEAD 만 남는다.
        git(&main, &["checkout", "-q", "dev"]);
        git(&main, &["checkout", "-q", "-b", "feat/y"]);
        git(&main, &["checkout", "-q", "main"]);
        let wt = worktree_path(&main, "wt-head");
        git(&main, &["worktree", "add", "-q", &wt, "feat/y"]);
        commit(Path::new(&wt), "feat 1");
        // main 이 앞서 나가도 분기점이 더 가까운 dev 를 골라야 한다.
        commit(&main, "main 2");

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/y").unwrap();
        assert_eq!(base.name, "dev");
        assert_eq!(base.source, BaseSource::Inferred);
        assert_eq!((base.ahead_of_base, base.behind_base), (1, 0));
    }

    #[test]
    fn the_recorded_base_wins_over_the_reflog() {
        let main = init_repo("recorded");
        let wt = worktree_path(&main, "wt-recorded");
        git(&main, &["worktree", "add", "-q", "-b", "feat/z", &wt, "dev"]);
        git(&main, &["config", &base_config_key("feat/z"), "main"]);

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/z").unwrap();
        assert_eq!(base.name, "main");
        assert_eq!(base.source, BaseSource::Recorded);
        assert_eq!((base.ahead_of_base, base.behind_base), (2, 0));
    }

    /// 기록된 기반 브랜치가 삭제됐으면 앞뒤 커밋 수를 셀 수 없으니 추정으로 넘어간다.
    #[test]
    fn a_deleted_base_branch_falls_back_to_inference() {
        let main = init_repo("deleted");
        git(&main, &["branch", "tmp", "dev"]);
        let wt = worktree_path(&main, "wt-deleted");
        git(&main, &["worktree", "add", "-q", "-b", "feat/w", &wt, "tmp"]);
        commit(Path::new(&wt), "feat 1");
        git(&main, &["branch", "-D", "tmp"]);

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/w").unwrap();
        assert_eq!(base.name, "dev");
        assert_eq!(base.source, BaseSource::Inferred);
    }

    #[test]
    fn a_child_branch_is_not_picked_as_the_base() {
        let main = init_repo("child");
        git(&main, &["checkout", "-q", "dev"]);
        git(&main, &["branch", "feat/p"]);
        git(&main, &["checkout", "-q", "feat/p"]);
        commit(&main, "p 1");
        git(&main, &["checkout", "-q", "-b", "feat/p-child"]);
        commit(&main, "child 1");
        git(&main, &["checkout", "-q", "main"]);

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/p").unwrap();
        assert_eq!(base.name, "dev");
    }

    #[test]
    fn the_cache_follows_branch_changes() {
        let main = init_repo("cache");
        let wt = worktree_path(&main, "wt-cache");
        git(&main, &["worktree", "add", "-q", "-b", "feat/c", &wt, "dev"]);

        let repo = Repository::open(&main).unwrap();
        let first = resolve_worktree_base_cached(&repo, "feat/c").unwrap();
        assert_eq!(first.ahead_of_base, 0);

        commit(Path::new(&wt), "feat 1");
        let repo = Repository::open(&main).unwrap();
        let second = resolve_worktree_base_cached(&repo, "feat/c").unwrap();
        assert_eq!(second.ahead_of_base, 1);
    }

    /// 앱이 기반 브랜치를 골라 만든 워크트리는 그 값을 기록하고, 판별도 기록값을 쓴다.
    #[tokio::test]
    async fn creating_a_worktree_from_the_app_records_its_base() {
        let main = init_repo("app");
        let wt = worktree_path(&main, "wt-app");
        crate::git::cli::GitCliEngine::new(&main)
            .add_worktree(&wt, None, Some("feat/app"), Some("dev"))
            .await
            .unwrap();

        let repo = Repository::open(&main).unwrap();
        assert_eq!(recorded_base(&repo, "feat/app").as_deref(), Some("dev"));
        let base = resolve_worktree_base(&repo, "feat/app").unwrap();
        assert_eq!(base.source, BaseSource::Recorded);
        assert_eq!(base.name, "dev");
    }
}
