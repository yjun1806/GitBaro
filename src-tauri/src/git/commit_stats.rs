//! 커밋 줄의 「변경」 칸: 커밋마다 첫 부모와 비교한 바뀐 파일 수와 줄 수.
//!
//! 숫자는 커밋 상세(`commands::history::get_commit_detail`)와 같게 센다: 첫 부모(처음 커밋이면 빈 트리)와
//! 트리를 비교하고, 이름 바꾸기를 찾은 뒤 `git2::DiffStats` 로 센다.
//!
//! - 병합 커밋은 세지 않는다(`merge: true`). 첫 부모 대비 diff 에 병합해 들여온 남의 변경이 섞인다.
//! - 파일이 `MAX_FILES_FOR_LINES` 보다 많으면 파일 수만 준다(줄 수는 `None`). 줄을 세려면 파일마다 내용을
//!   읽어야 해서, 대량 이동·생성 커밋 하나가 목록 전체를 붙잡지 않게 한다.
//!
//! 커밋은 바뀌지 않으므로 결과를 (저장소, 커밋)으로 기억한다. 워크트리마다 경로가 달라도 같은 저장소
//! (`worktree_base::common_dir`)면 같은 칸을 쓴다.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use git2::{Oid, Repository};
use serde::Serialize;

use crate::error::AppError;
use crate::git::diff::detect_renames;
use crate::git::worktree_base::common_dir;

/// 바뀐 파일이 이보다 많으면 줄 수를 세지 않는다.
pub const MAX_FILES_FOR_LINES: usize = 1_000;

/// 기억해 두는 커밋 수의 대략적인 상한. 두 세대로 나눠 오래 안 쓴 쪽을 통째로 버린다.
const CACHE_LIMIT: usize = 20_000;

/// 커밋 하나의 변경 크기. TS `CommitStats` 와 같은 모양이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitStats {
    /// 요청에 넘긴 값 그대로.
    pub oid: String,
    /// 병합 커밋이다. 이때 나머지 수는 모두 `None` 이다.
    pub merge: bool,
    /// 첫 부모 대비 바뀐 파일 수(이름 바꾸기는 하나). 병합 커밋이거나 읽지 못했으면 `None`.
    pub files_changed: Option<usize>,
    /// 더한 줄 수. 병합 커밋, 파일이 `MAX_FILES_FOR_LINES` 보다 많은 커밋, 읽지 못한 커밋이면 `None`.
    pub additions: Option<usize>,
    /// 지운 줄 수. `additions` 와 같은 경우에 `None`.
    pub deletions: Option<usize>,
    /// 이 커밋을 읽지 못한 이유(40자 OID 가 아님, 저장소에 없음 등). 있으면 나머지는 비어 있다.
    pub error: Option<String>,
}

impl CommitStats {
    fn failed(oid: &str, error: String) -> Self {
        CommitStats {
            oid: oid.to_string(),
            merge: false,
            files_changed: None,
            additions: None,
            deletions: None,
            error: Some(error),
        }
    }
}

/// 두 세대로 나눈 캐시. 새로 넣거나 옛 세대에서 찾은 값은 새 세대에 둔다. 새 세대가 가득 차면 옛 세대를
/// 버리고 새 세대가 옛 세대가 된다. 최근에 쓴 값은 늘 남고, 넣기·찾기는 O(1)이다.
struct Generations<K, V> {
    young: HashMap<K, V>,
    old: HashMap<K, V>,
    limit: usize,
}

impl<K: std::hash::Hash + Eq + Clone, V: Clone> Generations<K, V> {
    fn new(limit: usize) -> Self {
        Generations { young: HashMap::new(), old: HashMap::new(), limit: limit.max(2) / 2 }
    }

    fn get(&mut self, key: &K) -> Option<V> {
        if let Some(v) = self.young.get(key) {
            return Some(v.clone());
        }
        let v = self.old.remove(key)?;
        self.insert(key.clone(), v.clone());
        Some(v)
    }

    fn insert(&mut self, key: K, value: V) {
        if self.young.len() >= self.limit {
            self.old = std::mem::take(&mut self.young);
        }
        self.young.insert(key, value);
    }
}

/// (저장소 공용 git 폴더, 커밋) → 결과. `oid`·`error` 는 요청마다 채우므로 수만 둔다.
type StatsCache = Generations<(PathBuf, Oid), Counted>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Counted {
    merge: bool,
    files_changed: Option<usize>,
    additions: Option<usize>,
    deletions: Option<usize>,
}

