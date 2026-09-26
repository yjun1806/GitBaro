//! 원격에 없는 커밋이 파일마다 어떻게 닿았나(워크스페이스 리뷰의 「파일별 보기」).
//!
//! 기준은 `git::unpushed`와 같다(`git rev-list HEAD --not --remotes`). 커밋마다 첫 부모와 트리를
//! 비교하고(병합 커밋도 첫 부모만), 같은 파일을 건드린 커밋을 모은다. 이름을 바꾼 파일은 지금(HEAD)
//! 이름으로 묶는다. 파일의 합친 변경은 `range_base` → HEAD 비교에서 온다.

use std::collections::{HashMap, HashSet};

use git2::{ErrorCode, Oid, Repository};
use serde::Serialize;

use crate::git::commit::subject_line;
use crate::git::engine::FileStatus;
use crate::git::file_diff::{changed_files_between, ChangedFile};
use crate::git::unpushed::{commits_not_on_any_remote, upstream_tip};

/// 커밋을 이만큼만 읽는다. 넘으면 `truncated`.
pub const FILE_TOUCHES_LIMIT: usize = 500;

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
    /// 첫 부모. 이 커밋만의 diff 는 `parent_oid` → `oid` 로 본다. 첫 커밋이면 `None`(빈 트리).
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

/// 원격에 없는 커밋이 건드린 파일 하나.
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
    /// 최신 순.
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
    /// 원격에 없는 커밋이 `FILE_TOUCHES_LIMIT` 보다 많아 앞부분만 읽었다.
    pub truncated: bool,
    /// 범위 바로 아래 커밋: HEAD 에서 첫 부모를 따라 내려가 처음 만나는 원격에 있는 커밋.
    /// 합친 diff 는 `range_base` → `head` 다. 범위가 처음 커밋까지 닿으면 `None`(빈 트리).
    /// `truncated` 면 읽은 범위의 끝이라 원격에 없는 커밋일 수 있다. 원격에 없는 커밋이 없으면 `head` 와 같다.
    pub range_base: Option<String>,
    /// HEAD 커밋. 커밋이 없는 저장소면 `None`.
    pub head: Option<String>,
    /// 커밋 2개 이상이 건드린 파일 먼저, 그다음 가장 최근 커밋 시각 순.
    pub files: Vec<FileTouches>,
}

impl RepoFileTouches {
    fn empty(path: &str) -> Self {
        RepoFileTouches { path: path.to_string(), error: None, truncated: false, range_base: None, head: None, files: Vec::new() }
    }
}

/// 저장소 하나를 읽는다. 실패는 `error` 에 담고 에러로 올리지 않는다.
pub fn repo_file_touches(path: &str, limit: usize) -> RepoFileTouches {
    match Repository::open(path).and_then(|repo| file_touches(&repo, path, limit)) {
        Ok(result) => result,
        Err(e) => RepoFileTouches { error: Some(e.message().to_string()), ..RepoFileTouches::empty(path) },
    }
}

