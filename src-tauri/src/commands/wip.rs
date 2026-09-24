//! 커밋하지 않은 변경(WIP) 파일 목록. 「따라가기」 화면이 가장 최근에 고친 파일을 고를 때 쓴다.
//!
//! 상태는 libgit2 status 로, 수정 시각은 `fs::metadata().modified()` 로 읽는다.
//! 줄 수는 HEAD → 작업 트리(인덱스 포함) 순 변경량이다. 스테이징 여부와 상관없이
//! 「지금 작업 트리가 HEAD 와 얼마나 다른가」를 센다.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use git2::{Delta, Diff, DiffFindOptions, DiffOptions, Repository, Status, StatusOptions};
use serde::Serialize;

use crate::error::AppError;

/// 파일 수가 이보다 많으면 줄 수를 세지 않는다(`get_status` 와 같은 기준).
const DIFF_STATS_THRESHOLD: usize = 300;

/// HEAD 와 비교한 작업 트리 파일의 상태. 스테이징 여부는 나누지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WipFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WipFile {
    /// 저장소 루트 기준 경로. 이름을 바꾼 파일은 새 경로.
    pub path: String,
    /// 이름을 바꾼 파일의 옛 경로.
    pub orig_path: Option<String>,
    pub status: WipFileStatus,
    /// 마지막 수정 시각(유닉스 초, `get_status` 와 같은 단위). 삭제된 파일은 `None`.
    pub modified_at: Option<u64>,
    /// 추가된 줄 수. 파일이 많아 세지 않았으면 `None`.
    pub insertions: Option<usize>,
    /// 지운 줄 수. 파일이 많아 세지 않았으면 `None`.
    pub deletions: Option<usize>,
}

/// 파일 하나를 정렬하려고 잠시 들고 있는 값. `modified` 는 초보다 정밀하다.
struct WipEntry {
    file: WipFile,
    modified: Option<SystemTime>,
}

/// 커밋하지 않은 변경 파일을 수정 시각이 늦은 순서로 돌려준다. 삭제된 파일은 맨 뒤에 둔다.
#[tauri::command]
pub async fn get_wip_files(path: String) -> Result<Vec<WipFile>, AppError> {
    tokio::task::spawn_blocking(move || read_wip_files(Path::new(&path)))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}

pub fn read_wip_files(path: &Path) -> Result<Vec<WipFile>, AppError> {
    let repo = Repository::open(path)?;
    let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
        return Err(AppError::BareRepository(path.display().to_string()));
    };

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .renames_head_to_index(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let stats = if statuses.len() <= DIFF_STATS_THRESHOLD {
        Some(line_stats(&repo)?)
    } else {
        None
    };

    let mut entries: Vec<WipEntry> = statuses
        .iter()
        .filter_map(|entry| {
            let flags = entry.status();
            let status = status_from_flags(flags)?;
            let (path, orig_path) = entry_paths(&entry)?;
            let modified = if status == WipFileStatus::Deleted {
                None
            } else {
                modified_time(&workdir.join(&path))
            };
            let (insertions, deletions) = match &stats {
                Some(map) => {
                    let (ins, del) = map.get(&path).copied().unwrap_or((0, 0));
                    (Some(ins), Some(del))
                }
                None => (None, None),
            };
            Some(WipEntry {
                file: WipFile {
                    path,
                    orig_path,
                    status,
                    modified_at: modified.and_then(to_unix_secs),
                    insertions,
                    deletions,
                },
                modified,
            })
        })
        .collect();

    entries.sort_by(compare_entries);
    Ok(entries.into_iter().map(|e| e.file).collect())
}

/// 수정 시각이 늦은 것 먼저. 시각이 없는 파일(삭제)은 뒤로, 같으면 경로 순.
fn compare_entries(a: &WipEntry, b: &WipEntry) -> Ordering {
    match (a.modified, b.modified) {
        (Some(x), Some(y)) => y.cmp(&x),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
    .then_with(|| a.file.path.cmp(&b.file.path))
}

/// status 플래그를 HEAD 대비 상태 하나로 줄인다. 변경이 없거나 무시된 파일은 `None`.
fn status_from_flags(flags: Status) -> Option<WipFileStatus> {
    if flags.is_conflicted() {
        return Some(WipFileStatus::Conflicted);
    }
    if flags.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
        return Some(WipFileStatus::Deleted);
    }
    if flags.intersects(Status::INDEX_RENAMED | Status::WT_RENAMED) {
        return Some(WipFileStatus::Renamed);
    }
    if flags.contains(Status::INDEX_NEW) {
        return Some(WipFileStatus::Added);
    }
    if flags.contains(Status::WT_NEW) {
        return Some(WipFileStatus::Untracked);
    }
    if flags.intersects(
        Status::INDEX_MODIFIED
            | Status::INDEX_TYPECHANGE
            | Status::WT_MODIFIED
            | Status::WT_TYPECHANGE,
    ) {
        return Some(WipFileStatus::Modified);
    }
    None
}