fn cache() -> &'static Mutex<StatsCache> {
    static CACHE: OnceLock<Mutex<StatsCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Generations::new(CACHE_LIMIT)))
}

/// 커밋마다의 변경 크기. 결과는 `oids` 순서이고, 한 커밋을 읽지 못해도 그 항목의 `error` 만 채운다.
pub fn commit_stats(repo: &Repository, oids: &[String]) -> Vec<CommitStats> {
    let repo_key = common_dir(repo);
    oids.iter()
        .map(|raw| {
            let oid = match full_oid(raw) {
                Some(oid) => oid,
                None => return CommitStats::failed(raw, format!("not a full commit id: {raw:?}")),
            };
            let key = (repo_key.clone(), oid);
            let cached = cache().lock().ok().and_then(|mut c| c.get(&key));
            let counted = match cached {
                Some(counted) => counted,
                None => match count(repo, oid) {
                    Ok(counted) => {
                        if let Ok(mut c) = cache().lock() {
                            c.insert(key, counted);
                        }
                        counted
                    }
                    Err(e) => return CommitStats::failed(raw, e.to_string()),
                },
            };
            CommitStats {
                oid: raw.clone(),
                merge: counted.merge,
                files_changed: counted.files_changed,
                additions: counted.additions,
                deletions: counted.deletions,
                error: None,
            }
        })
        .collect()
}

/// 40자 hex 만 받는다. 브랜치 이름·짧은 SHA 는 뜻이 바뀔 수 있어 캐시 키로 쓸 수 없다.
fn full_oid(raw: &str) -> Option<Oid> {
    (raw.len() == 40 && raw.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| Oid::from_str(raw).ok())
        .flatten()
}

