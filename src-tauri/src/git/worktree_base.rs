//! 워크트리 브랜치가 어느 브랜치에서 갈라져 나왔는지(기반 브랜치) 판별한다.
//!
//! 판별 순서:
//! 1. `recorded` — 앱이 워크트리를 만들 때 `branch.<name>.gitbaroBase` 에 적어 둔 값.
//! 2. `reflog` — 브랜치 reflog 의 가장 오래된 항목 `branch: Created from X`.
//!    X 가 `HEAD` 이거나 커밋 해시·태그처럼 브랜치가 아니면 건너뛴다.
//! 3. `reflog` (HEAD reflog) — 2 에서 X 가 `HEAD` 라 건너뛴 경우, 브랜치가 만들어진 순간
//!    어느 워크트리의 HEAD 가 어느 브랜치를 가리키고 있었는지 각 워크트리의 HEAD reflog로
//!    되짚는다. 그 브랜치 자신의 reflog로 그 시점의 tip 이 생성 커밋과 같음을 다시 확인해야
//!    받아들인다. 워크트리마다 답이 다르면(모호함) 포기한다. 이렇게 확정된 값은
//!    `branch.<name>.gitbaroBase` 에 기록해 다음부터는 1번으로 바로 읽힌다.
//! 4. `inferred` — 후보 브랜치 중 분기점이 가장 가까운 것을 고른 추정값.
//!
//! 1·2·3 에서 얻은 브랜치가 지금은 없으면(삭제됨) 앞뒤 커밋 수를 셀 수 없으므로
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
    /// 브랜치 reflog 는 `Created from HEAD` 뿐이지만, 워크트리들의 HEAD reflog 를
    /// 되짚어 확실하게 판별한 값. 추정이 아니므로 UI 에 "추정" 표시를 붙이지 않는다.
    HeadReflog,
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

/// 이 저장소의 기본 브랜치. origin/HEAD 가 가리키는 브랜치, 없으면 로컬 `main`·`master` 중 있는 것.
///
/// 워크트리 기반 추정, 새 커밋 세기, 워크스페이스 타임라인이 모두 이 규칙을 쓴다.
pub fn default_branch_with_fallback(repo: &Repository) -> Option<String> {
    default_branch_name(repo).or_else(|| {
        ["main", "master"]
            .into_iter()
            .find(|n| repo.find_branch(n, BranchType::Local).is_ok())
            .map(str::to_string)
    })
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
        if let Some(base) = base_from_name(repo, branch, tip, name, source) {
            return Some(base);
        }
    }

    if let Some(name) = head_reflog_base(repo, branch) {
        if let Some(base) = base_from_name(repo, branch, tip, name, BaseSource::HeadReflog) {
            return Some(base);
        }
    }

    infer_base(repo, branch, tip)
}

/// `name` 을 실제 브랜치로 풀어 앞뒤 커밋 수를 센다. 브랜치가 없거나, 자기 자신(또는
/// 자기 원격 사본)을 가리키면 `None` — 호출자는 다음 후보로 넘어간다.
fn base_from_name(
    repo: &Repository,
    branch: &str,
    tip: Oid,
    name: String,
    source: BaseSource,
) -> Option<WorktreeBase> {
    let resolved = resolve_branch(repo, &name)?;
    if is_same_branch(branch, &name, &resolved) {
        return None;
    }
    let (ahead, behind) = repo.graph_ahead_behind(tip, resolved.oid).ok()?;
    Some(WorktreeBase { name, source, ahead_of_base: to_u32(ahead), behind_base: to_u32(behind) })
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
    if is_head_like(from) {
        return None;
    }
    let name = from
        .strip_prefix("refs/heads/")
        .or_else(|| from.strip_prefix("refs/remotes/"))
        .unwrap_or(from);
    Some(name.to_string())
}

/// X 가 `HEAD` 이거나 `HEAD~1`/`HEAD^` 같은 상대 표기, 또는 비어 있어서 그 자체로는
/// 어느 브랜치였는지 알 수 없는 표기인가.
fn is_head_like(from: &str) -> bool {
    from.is_empty() || from == "HEAD" || from.starts_with("HEAD~") || from.starts_with("HEAD^")
}

