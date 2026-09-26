//! 커밋 범위의 변경: 두 커밋 사이에서 바뀐 파일과 파일 하나의 diff, 그리고 main 과 갈라진 지점.
//!
//! 그래프가 「push 안 한 범위」(원격에 올라간 지점 → HEAD)를 한 번에 보여 줄 때 쓴다. 두 커밋의
//! 트리만 비교하므로 커밋하지 않은 변경은 들어가지 않는다. 저장소마다 따로 부른다.
//!
//! - `get_divergence_point`: HEAD 가 기본 브랜치(main)와 갈라진 지점. 워크스페이스 타임라인과 같은
//!   규칙(`git::merge_base::divergence_point`)이다. 파일을 비교하지 않아 가볍다.
//! - `get_range_changed_files`: `base` → `head` 에서 바뀐 파일. `base` 가 없으면 빈 트리(처음부터)와 비교한다.
//! - `get_range_file_diff`: 같은 범위의 파일 하나의 줄 단위 diff. PR 파일 diff 와 같은 모양이다.

use git2::{ErrorCode, Oid, Repository, Tree};
use serde::Serialize;

use crate::error::AppError;
use crate::git::file_diff::{changed_files_between, tree_file_diff, ChangedFile, TreeFileDiff};
use crate::git::merge_base::{divergence_point, BaseStatus};

/// `get_divergence_point` 의 결과. TS `DivergencePoint` 와 같은 모양이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DivergenceInfo {
    /// 체크아웃한 로컬 브랜치. detached HEAD 면 `None`.
    pub branch: Option<String>,
    /// HEAD 커밋. 커밋이 없는 저장소면 `None`.
    pub head_oid: Option<String>,
    /// 기본 브랜치 이름(`main`). 찾지 못하면 `None`.
    pub default_branch: Option<String>,
    /// 갈라진 지점을 준 참조(`main`, `origin/main`).
    pub base_ref: Option<String>,
    /// 갈라진 지점을 찾았는가. 커밋이 없는 저장소면 `None`.
    pub base_status: Option<BaseStatus>,
    /// main 과 갈라진 지점. `base_status` 가 `found` 일 때만 있다. HEAD 가 기본 브랜치 자신이면
    /// 그 upstream 과의 공통 조상이다(아직 push 하지 않은 커밋이 그 위에 있다).
    pub merge_base_oid: Option<String>,
}

pub fn divergence_info(path: &str) -> Result<DivergenceInfo, AppError> {
    let repo = open(path)?;
    let head_ref = match repo.head() {
        Ok(head_ref) => head_ref,
        Err(e) if e.code() == ErrorCode::UnbornBranch => {
            return Ok(DivergenceInfo {
                branch: None,
                head_oid: None,
                default_branch: None,
                base_ref: None,
                base_status: None,
                merge_base_oid: None,
            })
        }
        Err(e) => return Err(e.into()),
    };
    let head = head_ref.peel_to_commit()?.id();
    let branch = head_ref.is_branch().then(|| head_ref.shorthand().map(str::to_string)).flatten();
    let point = divergence_point(&repo, head, branch.as_deref())?;
    Ok(DivergenceInfo {
        branch,
        head_oid: Some(head.to_string()),
        default_branch: point.default_branch,
        base_ref: point.base_ref,
        base_status: Some(point.status),
        merge_base_oid: point.merge_base.map(|o| o.to_string()),
    })
}

fn open(path: &str) -> Result<Repository, AppError> {
    let repo = Repository::open(path)?;
    if repo.is_bare() {
        return Err(AppError::BareRepository(path.to_string()));
    }
    Ok(repo)
}

/// 전체 커밋 OID(40자 hex)만 받는다. 브랜치 이름·짧은 SHA·`-` 로 시작하는 값은 거부한다.
fn commit_oid(repo: &Repository, oid: &str) -> Result<Oid, AppError> {
    let oid = oid.trim();
    if oid.len() != 40 || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::Git(git2::Error::from_str(&format!("not a full commit id: {oid:?}"))));
    }
    Ok(repo.find_commit(Oid::from_str(oid)?)?.id())
}