fn count(repo: &Repository, oid: Oid) -> Result<Counted, AppError> {
    let commit = repo.find_commit(oid)?;
    if commit.parent_count() > 1 {
        return Ok(Counted { merge: true, files_changed: None, additions: None, deletions: None });
    }
    let parent_tree = commit.parents().next().map(|p| p.tree()).transpose()?;
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit.tree()?), None)?;
    let raw_files = diff.deltas().len();
    if raw_files > MAX_FILES_FOR_LINES {
        return Ok(Counted { merge: false, files_changed: Some(raw_files), additions: None, deletions: None });
    }
    detect_renames(&mut diff)?;
    let stats = diff.stats()?;
    Ok(Counted {
        merge: false,
        files_changed: Some(stats.files_changed()),
        additions: Some(stats.insertions()),
        deletions: Some(stats.deletions()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
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
                .join(format!("gitbaro-commit-stats-{name}-{}-{nanos}", std::process::id()));
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

    fn commit_all(dir: &Path, msg: &str) -> String {
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
        git(dir, &["rev-parse", "HEAD"])
    }

    fn init(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]);
    }

    fn stats(dir: &Path, oids: &[&str]) -> Vec<CommitStats> {
        let repo = Repository::open(dir).unwrap();
        commit_stats(&repo, &oids.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn counts_files_and_lines_against_the_first_parent() {
        let tmp = TempDir::new("lines");
        init(&tmp.0);
        write(&tmp.0, "a.txt", "1\n2\n3\n");
        let first = commit_all(&tmp.0, "first");
        write(&tmp.0, "a.txt", "1\nTWO\n3\n4\n");
        write(&tmp.0, "b.txt", "b\n");
        let second = commit_all(&tmp.0, "second");

        let out = stats(&tmp.0, &[&second, &first]);
        assert_eq!(out[0].oid, second);
        assert_eq!((out[0].files_changed, out[0].additions, out[0].deletions), (Some(2), Some(3), Some(1)));
        // 처음 커밋은 빈 트리와 비교한다.
        assert_eq!((out[1].files_changed, out[1].additions, out[1].deletions), (Some(1), Some(3), Some(0)));
        assert!(out.iter().all(|s| !s.merge && s.error.is_none()));
    }

    #[test]
    fn a_rename_counts_as_one_file() {
        let tmp = TempDir::new("rename");
        init(&tmp.0);
        write(&tmp.0, "old.txt", &"line\n".repeat(20));
        commit_all(&tmp.0, "add");
        git(&tmp.0, &["mv", "old.txt", "new.txt"]);
        let mv = commit_all(&tmp.0, "move");

        let out = stats(&tmp.0, &[&mv]);
        assert_eq!((out[0].files_changed, out[0].additions, out[0].deletions), (Some(1), Some(0), Some(0)));
    }

    #[test]
    fn a_merge_commit_is_only_marked() {
        let tmp = TempDir::new("merge");
        init(&tmp.0);
        write(&tmp.0, "a.txt", "a\n");
        commit_all(&tmp.0, "base");
        git(&tmp.0, &["checkout", "-q", "-b", "side"]);
        write(&tmp.0, "side.txt", "s\n");
        commit_all(&tmp.0, "side");
        git(&tmp.0, &["checkout", "-q", "main"]);
        write(&tmp.0, "main.txt", "m\n");
        commit_all(&tmp.0, "main");
        git(&tmp.0, &["merge", "-q", "--no-edit", "side"]);
        let merge = git(&tmp.0, &["rev-parse", "HEAD"]);

        let out = stats(&tmp.0, &[&merge]);
        assert!(out[0].merge);
        assert_eq!((out[0].files_changed, out[0].additions, out[0].deletions), (None, None, None));
        assert!(out[0].error.is_none());
    }

    #[test]
    fn more_than_the_file_limit_gives_the_file_count_only() {
        let tmp = TempDir::new("many");
        init(&tmp.0);
        for i in 0..=MAX_FILES_FOR_LINES {
            write(&tmp.0, &format!("f/{i}.txt"), "x\n");
        }
        let big = commit_all(&tmp.0, "many files");

        let out = stats(&tmp.0, &[&big]);
        assert_eq!(out[0].files_changed, Some(MAX_FILES_FOR_LINES + 1));
        assert_eq!((out[0].additions, out[0].deletions), (None, None));
    }

    #[test]
    fn a_bad_or_missing_oid_fills_only_its_error() {
        let tmp = TempDir::new("bad");
        init(&tmp.0);
        write(&tmp.0, "a.txt", "a\n");
        let ok = commit_all(&tmp.0, "ok");
        let missing = "0123456789012345678901234567890123456789";

        let out = stats(&tmp.0, &["main", missing, &ok]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].oid, "main");
        assert!(out[0].error.is_some(), "브랜치 이름은 받지 않는다");
        assert!(out[1].error.is_some());
        assert_eq!(out[2].files_changed, Some(1));
    }

    #[test]
    fn a_linked_worktree_shares_the_cached_answer() {
        let tmp = TempDir::new("worktree");
        let main = tmp.0.join("main");
        std::fs::create_dir_all(&main).unwrap();
        init(&main);
        write(&main, "a.txt", "a\n");
        let c = commit_all(&main, "c");
        let wt = tmp.0.join("wt");
        git(&main, &["worktree", "add", "-q", "-b", "wt", wt.to_str().unwrap()]);

        let a = Repository::open(&main).unwrap();
        let b = Repository::open(&wt).unwrap();
        assert_eq!(common_dir(&a), common_dir(&b), "같은 저장소면 같은 캐시 키");
        assert_eq!(stats(&wt, &[&c])[0].files_changed, Some(1));
    }

    #[test]
    fn the_cache_keeps_recent_entries_across_a_generation_swap() {
        let mut g: Generations<u32, u32> = Generations::new(4);
        g.insert(1, 1);
        g.insert(2, 2);
        // 새 세대가 가득 차 1·2 는 옛 세대로 간다.
        g.insert(3, 3);
        assert_eq!(g.get(&1), Some(1), "옛 세대에서 찾으면 새 세대로 올린다");
        g.insert(4, 4);
        // 다시 넘어가며 2 가 있던 옛 세대는 버려진다.
        assert_eq!(g.get(&2), None);
        assert_eq!(g.get(&1), Some(1));
        assert_eq!(g.get(&4), Some(4));
    }

    #[test]
    fn serialized_shape_matches_the_typescript_type() {
        let s = CommitStats {
            oid: "a".into(),
            merge: false,
            files_changed: Some(2),
            additions: None,
            deletions: None,
            error: None,
        };
        assert_eq!(
            serde_json::to_value(&s).unwrap(),
            serde_json::json!({
                "oid": "a", "merge": false, "filesChanged": 2, "additions": null, "deletions": null, "error": null
            })
        );
    }
}