// ── HEAD reflog ──────────────────────────────────────────────────────────────
// 브랜치 reflog 에 `Created from HEAD` 만 남아 어느 브랜치인지 알 수 없을 때, 그 순간
// 워크트리들의 HEAD 가 어느 브랜치를 가리키고 있었는지 되짚는다.

/// `Created from HEAD` 로 만들어진 브랜치의 기반을, 만들어진 순간 워크트리들의 HEAD 가
/// 가리키고 있던 브랜치로 되짚어 확정한다. 조금이라도 불확실하면(체크아웃 기록이 없거나,
/// 가리키던 게 브랜치가 아니라 커밋(detached)이거나, 워크트리마다 답이 다르면) `None` —
/// 호출자는 추정 단계로 넘어간다.
fn head_reflog_base(repo: &Repository, branch: &str) -> Option<String> {
    let (created_at, created_oid) = created_from_head(repo, branch)?;
    let common = common_dir(repo);

    let mut found: Option<String> = None;
    for path in head_reflog_paths(&common) {
        let Some(entries) = read_reflog_file(&path) else { continue };
        // reflog 타임스탬프는 초 단위라 같은 초에 여러 항목이 몰릴 수 있다. "시각이 가장
        // 가까운 항목"이 아니라 "생성 커밋과 같은 항목 중 가장 나중 것"을 찾아야, 그
        // 뒤(같은 초 안)에 다른 워크트리로 옮겨간 항목을 잘못 고르지 않는다.
        let Some(match_idx) = entries
            .iter()
            .enumerate()
            .rev()
            .find(|(_, e)| e.timestamp <= created_at && e.new_oid == created_oid)
            .map(|(i, _)| i)
        else {
            // 이 워크트리는 생성 시점에 다른 상태였다(무관한 워크트리).
            continue;
        };
        // `commit:`/`pull:` 같은 항목은 브랜치를 바꾸지 않으므로 건너뛰고, 그 앞에서
        // 가장 가까운 명시적 체크아웃(`checkout: moving from A to B`)을 찾는다.
        let Some((from, to)) =
            entries[..=match_idx].iter().rev().find_map(|e| checkout_move(&e.message))
        else {
            continue;
        };
        // to 가 이 브랜치 자신이면(만드는 명령이 곧바로 체크아웃한 경우) from 이 바로 기반이다.
        let candidate = if to == branch { from } else { to };
        if candidate == branch {
            continue;
        }
        let Some(resolved) = resolve_branch(repo, candidate) else { continue };
        if is_same_branch(branch, candidate, &resolved) {
            continue;
        }
        // detached HEAD 로 옮겨간 기록이면 to(또는 from)가 브랜치가 아니라 커밋 해시라
        // 위의 resolve_branch 에서 이미 걸러진다.
        if !branch_tip_matches(repo, candidate, created_at, created_oid) {
            continue;
        }
        match &found {
            None => found = Some(candidate.to_string()),
            Some(existing) if existing == candidate => {}
            // 워크트리마다 다른 답 — 확신할 수 없다.
            Some(_) => return None,
        }
    }
    found
}

/// 브랜치 reflog 의 가장 오래된 항목이 `branch: Created from HEAD`(또는 상대 표기)면
/// 그 시각과 커밋을 반환한다.
fn created_from_head(repo: &Repository, branch: &str) -> Option<(i64, Oid)> {
    let reflog = repo.reflog(&format!("refs/heads/{}", branch)).ok()?;
    let oldest = reflog.get(reflog.len().checked_sub(1)?)?;
    let from = oldest.message()?.trim().strip_prefix("branch: Created from ")?.trim();
    if !is_head_like(from) {
        return None;
    }
    let timestamp = oldest.committer().when().seconds();
    let oid = oldest.id_new();
    Some((timestamp, oid))
}