fn file_touches(repo: &Repository, path: &str, limit: usize) -> Result<RepoFileTouches, git2::Error> {
    let head_ref = match repo.head() {
        Ok(head_ref) => head_ref,
        Err(e) if e.code() == ErrorCode::UnbornBranch => return Ok(RepoFileTouches::empty(path)),
        Err(e) => return Err(e),
    };
    let head = head_ref.peel_to_commit()?.id();
    let upstream = head_ref
        .is_branch()
        .then(|| head_ref.shorthand())
        .flatten()
        .and_then(|name| repo.find_branch(name, git2::BranchType::Local).ok())
        .as_ref()
        .and_then(upstream_tip);

    // 하나 더 읽어 한도를 넘었는지 안다.
    let mut oids = commits_not_on_any_remote(repo, &[head], upstream, limit + 1)?;
    let truncated = oids.len() > limit;
    oids.truncate(limit);
    let base = RepoFileTouches { head: Some(head.to_string()), truncated, ..RepoFileTouches::empty(path) };
    if oids.is_empty() {
        return Ok(RepoFileTouches { range_base: Some(head.to_string()), ..base });
    }

    let range_base = first_parent_below(repo, head, &oids.iter().copied().collect())?;
    let base_tree = range_base.map(|oid| repo.find_commit(oid).and_then(|c| c.tree())).transpose()?;
    let head_tree = repo.find_commit(head)?.tree()?;
    let combined: HashMap<String, ChangedFile> = changed_files_between(repo, base_tree.as_ref(), &head_tree)?
        .into_iter()
        .map(|f| (f.path.clone(), f))
        .collect();

    // 최신 커밋부터 읽으며, 그 시점의 경로 → 지금 경로를 이어 간다(이름 바꾸기를 거슬러 올라간다).
    let mut current_path: HashMap<String, String> = HashMap::new();
    let mut groups: HashMap<String, Vec<CommitTouch>> = HashMap::new();
    for oid in &oids {
        let commit = repo.find_commit(*oid)?;
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

    let mut files: Vec<FileTouches> = groups
        .into_iter()
        .map(|(path, commits)| {
            let range = combined.get(&path);
            FileTouches {
                old_path: range.and_then(|f| f.old_path.clone()),
                status: range.map(|f| f.status.clone()),
                additions: range.map_or(0, |f| f.additions),
                deletions: range.map_or(0, |f| f.deletions),
                is_binary: range.map_or_else(|| commits.iter().any(|c| c.is_binary), |f| f.is_binary),
                too_large: range.map_or_else(|| commits.iter().any(|c| c.too_large), |f| f.too_large),
                path,
                commits,
            }
        })
        .collect();
    files.sort_by(|a, b| {
        let newest = |f: &FileTouches| f.commits.iter().map(|c| c.author_time).max().unwrap_or(0);
        (b.commits.len() >= 2)
            .cmp(&(a.commits.len() >= 2))
            .then(newest(b).cmp(&newest(a)))
            .then(a.path.cmp(&b.path))
    });

    Ok(RepoFileTouches { range_base: range_base.map(|o| o.to_string()), files, ..base })
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
    fn a_merge_commit_is_compared_with_its_first_parent_only() {
        let tmp = TempDir::new("merge");
        let (work, pushed) = cloned(&tmp);
        git(&work, &["checkout", "-q", "-b", "side"]);
        write(&work, "side.txt", "s\n");
        let side = commit_at(&work, "side", 2_000);
        git(&work, &["checkout", "-q", "main"]);
        write(&work, "main.txt", "m\n");
        let on_main = commit_at(&work, "main", 3_000);
        git(&work, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
        let merge = git(&work, &["rev-parse", "HEAD"]);

        let r = touches(&work);
        assert_eq!(r.range_base.as_deref(), Some(pushed.as_str()), "첫 부모 줄의 아래");
        let s = file(&r, "side.txt");
        assert_eq!(oids(s), vec![merge.as_str(), side.as_str()], "병합은 첫 부모(main) 대비 side.txt 를 가져왔다");
        assert_eq!(s.commits[0].parent_oid.as_deref(), Some(on_main.as_str()));
        assert_eq!(oids(file(&r, "main.txt")), vec![on_main.as_str()], "병합 커밋은 첫 부모에 있던 변경을 다시 세지 않는다");
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
        let (work, _) = cloned(&tmp);
        let mut made = Vec::new();
        for i in 0..5 {
            write(&work, "a.txt", &format!("v{i}\n"));
            made.push(commit_at(&work, &format!("c{i}"), 2_000 + i));
        }
        let r = repo_file_touches(work.to_str().unwrap(), 3);
        assert!(r.truncated);
        let a = file(&r, "a.txt");
        assert_eq!(oids(a), vec![made[4].as_str(), made[3].as_str(), made[2].as_str()]);
        assert_eq!(r.range_base.as_deref(), Some(made[1].as_str()), "읽은 범위의 끝");

        let exact = repo_file_touches(work.to_str().unwrap(), 5);
        assert!(!exact.truncated, "딱 한도만큼이면 잘리지 않았다");
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
        assert_eq!(keys(&json), vec!["error", "files", "head", "path", "rangeBase", "truncated"]);
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