/// 범위의 두 트리와 옛 쪽 커밋, 옛 쪽이 새 쪽의 조상인가(없으면 빈 트리라 `true`).
fn range_trees<'r>(
    repo: &'r Repository,
    base_oid: Option<&str>,
    head_oid: &str,
) -> Result<(Option<Tree<'r>>, Tree<'r>, Option<Oid>, bool), AppError> {
    let head = commit_oid(repo, head_oid)?;
    let head_tree = repo.find_commit(head)?.tree()?;
    let Some(base_oid) = base_oid else {
        return Ok((None, head_tree, None, true));
    };
    let base = commit_oid(repo, base_oid)?;
    let is_ancestor = base == head || repo.graph_descendant_of(head, base)?;
    Ok((Some(repo.find_commit(base)?.tree()?), head_tree, Some(base), is_ancestor))
}

/// `base`(없으면 빈 트리) → `head` 에서 바뀐 파일. `base` 가 `head` 의 조상이 아니어도 두 트리를 그대로 비교한다.
pub fn range_changed_files(path: &str, base_oid: Option<&str>, head_oid: &str) -> Result<Vec<ChangedFile>, AppError> {
    let repo = open(path)?;
    let (base_tree, head_tree, _, _) = range_trees(&repo, base_oid, head_oid)?;
    Ok(changed_files_between(&repo, base_tree.as_ref(), &head_tree)?)
}