/// `candidate` 브랜치가 `at` 시각(또는 그 직전)에 `created_oid` 였는지 그 브랜치 자신의
/// reflog 로 다시 확인한다. 그 시각까지 거슬러 갈 reflog 가 없으면 확인할 수 없으므로 false.
fn branch_tip_matches(repo: &Repository, candidate: &str, at: i64, created_oid: Oid) -> bool {
    let Ok(reflog) = repo.reflog(&format!("refs/heads/{}", candidate)) else { return false };
    for i in 0..reflog.len() {
        let Some(entry) = reflog.get(i) else { continue };
        if entry.committer().when().seconds() > at {
            continue;
        }
        let found = entry.id_new();
        return found == created_oid || repo.graph_descendant_of(found, created_oid).unwrap_or(false);
    }
    false
}

struct ReflogLine {
    new_oid: Oid,
    timestamp: i64,
    message: String,
}

/// 메인 워크트리의 `logs/HEAD` 와 링크된 워크트리마다의 `worktrees/<id>/logs/HEAD`.
/// 이름순으로 정렬해, 캐시 지문(`fingerprint`)이 매번 같은 순서로 계산되게 한다.
fn head_reflog_paths(common_dir: &Path) -> Vec<PathBuf> {
    let mut paths = vec![common_dir.join("logs").join("HEAD")];
    if let Ok(entries) = std::fs::read_dir(common_dir.join("worktrees")) {
        paths.extend(entries.filter_map(Result::ok).map(|e| e.path().join("logs").join("HEAD")));
    }
    paths.sort();
    paths
}

/// reflog 파일을 한 줄씩 읽는다. git 이 쓰는 형식:
/// `<old-oid> <new-oid> <name> <email> <timestamp> <tz>` 뒤에 탭과 메시지(없을 수도 있다).
fn read_reflog_file(path: &Path) -> Option<Vec<ReflogLine>> {
    let content = std::fs::read_to_string(path).ok()?;
    Some(
        content
            .lines()
            .filter_map(|line| {
                let (header, message) = line.split_once('\t').unwrap_or((line, ""));
                let mut parts = header.split_whitespace();
                parts.next()?; // old oid — 쓰지 않는다.
                let new_oid = Oid::from_str(parts.next()?).ok()?;
                let rest: Vec<&str> = parts.collect();
                let timestamp = rest.get(rest.len().checked_sub(2)?)?.parse().ok()?;
                Some(ReflogLine { new_oid, timestamp, message: message.to_string() })
            })
            .collect(),
    )
}

/// `checkout: moving from A to B` → `(A, B)`. `git switch` 도 같은 문구를 남긴다.
fn checkout_move(message: &str) -> Option<(&str, &str)> {
    let rest = message.trim().strip_prefix("checkout: moving from ")?;
    let (from, to) = rest.split_once(" to ")?;
    let (from, to) = (from.trim(), to.trim());
    (!from.is_empty() && !to.is_empty()).then_some((from, to))
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
    let default = default_branch_with_fallback(repo);

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
pub(crate) fn common_dir(repo: &Repository) -> PathBuf {
    let git_dir = repo.path();
    std::fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|rel| git_dir.join(rel.trim()))
        .and_then(|p| p.canonicalize().ok())
        .unwrap_or_else(|| git_dir.to_path_buf())
}