/// 지금 경로와(이름을 바꿨으면) 옛 경로. 작업 트리 쪽 새 경로를 먼저 본다.
fn entry_paths(entry: &git2::StatusEntry<'_>) -> Option<(String, Option<String>)> {
    let to_string = |p: &Path| p.to_string_lossy().into_owned();
    let head_to_index = entry.head_to_index();
    let index_to_workdir = entry.index_to_workdir();
    let path = index_to_workdir
        .as_ref()
        .and_then(|d| d.new_file().path())
        .or_else(|| head_to_index.as_ref().and_then(|d| d.new_file().path()))
        .map(to_string)
        .or_else(|| entry.path().map(str::to_string))?;
    let orig_path = head_to_index
        .filter(|d| d.status() == Delta::Renamed)
        .and_then(|d| d.old_file().path())
        .map(to_string)
        .filter(|old| *old != path);
    Some((path, orig_path))
}

fn modified_time(full_path: &Path) -> Option<SystemTime> {
    std::fs::symlink_metadata(full_path).ok()?.modified().ok()
}

fn to_unix_secs(t: SystemTime) -> Option<u64> {
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

/// HEAD → 작업 트리(인덱스 포함) diff 의 파일별 (추가, 삭제) 줄 수. 새 경로 기준.
fn line_stats(repo: &Repository) -> Result<HashMap<String, (usize, usize)>, AppError> {
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut diff_opts = DiffOptions::new();
    diff_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    let mut diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))?;
    let mut find = DiffFindOptions::new();
    find.renames(true);
    diff.find_similar(Some(&mut find))?;
    Ok(stats_by_path(&diff))
}