/// 파일 하나를 `base`(없으면 빈 트리) → `head` 로 비교한 줄 단위 diff. `old_path` 는 `ChangedFile::old_path` 를 넘긴다.
pub fn range_file_diff(
    path: &str,
    base_oid: Option<&str>,
    head_oid: &str,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<TreeFileDiff, AppError> {
    let repo = open(path)?;
    let (base_tree, head_tree, base, is_ancestor) = range_trees(&repo, base_oid, head_oid)?;
    tree_file_diff(&repo, base_tree.as_ref(), &head_tree, file_path, old_path, base, is_ancestor)
}

/// HEAD 가 기본 브랜치(main)와 갈라진 지점. 파일을 비교하지 않는다.
#[tauri::command]
pub async fn get_divergence_point(path: String) -> Result<DivergenceInfo, AppError> {
    tokio::task::spawn_blocking(move || divergence_info(&path))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

/// `base_oid`(없으면 처음부터) → `head_oid` 에서 바뀐 파일. 커밋하지 않은 변경은 넣지 않는다.
#[tauri::command]
pub async fn get_range_changed_files(
    path: String,
    base_oid: Option<String>,
    head_oid: String,
) -> Result<Vec<ChangedFile>, AppError> {
    tokio::task::spawn_blocking(move || range_changed_files(&path, base_oid.as_deref(), &head_oid))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

/// 같은 범위의 파일 하나의 줄 단위 diff.
#[tauri::command]
pub async fn get_range_file_diff(
    path: String,
    base_oid: Option<String>,
    head_oid: String,
    file_path: String,
    old_path: Option<String>,
) -> Result<TreeFileDiff, AppError> {
    tokio::task::spawn_blocking(move || {
        range_file_diff(&path, base_oid.as_deref(), &head_oid, &file_path, old_path.as_deref())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::engine::FileStatus;
    use crate::git::file_diff::TRACKED_DIFF_LIMIT;
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
                .join(format!("gitbaro-range-{name}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn str(&self) -> &str {
            self.0.to_str().unwrap()
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

    fn paths(files: &[ChangedFile]) -> Vec<&str> {
        files.iter().map(|f| f.path.as_str()).collect()
    }

    fn find<'a>(files: &'a [ChangedFile], path: &str) -> &'a ChangedFile {
        files.iter().find(|f| f.path == path).unwrap_or_else(|| panic!("{path} 없음: {files:?}"))
    }

    fn lines_of(d: &TreeFileDiff, kind: &str) -> Vec<String> {
        d.hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.kind == kind)
            .map(|l| l.content.trim_end().to_string())
            .collect()
    }

    /// main: a.txt, keep.txt, old.txt → base / feat: a.txt 수정, b.txt 추가, old.txt → new.txt 이름 바꿈.
    /// 돌려주는 값은 (base 커밋, feat 의 HEAD).
    fn feature_repo(dir: &Path) -> (String, String) {
        git(dir, &["init", "-q", "-b", "main"]);
        write(dir, "a.txt", "one\ntwo\n");
        write(dir, "keep.txt", "keep\n");
        write(dir, "old.txt", "moved\ncontent\nstays\nthe\nsame\n");
        let base = commit_all(dir, "base");
        git(dir, &["checkout", "-q", "-b", "feat"]);
        write(dir, "a.txt", "one\ntwo\nthree\n");
        write(dir, "b.txt", "new\n");
        git(dir, &["mv", "old.txt", "new.txt"]);
        let head = commit_all(dir, "feat work");
        (base, head)
    }

    #[test]
    fn divergence_point_is_where_the_branch_left_main() {
        let dir = TempDir::new("fork");
        let (base, _) = feature_repo(dir.path());
        // main 이 더 나아가도 갈라진 지점은 그대로다.
        git(dir.path(), &["checkout", "-q", "main"]);
        write(dir.path(), "main-only.txt", "m\n");
        commit_all(dir.path(), "main later");
        git(dir.path(), &["checkout", "-q", "feat"]);

        let d = divergence_info(dir.str()).unwrap();
        assert_eq!(d.branch.as_deref(), Some("feat"));
        assert_eq!(d.default_branch.as_deref(), Some("main"));
        assert_eq!(d.base_ref.as_deref(), Some("main"));
        assert_eq!(d.base_status, Some(BaseStatus::Found));
        assert_eq!(d.merge_base_oid.as_deref(), Some(base.as_str()));
        assert_eq!(d.head_oid.as_deref(), Some(git(dir.path(), &["rev-parse", "HEAD"]).as_str()));
    }

    #[test]
    fn divergence_point_of_an_empty_repo_is_unknown() {
        let dir = TempDir::new("empty");
        git(dir.path(), &["init", "-q", "-b", "main"]);
        let d = divergence_info(dir.str()).unwrap();
        assert_eq!((d.head_oid, d.base_status, d.merge_base_oid), (None, None, None));
    }

    #[test]
    fn divergence_point_serializes_the_shape_the_graph_reads() {
        // src/types/index.ts 의 DivergencePoint 와 키가 같아야 한다.
        let dir = TempDir::new("fork-shape");
        feature_repo(dir.path());
        let json = serde_json::to_value(divergence_info(dir.str()).unwrap()).unwrap();
        let mut keys: Vec<&String> = json.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["baseRef", "baseStatus", "branch", "defaultBranch", "headOid", "mergeBaseOid"]);
        assert_eq!(json["baseStatus"], "found");
    }

    #[test]
    fn range_lists_committed_changes_only() {
        let dir = TempDir::new("range");
        let (base, head) = feature_repo(dir.path());
        // 커밋하지 않은 변경은 범위에 들어가지 않는다.
        write(dir.path(), "keep.txt", "changed\n");
        write(dir.path(), "untracked.txt", "u\n");

        let files = range_changed_files(dir.str(), Some(&base), &head).unwrap();
        assert_eq!(paths(&files), vec!["a.txt", "b.txt", "new.txt"]);
        let a = find(&files, "a.txt");
        assert_eq!((a.status.clone(), a.additions, a.deletions), (FileStatus::Modified, 1, 0));
        assert_eq!(find(&files, "b.txt").status, FileStatus::Added);
        let renamed = find(&files, "new.txt");
        assert_eq!(renamed.status, FileStatus::Renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));
    }

    #[test]
    fn range_between_the_same_commit_is_empty_and_without_a_base_starts_from_scratch() {
        let dir = TempDir::new("range-edges");
        let (base, head) = feature_repo(dir.path());
        assert!(range_changed_files(dir.str(), Some(&head), &head).unwrap().is_empty());
        let all = range_changed_files(dir.str(), None, &base).unwrap();
        assert_eq!(paths(&all), vec!["a.txt", "keep.txt", "old.txt"]);
        assert!(all.iter().all(|f| f.status == FileStatus::Added));
    }

    #[test]
    fn range_marks_binary_and_huge_files_without_line_counts() {
        let dir = TempDir::new("range-big");
        let (_, head) = feature_repo(dir.path());
        std::fs::write(dir.path().join("img.bin"), [0u8, 1, 2, 0, 255]).unwrap();
        let line = "0123456789abcdef\n";
        write(dir.path(), "dump.sql", &line.repeat(TRACKED_DIFF_LIMIT as usize / line.len() + 1));
        let next = commit_all(dir.path(), "big");

        let files = range_changed_files(dir.str(), Some(&head), &next).unwrap();
        let img = find(&files, "img.bin");
        assert!(img.is_binary && !img.too_large);
        let dump = find(&files, "dump.sql");
        assert!(dump.too_large);
        assert_eq!((dump.additions, dump.deletions), (0, 0));

        let d = range_file_diff(dir.str(), Some(&head), &next, "dump.sql", None).unwrap();
        assert!(d.binary && d.hunks.is_empty() && d.new_content.is_empty());
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["binaryPreview"]["meta"]["tooLarge"], true);
    }

    #[test]
    fn range_file_diff_compares_the_two_commits() {
        let dir = TempDir::new("range-diff");
        let (base, head) = feature_repo(dir.path());
        write(dir.path(), "a.txt", "working tree only\n");

        let d = range_file_diff(dir.str(), Some(&base), &head, "a.txt", None).unwrap();
        assert_eq!(lines_of(&d, "addition"), vec!["three"]);
        assert_eq!((d.insertions, d.deletions), (1, 0));
        assert_eq!(d.old_content, "one\ntwo\n");
        assert_eq!(d.new_content, "one\ntwo\nthree\n", "작업 트리가 아니라 head 커밋의 내용");
        assert_eq!(d.base_oid.as_deref(), Some(base.as_str()));
        assert!(d.base_is_merge_base);

        let renamed = range_file_diff(dir.str(), Some(&base), &head, "new.txt", Some("old.txt")).unwrap();
        assert!(renamed.hunks.is_empty(), "내용이 같은 이름 바꾸기: {:?}", renamed.hunks);
        assert_eq!(renamed.old_content, renamed.new_content);

        let added = range_file_diff(dir.str(), None, &head, "b.txt", None).unwrap();
        assert_eq!(lines_of(&added, "addition"), vec!["new"]);
        assert_eq!(added.base_oid, None);
    }

    #[test]
    fn a_base_that_is_not_an_ancestor_is_compared_as_is() {
        let dir = TempDir::new("range-sideways");
        let (_, head) = feature_repo(dir.path());
        git(dir.path(), &["checkout", "-q", "main"]);
        write(dir.path(), "a.txt", "main side\n");
        let main = commit_all(dir.path(), "main moves");
        let d = range_file_diff(dir.str(), Some(&main), &head, "a.txt", None).unwrap();
        assert!(!d.base_is_merge_base);
        assert_eq!(d.old_content, "main side\n");
    }

    #[test]
    fn serialized_shapes_match_the_typescript_types() {
        // src/types/index.ts 의 RangeChangedFile·TreeFileDiff 와 키가 같아야 한다.
        let dir = TempDir::new("range-shape");
        let (base, head) = feature_repo(dir.path());
        let files = serde_json::to_value(range_changed_files(dir.str(), Some(&base), &head).unwrap()).unwrap();
        let keys = |v: &serde_json::Value| {
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort();
            k
        };
        assert_eq!(
            keys(&files[0]),
            vec!["additions", "deletions", "isBinary", "oldPath", "path", "status", "tooLarge"]
        );
        let diff = serde_json::to_value(range_file_diff(dir.str(), Some(&base), &head, "a.txt", None).unwrap()).unwrap();
        assert_eq!(
            keys(&diff),
            vec![
                "baseIsMergeBase", "baseOid", "binary", "deletions", "filePath", "hunks", "insertions",
                "newContent", "oldContent", "oldPath"
            ]
        );
        assert_eq!(keys(&diff["hunks"][0]), vec!["header", "lines", "newStart", "oldStart"]);
        assert_eq!(keys(&diff["hunks"][0]["lines"][0]), vec!["content", "kind", "newLineNo", "oldLineNo"]);
    }

    #[test]
    fn bad_input_is_rejected() {
        let dir = TempDir::new("range-bad");
        let (base, head) = feature_repo(dir.path());
        assert!(range_file_diff(dir.str(), Some(&base), &head, "../etc/passwd", None).is_err());
        assert!(range_file_diff(dir.str(), Some(&base), &head, "a.txt", Some("/etc/passwd")).is_err());
        // 브랜치 이름·짧은 SHA·없는 커밋은 받지 않는다.
        assert!(range_changed_files(dir.str(), Some("main"), &head).is_err());
        assert!(range_changed_files(dir.str(), Some(&base[..7]), &head).is_err());
        assert!(range_changed_files(dir.str(), None, "0123456789abcdef0123456789abcdef01234567").is_err());
        assert!(range_changed_files(dir.str(), Some("--output=x"), &head).is_err());
    }

    #[tokio::test]
    async fn a_missing_repo_is_an_error() {
        assert!(get_divergence_point("/definitely/not/a/repo".into()).await.is_err());
        let zero = "0".repeat(40);
        assert!(get_range_changed_files("/definitely/not/a/repo".into(), None, zero).await.is_err());
    }
}