/// 결과에 영향을 주는 모든 입력의 지문: 브랜치·원격 참조의 위치, origin/HEAD,
/// 기록값, 이 브랜치 reflog 파일의 수정 시각, 워크트리들의 HEAD reflog 수정 시각
/// (`HeadReflog` 판별이 되짚어 읽는 파일들).
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
    let common = common_dir(repo);
    recorded_base(repo, branch).hash(&mut hasher);
    reflog_mtime(&common, branch).hash(&mut hasher);
    for path in head_reflog_paths(&common) {
        path.hash(&mut hasher);
        std::fs::metadata(&path).and_then(|m| m.modified()).ok().hash(&mut hasher);
    }
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

    /// `checkout -b`(또는 `switch -c`)로 만들면 브랜치 reflog 에는 `Created from HEAD` 만
    /// 남지만, 만들어진 워크트리 자신의 HEAD reflog 에 그 순간 체크아웃 기록
    /// (`checkout: moving from dev to feat/y`)이 그대로 남아 있어 dev 로 확정할 수 있다.
    #[test]
    fn a_branch_created_from_head_resolves_via_the_head_reflog() {
        let main = init_repo("head");
        git(&main, &["checkout", "-q", "dev"]);
        git(&main, &["checkout", "-q", "-b", "feat/y"]);
        git(&main, &["checkout", "-q", "main"]);
        let wt = worktree_path(&main, "wt-head");
        git(&main, &["worktree", "add", "-q", &wt, "feat/y"]);
        commit(Path::new(&wt), "feat 1");
        // main 이 뒤에 더 나가도(추정이었다면 헷갈릴 수 있는) 결과는 바뀌지 않는다 — 이제는
        // 추정이 아니라 reflog 로 확정하기 때문이다.
        commit(&main, "main 2");

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/y").unwrap();
        assert_eq!(base.name, "dev");
        assert_eq!(base.source, BaseSource::HeadReflog);
        assert_eq!((base.ahead_of_base, base.behind_base), (1, 0));
    }

    /// `git worktree add -b <new> <path>` 를 기반 브랜치 인자 없이(HEAD 기본값으로) 실행하면
    /// 새 워크트리가 아니라 명령을 실행한 워크트리(main)의 HEAD 가 그 순간 가리키던 브랜치가
    /// 기반이다. main 의 HEAD reflog 는 이 명령으로 전혀 바뀌지 않으므로, 그 이전 마지막
    /// 체크아웃 기록을 되짚어야 한다.
    #[test]
    fn worktree_add_b_without_a_ref_resolves_the_running_worktrees_branch() {
        let main = init_repo("add-b-head");
        let wt = worktree_path(&main, "wt-add-b-head");
        git(&main, &["worktree", "add", "-q", "-b", "feat/from-main", &wt]);

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/from-main").unwrap();
        assert_eq!(base.name, "main");
        assert_eq!(base.source, BaseSource::HeadReflog);
        assert_eq!((base.ahead_of_base, base.behind_base), (0, 0));
    }

    /// detached HEAD 에서 만든 브랜치는 마지막 체크아웃이 브랜치가 아니라 커밋(해시)을
    /// 가리키므로 확정할 수 없어 추정으로 넘어간다.
    #[test]
    fn a_branch_created_from_a_detached_head_falls_back_to_inference() {
        let main = init_repo("detached");
        let head_oid =
            String::from_utf8(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&main).output().unwrap().stdout)
                .unwrap()
                .trim()
                .to_string();
        // 브랜치 이름이 아니라 커밋 해시로 체크아웃해야 reflog 메시지에도 해시가 남는다
        // (`checkout --detach main`처럼 브랜치 이름으로 detach하면 메시지엔 그 이름이 남아
        // detach 여부를 텍스트만으로 구별할 수 없다).
        git(&main, &["checkout", "-q", &head_oid]);
        let wt = worktree_path(&main, "wt-detached");
        git(&main, &["worktree", "add", "-q", "-b", "feat/detached", &wt]);

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/detached").unwrap();
        assert_eq!(base.name, "main");
        assert_eq!(base.source, BaseSource::Inferred);
    }

    /// 두 워크트리가 생성 시점에 같은 커밋 위에 있었지만 서로 다른 브랜치에 있었다면
    /// 어느 쪽이 맞는지 확신할 수 없어 추정으로 넘어간다.
    #[test]
    fn ambiguous_head_reflogs_across_worktrees_fall_back_to_inference() {
        let main = init_repo("ambiguous");
        git(&main, &["branch", "twin", "main"]); // twin 도 main 과 같은 커밋.
        git(&main, &["branch", "twin2", "main"]); // twin2 도 마찬가지 — wt2 에서 오갈 상대.
        let wt2 = worktree_path(&main, "wt-ambiguous-2");
        git(&main, &["worktree", "add", "-q", &wt2, "twin"]);
        // wt2 에 진짜 체크아웃 기록을 남긴다 — twin 과 twin2 는 같은 커밋이라 오간 뒤에도
        // 여전히 그 커밋 위다(main 은 main 워크트리에 이미 체크아웃돼 있어 쓸 수 없다).
        git(Path::new(&wt2), &["checkout", "-q", "twin2"]);
        git(Path::new(&wt2), &["checkout", "-q", "twin"]);

        let wt3 = worktree_path(&main, "wt-ambiguous-3");
        git(&main, &["worktree", "add", "-q", "-b", "feat/ambiguous", &wt3]);

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/ambiguous").unwrap();
        // main 워크트리는 "main", wt2 는 "twin" 을 가리킨다 — 확신할 수 없으니 추정으로
        // 넘어가고, 추정은 기본 브랜치(main)를 고른다.
        assert_eq!(base.name, "main");
        assert_eq!(base.source, BaseSource::Inferred);
    }

    /// 기록된 값이 있으면 HEAD reflog 로 확정할 수 있는 상황이어도 기록값이 이긴다.
    #[test]
    fn the_recorded_base_wins_over_the_head_reflog() {
        let main = init_repo("recorded-over-head");
        git(&main, &["checkout", "-q", "dev"]);
        git(&main, &["checkout", "-q", "-b", "feat/rec"]);
        git(&main, &["checkout", "-q", "main"]);
        let wt = worktree_path(&main, "wt-recorded-over-head");
        git(&main, &["worktree", "add", "-q", &wt, "feat/rec"]);
        git(&main, &["config", &base_config_key("feat/rec"), "main"]);

        let repo = Repository::open(&main).unwrap();
        let base = resolve_worktree_base(&repo, "feat/rec").unwrap();
        assert_eq!(base.name, "main");
        assert_eq!(base.source, BaseSource::Recorded);
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

    /// `HeadReflog` 로 판별된 값을 `persist_head_reflog_base` 로 기록하면, 다음부터는
    /// 기록값(`Recorded`)으로 곧장 읽힌다.
    #[tokio::test]
    async fn the_persisted_head_reflog_base_is_used_next_time() {
        let main = init_repo("persist");
        git(&main, &["checkout", "-q", "dev"]);
        git(&main, &["checkout", "-q", "-b", "feat/persist"]);
        git(&main, &["checkout", "-q", "main"]);
        let wt = worktree_path(&main, "wt-persist");
        git(&main, &["worktree", "add", "-q", &wt, "feat/persist"]);

        let repo = Repository::open(&main).unwrap();
        let before = resolve_worktree_base(&repo, "feat/persist").unwrap();
        assert_eq!(before.source, BaseSource::HeadReflog);
        assert_eq!(before.name, "dev");
        assert!(recorded_base(&repo, "feat/persist").is_none());

        crate::git::cli::GitCliEngine::new(&main)
            .persist_head_reflog_base("feat/persist", &before.name)
            .await;

        let repo = Repository::open(&main).unwrap();
        assert_eq!(recorded_base(&repo, "feat/persist").as_deref(), Some("dev"));
        let after = resolve_worktree_base(&repo, "feat/persist").unwrap();
        assert_eq!(after.source, BaseSource::Recorded);
        assert_eq!(after.name, "dev");
    }

    /// 이미 기록된 값이 있으면 `persist_head_reflog_base` 는 절대 덮어쓰지 않는다.
    #[tokio::test]
    async fn persist_head_reflog_base_never_overwrites_an_existing_value() {
        let main = init_repo("persist-no-overwrite");
        git(&main, &["config", &base_config_key("feat/x"), "main"]);

        crate::git::cli::GitCliEngine::new(&main)
            .persist_head_reflog_base("feat/x", "dev")
            .await;

        let repo = Repository::open(&main).unwrap();
        assert_eq!(recorded_base(&repo, "feat/x").as_deref(), Some("main"));
    }
}