fn stats_by_path(diff: &Diff<'_>) -> HashMap<String, (usize, usize)> {
    (0..diff.deltas().len())
        .filter_map(|idx| {
            let patch = git2::Patch::from_diff(diff, idx).ok()??;
            let delta = patch.delta();
            let path = delta.new_file().path().or_else(|| delta.old_file().path())?;
            let (_, ins, del) = patch.line_stats().ok()?;
            Some((path.to_string_lossy().into_owned(), (ins, del)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use std::time::Duration;

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

    /// 테스트마다 따로 쓰는 임시 폴더. 끝나면 지운다.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new() -> Self {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("gitbaro-wip-{}-{}", std::process::id(), n));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn init_repo() -> TempDir {
        let dir = TempDir::new();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        git(p, &["config", "user.email", "t@example.com"]);
        git(p, &["config", "user.name", "T"]);
        fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(p.join("b.txt"), "b\n").unwrap();
        fs::write(p.join("gone.txt"), "x\ny\n").unwrap();
        fs::write(p.join("old.txt"), "rename me\nsame content\nmore lines\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "init"]);
        dir
    }

    /// 파일 수정 시각을 `base` 에서 `offset_secs` 만큼 떨어진 값으로 맞춘다.
    fn set_mtime(path: &Path, base: SystemTime, offset_secs: u64) {
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(base + Duration::from_secs(offset_secs)).unwrap();
    }

    fn find<'a>(files: &'a [WipFile], path: &str) -> &'a WipFile {
        files.iter().find(|f| f.path == path).unwrap_or_else(|| panic!("{path} 없음: {files:?}"))
    }

    #[test]
    fn clean_repo_has_no_wip_files() {
        let dir = init_repo();
        assert!(read_wip_files(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn sorts_by_modified_time_latest_first_and_deleted_last() {
        let dir = init_repo();
        let p = dir.path();
        fs::write(p.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        fs::write(p.join("b.txt"), "b changed\n").unwrap();
        fs::write(p.join("new.txt"), "n\n").unwrap();
        fs::remove_file(p.join("gone.txt")).unwrap();

        let base = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        set_mtime(&p.join("b.txt"), base, 10);
        set_mtime(&p.join("new.txt"), base, 30);
        set_mtime(&p.join("a.txt"), base, 20);

        let files = read_wip_files(p).unwrap();
        let order: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(order, ["new.txt", "a.txt", "b.txt", "gone.txt"]);
        assert_eq!(find(&files, "new.txt").modified_at, Some(1_700_000_030));
        assert_eq!(find(&files, "a.txt").modified_at, Some(1_700_000_020));
    }

    #[test]
    fn deleted_file_has_no_modified_time() {
        let dir = init_repo();
        fs::remove_file(dir.path().join("gone.txt")).unwrap();
        let files = read_wip_files(dir.path()).unwrap();
        let gone = find(&files, "gone.txt");
        assert_eq!(gone.status, WipFileStatus::Deleted);
        assert_eq!(gone.modified_at, None);
        assert_eq!((gone.insertions, gone.deletions), (Some(0), Some(2)));
    }

    #[test]
    fn staged_deletion_is_deleted_without_time() {
        let dir = init_repo();
        git(dir.path(), &["rm", "-q", "gone.txt"]);
        let files = read_wip_files(dir.path()).unwrap();
        let gone = find(&files, "gone.txt");
        assert_eq!(gone.status, WipFileStatus::Deleted);
        assert_eq!(gone.modified_at, None);
    }

    #[test]
    fn reports_status_and_line_counts() {
        let dir = init_repo();
        let p = dir.path();
        // 한 줄 바꾸고 한 줄 추가: +2 -1
        fs::write(p.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        fs::write(p.join("untracked.txt"), "u1\nu2\nu3\n").unwrap();
        fs::write(p.join("staged.txt"), "s\n").unwrap();
        git(p, &["add", "staged.txt"]);

        let files = read_wip_files(p).unwrap();
        let a = find(&files, "a.txt");
        assert_eq!(a.status, WipFileStatus::Modified);
        assert_eq!((a.insertions, a.deletions), (Some(2), Some(1)));
        assert!(a.modified_at.is_some());

        let u = find(&files, "untracked.txt");
        assert_eq!(u.status, WipFileStatus::Untracked);
        assert_eq!((u.insertions, u.deletions), (Some(3), Some(0)));

        assert_eq!(find(&files, "staged.txt").status, WipFileStatus::Added);
    }

    #[test]
    fn staged_and_unstaged_changes_count_against_head() {
        let dir = init_repo();
        let p = dir.path();
        fs::write(p.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        git(p, &["add", "a.txt"]);
        fs::write(p.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        let files = read_wip_files(p).unwrap();
        assert_eq!(files.len(), 1);
        let a = find(&files, "a.txt");
        assert_eq!(a.status, WipFileStatus::Modified);
        assert_eq!((a.insertions, a.deletions), (Some(2), Some(1)));
    }

    #[test]
    fn staged_rename_uses_new_path() {
        let dir = init_repo();
        git(dir.path(), &["mv", "old.txt", "renamed.txt"]);
        let files = read_wip_files(dir.path()).unwrap();
        let r = find(&files, "renamed.txt");
        assert_eq!(r.status, WipFileStatus::Renamed);
        assert_eq!(r.orig_path.as_deref(), Some("old.txt"));
        assert!(r.modified_at.is_some());
        assert!(files.iter().all(|f| f.path != "old.txt"));
    }

    #[test]
    fn untracked_directory_lists_each_file() {
        let dir = init_repo();
        let p = dir.path();
        fs::create_dir_all(p.join("dir/sub")).unwrap();
        fs::write(p.join("dir/sub/x.txt"), "x\n").unwrap();
        fs::write(p.join("dir/y.txt"), "y\n").unwrap();
        let files = read_wip_files(p).unwrap();
        let mut paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        paths.sort_unstable();
        assert_eq!(paths, ["dir/sub/x.txt", "dir/y.txt"]);
    }

    #[test]
    fn ignored_files_are_left_out() {
        let dir = init_repo();
        let p = dir.path();
        fs::write(p.join(".gitignore"), "*.log\n").unwrap();
        fs::write(p.join("debug.log"), "noise\n").unwrap();
        let files = read_wip_files(p).unwrap();
        assert!(files.iter().all(|f| f.path != "debug.log"));
        assert!(files.iter().any(|f| f.path == ".gitignore"));
    }

    #[test]
    fn repo_without_commits_lists_new_files() {
        let dir = TempDir::new();
        git(dir.path(), &["init", "-q", "-b", "main"]);
        fs::write(dir.path().join("first.txt"), "1\n2\n").unwrap();
        let files = read_wip_files(dir.path()).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, WipFileStatus::Untracked);
        assert_eq!((files[0].insertions, files[0].deletions), (Some(2), Some(0)));
    }

    #[test]
    fn not_a_repository_is_an_error() {
        let dir = TempDir::new();
        assert!(read_wip_files(dir.path()).is_err());
    }

    #[test]
    fn serializes_in_camel_case() {
        let file = WipFile {
            path: "a.txt".into(),
            orig_path: None,
            status: WipFileStatus::Untracked,
            modified_at: None,
            insertions: Some(1),
            deletions: Some(0),
        };
        let json = serde_json::to_value(&file).unwrap();
        assert_eq!(json["modifiedAt"], serde_json::Value::Null);
        assert_eq!(json["origPath"], serde_json::Value::Null);
        assert_eq!(json["status"], "untracked");
        assert_eq!(json["insertions"], 1);
    }

    #[test]
    fn status_flags_map_to_one_state() {
        assert_eq!(status_from_flags(Status::CURRENT), None);
        assert_eq!(status_from_flags(Status::IGNORED), None);
        assert_eq!(
            status_from_flags(Status::INDEX_MODIFIED | Status::WT_MODIFIED),
            Some(WipFileStatus::Modified)
        );
        assert_eq!(
            status_from_flags(Status::INDEX_NEW | Status::WT_DELETED),
            Some(WipFileStatus::Deleted)
        );
        assert_eq!(status_from_flags(Status::INDEX_NEW | Status::WT_MODIFIED), Some(WipFileStatus::Added));
        assert_eq!(status_from_flags(Status::CONFLICTED), Some(WipFileStatus::Conflicted));
    }
}
