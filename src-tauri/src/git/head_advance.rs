//! 워크트리의 HEAD 가 옮겨 간 방식 판별. 새 커밋 알림은 HEAD 가 앞으로만(새 커밋이 얹혀)
//! 움직였을 때 보낸다. 체크아웃·reset·rebase 로 관계없는 커밋에 간 것은 알리지 않는다.

use git2::{Oid, Repository, Sort};
use serde::Serialize;

/// 알림에 싣는 커밋 제목의 최대 개수(최근 것부터).
pub const HEAD_ADVANCE_SUBJECT_LIMIT: usize = 5;

/// `from` → `to` 로 옮긴 HEAD 가 앞으로만 나아갔는지.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadAdvance {
    /// `to` 가 `from` 의 자손인가(`from` 에서 이어 쌓은 커밋인가). 같은 커밋이면 false.
    pub is_descendant: bool,
    /// `to` 에서 첫 부모만 따라가며 `from` 에서 닿지 않는 커밋 수. 자손이 아니면 0.
    /// `git merge main`·`git pull` 로 끌어온 다른 사람의 커밋은 세지 않는다(병합 커밋 하나로 센다).
    pub count: u32,
    /// 새 커밋의 제목, 최근 것부터 많아야 [`HEAD_ADVANCE_SUBJECT_LIMIT`]개.
    pub subjects: Vec<String>,
}

impl HeadAdvance {
    fn none() -> Self {
        HeadAdvance { is_descendant: false, count: 0, subjects: Vec::new() }
    }
}

/// `to` 가 `from` 의 자손이면 그 사이 커밋 수와 제목을 준다. 어느 한쪽 커밋을 찾을 수 없으면
/// (gc 로 지워졌거나 잘못된 값) 앞으로 나아가지 않은 것으로 본다.
pub fn head_advance(repo: &Repository, from: Oid, to: Oid) -> Result<HeadAdvance, git2::Error> {
    if from == to || repo.find_commit(from).is_err() || repo.find_commit(to).is_err() {
        return Ok(HeadAdvance::none());
    }
    if !repo.graph_descendant_of(to, from)? {
        return Ok(HeadAdvance::none());
    }
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL)?;
    walk.simplify_first_parent()?;
    walk.push(to)?;
    walk.hide(from)?;
    let mut count = 0u32;
    let mut subjects = Vec::new();
    for oid in walk {
        let oid = oid?;
        count += 1;
        if subjects.len() < HEAD_ADVANCE_SUBJECT_LIMIT {
            let commit = repo.find_commit(oid)?;
            subjects.push(commit.summary().unwrap_or_default().to_string());
        }
    }
    Ok(HeadAdvance { is_descendant: true, count, subjects })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
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

    fn commit(dir: &Path, msg: &str) -> Oid {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
        Oid::from_str(&git(dir, &["rev-parse", "HEAD"])).unwrap()
    }

    fn repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gitbaro-head-advance-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "t@t"]);
        git(&dir, &["config", "user.name", "t"]);
        dir
    }

    fn advance(dir: &Path, from: Oid, to: Oid) -> HeadAdvance {
        head_advance(&Repository::open(dir).unwrap(), from, to).unwrap()
    }

    #[test]
    fn new_commits_on_top_count_as_an_advance_newest_subject_first() {
        let dir = repo("forward");
        let base = commit(&dir, "base");
        commit(&dir, "first");
        let tip = commit(&dir, "second");
        assert_eq!(
            advance(&dir, base, tip),
            HeadAdvance { is_descendant: true, count: 2, subjects: vec!["second".into(), "first".into()] }
        );
    }

    #[test]
    fn commits_merged_in_from_another_branch_are_not_counted() {
        // 에이전트가 `git merge main` 으로 동료 커밋 여럿을 끌어오면 새로 쌓은 것은 병합 커밋 하나다.
        let dir = repo("merge");
        commit(&dir, "base");
        git(&dir, &["checkout", "-q", "-b", "feature"]);
        let before = commit(&dir, "my work");
        git(&dir, &["checkout", "-q", "main"]);
        for i in 0..6 {
            commit(&dir, &format!("teammate {}", i));
        }
        git(&dir, &["checkout", "-q", "feature"]);
        git(&dir, &["merge", "-q", "--no-edit", "-m", "Merge main", "main"]);
        let merged = Oid::from_str(&git(&dir, &["rev-parse", "HEAD"])).unwrap();
        assert_eq!(
            advance(&dir, before, merged),
            HeadAdvance { is_descendant: true, count: 1, subjects: vec!["Merge main".into()] }
        );
    }

    #[test]
    fn moving_back_to_an_ancestor_is_not_an_advance() {
        let dir = repo("reset");
        let base = commit(&dir, "base");
        let tip = commit(&dir, "tip");
        assert!(!advance(&dir, tip, base).is_descendant);
    }

    #[test]
    fn jumping_to_an_unrelated_branch_is_not_an_advance() {
        let dir = repo("sideways");
        let base = commit(&dir, "base");
        let main_tip = commit(&dir, "on main");
        git(&dir, &["checkout", "-q", "-b", "other", &base.to_string()]);
        let other_tip = commit(&dir, "on other");
        assert_eq!(advance(&dir, main_tip, other_tip), HeadAdvance::none());
    }

    #[test]
    fn rebased_history_is_not_an_advance() {
        let dir = repo("rebase");
        let base = commit(&dir, "base");
        let before = commit(&dir, "work");
        // 같은 내용을 다시 쓴 커밋(amend)은 옛 HEAD 의 자손이 아니다.
        git(&dir, &["commit", "-q", "--amend", "--allow-empty", "-m", "work (amended)"]);
        let after = Oid::from_str(&git(&dir, &["rev-parse", "HEAD"])).unwrap();
        assert!(!advance(&dir, before, after).is_descendant);
        assert!(advance(&dir, base, after).is_descendant);
    }

    #[test]
    fn same_commit_or_unknown_commit_is_not_an_advance() {
        let dir = repo("same");
        let tip = commit(&dir, "tip");
        assert!(!advance(&dir, tip, tip).is_descendant);
        let missing = Oid::from_str("0123456789012345678901234567890123456789").unwrap();
        assert!(!advance(&dir, missing, tip).is_descendant);
    }

    #[test]
    fn subjects_are_capped_but_count_is_not() {
        let dir = repo("cap");
        let base = commit(&dir, "base");
        let mut tip = base;
        for i in 0..(HEAD_ADVANCE_SUBJECT_LIMIT + 2) {
            tip = commit(&dir, &format!("c{}", i));
        }
        let result = advance(&dir, base, tip);
        assert_eq!(result.count as usize, HEAD_ADVANCE_SUBJECT_LIMIT + 2);
        assert_eq!(result.subjects.len(), HEAD_ADVANCE_SUBJECT_LIMIT);
        assert_eq!(result.subjects[0], format!("c{}", HEAD_ADVANCE_SUBJECT_LIMIT + 1));
    }
}
