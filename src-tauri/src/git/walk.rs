//! 필요한 만큼만 읽는 커밋 순회.
//!
//! libgit2 revwalk 은 정렬(`set_sorting`)이나 `hide` 를 하나라도 쓰면 「limited」 모드가 되어
//! 첫 결과를 내기 전에 닿는 이력 전체를 훑는다. `take(n)` 을 붙여도 비용은 줄지 않는다.
//! 숨길 커밋이 없을 때는 이 순회를 쓴다. 커밋 시각이 늦은 것부터 꺼내므로 `git log` 기본 순서와
//! 같고, `limit` 개를 꺼내면 더 읽지 않는다.

use std::collections::{BinaryHeap, HashSet};

use git2::{Oid, Repository};

/// `tips` 에서 닿는 커밋을 최신 순으로 많아야 `limit` 개. 커밋 시각이 같으면 OID 순이다.
pub fn newest_first(repo: &Repository, tips: &[Oid], limit: usize) -> Result<Vec<Oid>, git2::Error> {
    let mut queue = BinaryHeap::new();
    let mut seen = HashSet::new();
    for &tip in tips {
        if seen.insert(tip) {
            queue.push((repo.find_commit(tip)?.time().seconds(), tip));
        }
    }

    let mut out = Vec::new();
    while out.len() < limit {
        let Some((_, oid)) = queue.pop() else { break };
        out.push(oid);
        if out.len() == limit {
            break;
        }
        let commit = repo.find_commit(oid)?;
        for parent in commit.parent_ids() {
            if seen.insert(parent) {
                queue.push((repo.find_commit(parent)?.time().seconds(), parent));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    pub(crate) fn git(dir: &Path, args: &[&str]) -> String {
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

    /// 커밋 `count` 개가 한 줄로 이어진 저장소. 커밋 시각은 1초씩 늘어난다. 최신 순 OID 를 돌려준다.
    pub(crate) fn linear_repo(dir: &Path, count: usize) -> Vec<Oid> {
        let _ = std::fs::remove_dir_all(dir);
        std::fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q", "-b", "trunk"]);
        git(dir, &["config", "user.email", "t@t"]);
        git(dir, &["config", "user.name", "t"]);
        let mut oids = Vec::new();
        for i in 0..count {
            let date = format!("{} +0000", 1_700_000_000 + i);
            let out = Command::new("git")
                .args(["commit", "-q", "--allow-empty", "-m", &format!("c{i}")])
                .current_dir(dir)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_SYSTEM", "/dev/null")
                .env("GIT_AUTHOR_DATE", &date)
                .env("GIT_COMMITTER_DATE", &date)
                .output()
                .unwrap();
            assert!(out.status.success());
            oids.push(Oid::from_str(&git(dir, &["rev-parse", "HEAD"])).unwrap());
        }
        oids.reverse();
        oids
    }

    /// 커밋 객체 파일을 지운다. 이 커밋을 읽으려 하면 실패하므로, 순회가 어디까지 읽었는지 드러난다.
    pub(crate) fn delete_commit_object(dir: &Path, oid: Oid) {
        let hex = oid.to_string();
        let path = dir.join(".git/objects").join(&hex[..2]).join(&hex[2..]);
        std::fs::remove_file(&path).expect("loose 커밋 객체");
    }

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("gitbaro-walk-{}-{}", name, std::process::id()))
    }

    #[test]
    fn stops_reading_at_the_limit() {
        let dir = tmp("stops");
        let oids = linear_repo(&dir, 10);
        // 오래된 커밋이 깨져 있어도 앞의 3개만 읽으면 성공한다.
        delete_commit_object(&dir, oids[6]);
        let repo = Repository::open(&dir).unwrap();
        assert_eq!(newest_first(&repo, &[oids[0]], 3).unwrap(), oids[..3].to_vec());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn merges_are_listed_by_commit_time() {
        let dir = tmp("merge");
        let base = linear_repo(&dir, 2);
        git(&dir, &["checkout", "-q", "-b", "side"]);
        git(&dir, &["commit", "-q", "--allow-empty", "-m", "side"]);
        let side = Oid::from_str(&git(&dir, &["rev-parse", "HEAD"])).unwrap();
        git(&dir, &["checkout", "-q", "trunk"]);
        git(&dir, &["merge", "-q", "--no-ff", "-m", "merge", "side"]);
        let merge = Oid::from_str(&git(&dir, &["rev-parse", "HEAD"])).unwrap();
        let repo = Repository::open(&dir).unwrap();
        let got = newest_first(&repo, &[merge], 10).unwrap();
        assert_eq!(got.len(), 4);
        assert_eq!(got[0], merge);
        assert_eq!(&got[2..], &base[..], "오래된 main 커밋이 뒤에 온다");
        assert!(got.contains(&side));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
