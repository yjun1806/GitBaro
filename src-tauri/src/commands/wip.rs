//! 커밋하지 않은 변경(WIP) 파일 목록. 「따라가기」 화면이 가장 최근에 고친 파일을 고를 때 쓴다.
//!
//! 상태는 `get_status` 와 같은 git CLI(`git status --porcelain=v2`)로 읽는다. libgit2 status 는
//! sparse checkout·skip-worktree 를 무시해 범위 밖 파일을 삭제로 보고하므로 쓰지 않는다
//! (`git/status.rs` 머리말 참고). 수정 시각은 `fs::symlink_metadata().modified()` 로 읽는다.
//! 줄 수는 `git diff HEAD --numstat` 기준 HEAD → 작업 트리 변경량이다. 스테이징 여부와
//! 상관없이 「지금 작업 트리가 HEAD 와 얼마나 다른가」를 센다.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::error::AppError;
use crate::git::cli::parse_git_error;
use crate::git::status::{read_status, PorcelainEntry};
use crate::git::untracked::{untracked_lines, UntrackedLines};


/// HEAD 와 비교한 작업 트리 파일의 상태.
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
    /// 스테이징한 변경이 있는지(`StatusEntry.staged` 와 같은 뜻).
    pub staged: bool,
    /// 스테이징하지 않은 변경이 있는지. 새 파일도 포함(`StatusEntry.unstaged` 와 같은 뜻).
    pub unstaged: bool,
    /// 마지막 수정 시각(유닉스 초, `get_status` 와 같은 단위). 삭제된 파일은 `None`.
    pub modified_at: Option<u64>,
    /// HEAD 대비 추가된 줄 수. 바이너리이거나 1 MiB 넘는 새 파일이라 세지 않았으면 `None`.
    pub insertions: Option<usize>,
    /// HEAD 대비 지운 줄 수. `insertions` 와 같은 경우에 `None`.
    pub deletions: Option<usize>,
}

/// 줄 수. `None` 은 셀 수 없음(바이너리 등).
type LineCounts = Option<(usize, usize)>;

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
    let workdir = worktree_root(path)?;
    let porcelain = read_status(&workdir)?;
    if porcelain.is_empty() {
        return Ok(Vec::new());
    }
    let tracked_stats = tracked_line_stats(&workdir)?;
    let listed: HashSet<&str> = porcelain.iter().map(|e| e.path.as_str()).collect();

    let mut entries: Vec<WipEntry> = porcelain
        .iter()
        .map(|entry| {
            let status = status_from_entry(entry);
            let full_path = workdir.join(&entry.path);
            let modified = if status == WipFileStatus::Deleted {
                None
            } else {
                modified_time(&full_path)
            };
            let counts = if entry.untracked {
                untracked_line_stats(&full_path)
            } else {
                line_counts_for(entry, &tracked_stats, &listed)
            };
            WipEntry {
                file: WipFile {
                    path: entry.path.clone(),
                    orig_path: entry.orig_path.clone(),
                    status,
                    staged: entry.is_staged(),
                    unstaged: entry.is_unstaged(),
                    modified_at: modified.and_then(to_unix_secs),
                    insertions: counts.map(|c| c.0),
                    deletions: counts.map(|c| c.1),
                },
                modified,
            }
        })
        .collect();

    entries.sort_by(compare_entries);
    Ok(entries.into_iter().map(|e| e.file).collect())
}

/// 작업 트리 루트. 저장소가 아니거나 bare 면 에러.
fn worktree_root(path: &Path) -> Result<std::path::PathBuf, AppError> {
    let repo = git2::Repository::open(path)?;
    repo.workdir()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::BareRepository(path.display().to_string()))
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

/// porcelain 항목 하나를 HEAD 대비 상태 하나로 줄인다.
/// 우선순위: 충돌 > 새 파일(추적 안 됨) > 삭제 > 이름 바꿈 > 추가 > 수정.
fn status_from_entry(entry: &PorcelainEntry) -> WipFileStatus {
    if entry.conflicted {
        WipFileStatus::Conflicted
    } else if entry.untracked {
        WipFileStatus::Untracked
    } else if entry.index == 'D' || entry.worktree == 'D' {
        WipFileStatus::Deleted
    } else if entry.index == 'R' {
        WipFileStatus::Renamed
    } else if entry.index == 'A' {
        WipFileStatus::Added
    } else {
        WipFileStatus::Modified
    }
}

/// 추적 중인 파일의 줄 수. `git diff` 가 이름 바꿈을 못 찾아 옛 경로를 따로 삭제로 셌다면
/// 옛 경로의 삭제 줄 수도 더한다. 옛 경로가 목록에 따로 있으면 거기서 세므로 더하지 않는다.
fn line_counts_for(
    entry: &PorcelainEntry,
    stats: &HashMap<String, LineCounts>,
    listed: &HashSet<&str>,
) -> LineCounts {
    let own = stats.get(&entry.path).copied().unwrap_or(Some((0, 0)));
    let orig = entry
        .orig_path
        .as_deref()
        .filter(|orig| !listed.contains(orig))
        .and_then(|orig| stats.get(orig).copied())
        .unwrap_or(Some((0, 0)));
    match (own, orig) {
        (Some((ai, ad)), Some((bi, bd))) => Some((ai + bi, ad + bd)),
        _ => None,
    }
}

fn modified_time(full_path: &Path) -> Option<SystemTime> {
    std::fs::symlink_metadata(full_path).ok()?.modified().ok()
}

fn to_unix_secs(t: SystemTime) -> Option<u64> {
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

/// git CLI 를 읽기 전용으로 실행해 stdout 을 돌려준다. status 처럼 자주 불리므로 잠금을 잡지 않는다.
fn run_git(workdir: &Path, args: &[&str], stdin_empty: bool) -> Result<Vec<u8>, AppError> {
    tracing::debug!("[git] git {}", args.join(" "));
    let mut cmd = Command::new("git");
    cmd.arg("--no-optional-locks")
        .args(args)
        .current_dir(workdir)
        .env("GIT_TERMINAL_PROMPT", "0");
    if stdin_empty {
        cmd.stdin(Stdio::null());
    }
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::GitCliNotFound
        } else {
            AppError::Io(e)
        }
    })?;
    if !output.status.success() {
        return Err(AppError::GitCli {
            message: parse_git_error(&String::from_utf8_lossy(&output.stderr)),
            exit_code: output.status.code(),
        });
    }
    Ok(output.stdout)
}

/// 비교 기준 트리. 커밋이 없는 저장소는 빈 트리(해시 형식에 맞게 git 이 계산).
fn base_revision(workdir: &Path) -> Result<String, AppError> {
    if run_git(workdir, &["rev-parse", "--verify", "-q", "HEAD^{tree}"], true).is_ok() {
        return Ok("HEAD".to_string());
    }
    let out = run_git(workdir, &["hash-object", "-t", "tree", "--stdin"], true)?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}

/// HEAD → 작업 트리(인덱스 포함) 의 파일별 줄 수. 이름 바꿈으로 찾은 파일은 새 경로에 둔다.
/// sparse checkout 범위 밖 파일(skip-worktree)은 git 이 비교하지 않는다.
fn tracked_line_stats(workdir: &Path) -> Result<HashMap<String, LineCounts>, AppError> {
    let base = base_revision(workdir)?;
    let out = run_git(
        workdir,
        &[
            "diff",
            "--numstat",
            "-z",
            "--find-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=none",
            &base,
            "--",
        ],
        true,
    )?;
    Ok(parse_numstat_z(&out))
}

/// `git diff --numstat -z` 출력 해석. 레코드는 `<ins>\t<del>\t<path>\0` 이고,
/// 이름 바꿈이면 `<ins>\t<del>\t\0<old>\0<new>\0` 이다. 바이너리는 `-` 로 나온다.
fn parse_numstat_z(output: &[u8]) -> HashMap<String, LineCounts> {
    let mut fields = output
        .split(|b| *b == 0)
        .map(|r| String::from_utf8_lossy(r).into_owned());
    let mut stats = HashMap::new();
    while let Some(record) = fields.next() {
        let mut parts = record.splitn(3, '\t');
        let (Some(ins), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let path = if path.is_empty() {
            let _old = fields.next();
            match fields.next() {
                Some(new) => new,
                None => break,
            }
        } else {
            path.to_string()
        };
        let counts = match (ins.parse::<usize>(), del.parse::<usize>()) {
            (Ok(i), Ok(d)) => Some((i, d)),
            _ => None,
        };
        stats.insert(path, counts);
    }
    stats
}

/// 새(추적 안 된) 파일의 줄 수. 전부 추가된 줄로 센다. 바이너리·너무 큰 파일·읽기 실패는 `None`.
fn untracked_line_stats(full_path: &Path) -> LineCounts {
    match untracked_lines(full_path) {
        UntrackedLines::Text(n) => Some((n, 0)),
        _ => None,
    }
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
            staged: false,
            unstaged: true,
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

    fn entry(xy: &str) -> PorcelainEntry {
        let mut chars = xy.chars();
        PorcelainEntry {
            path: "f".into(),
            orig_path: None,
            index: chars.next().unwrap(),
            worktree: chars.next().unwrap(),
            conflicted: false,
            untracked: false,
        }
    }

    #[test]
    fn porcelain_entries_map_to_one_state() {
        assert_eq!(status_from_entry(&entry(".M")), WipFileStatus::Modified);
        assert_eq!(status_from_entry(&entry("MM")), WipFileStatus::Modified);
        assert_eq!(status_from_entry(&entry(".T")), WipFileStatus::Modified);
        assert_eq!(status_from_entry(&entry("AD")), WipFileStatus::Deleted);
        assert_eq!(status_from_entry(&entry("D.")), WipFileStatus::Deleted);
        assert_eq!(status_from_entry(&entry("RD")), WipFileStatus::Deleted);
        assert_eq!(status_from_entry(&entry("RM")), WipFileStatus::Renamed);
        assert_eq!(status_from_entry(&entry("AM")), WipFileStatus::Added);
        let untracked = PorcelainEntry { untracked: true, ..entry(".?") };
        assert_eq!(status_from_entry(&untracked), WipFileStatus::Untracked);
        let conflicted = PorcelainEntry { conflicted: true, ..entry("..") };
        assert_eq!(status_from_entry(&conflicted), WipFileStatus::Conflicted);
    }

    #[test]
    fn parses_numstat_records_renames_and_binaries() {
        let out = b"2\t1\ta.txt\x000\t3\t\x00old.txt\x00new name.txt\x00-\t-\timg.png\x00";
        let stats = parse_numstat_z(out);
        assert_eq!(stats.get("a.txt"), Some(&Some((2, 1))));
        assert_eq!(stats.get("new name.txt"), Some(&Some((0, 3))));
        assert_eq!(stats.get("old.txt"), None);
        assert_eq!(stats.get("img.png"), Some(&None));
    }

    #[test]
    fn sparse_checkout_hides_files_outside_the_cone() {
        let dir = TempDir::new();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        fs::create_dir_all(p.join("inside")).unwrap();
        fs::create_dir_all(p.join("outside")).unwrap();
        fs::write(p.join("inside/i.txt"), "i\n").unwrap();
        fs::write(p.join("outside/o.txt"), "o\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init"]);
        git(p, &["sparse-checkout", "set", "inside"]);
        assert!(!p.join("outside/o.txt").exists());
        assert!(read_wip_files(p).unwrap().is_empty());

        fs::write(p.join("inside/i.txt"), "i\nmore\n").unwrap();
        let files = read_wip_files(p).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "inside/i.txt");
        assert_eq!((files[0].insertions, files[0].deletions), (Some(1), Some(0)));
    }

    #[test]
    fn conflicted_file_counts_lines_against_head() {
        let dir = init_repo();
        let p = dir.path();
        git(p, &["checkout", "-q", "-b", "other"]);
        fs::write(p.join("a.txt"), "one\nOTHER\nthree\n").unwrap();
        git(p, &["commit", "-q", "-am", "other"]);
        git(p, &["checkout", "-q", "main"]);
        fs::write(p.join("a.txt"), "one\nMAIN\nthree\n").unwrap();
        git(p, &["commit", "-q", "-am", "main"]);
        let merge = Command::new("git")
            .args(["merge", "other"])
            .current_dir(p)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(!merge.status.success(), "충돌이 나야 한다");

        let files = read_wip_files(p).unwrap();
        let a = find(&files, "a.txt");
        assert_eq!(a.status, WipFileStatus::Conflicted);
        let (ins, del) = (a.insertions.unwrap(), a.deletions.unwrap());
        assert!(ins + del > 0, "충돌 표시 줄이 세져야 한다: +{ins} -{del}");
        assert!(!a.staged && !a.unstaged);
    }

    #[test]
    fn rewritten_rename_counts_old_path_deletions() {
        let dir = init_repo();
        let p = dir.path();
        git(p, &["mv", "old.txt", "renamed.txt"]);
        fs::write(p.join("renamed.txt"), "w\nx\ny\nz\n").unwrap();
        let files = read_wip_files(p).unwrap();
        let r = find(&files, "renamed.txt");
        assert_eq!(r.status, WipFileStatus::Renamed);
        assert_eq!(r.orig_path.as_deref(), Some("old.txt"));
        assert_eq!((r.insertions, r.deletions), (Some(4), Some(3)));
    }

    #[test]
    fn renamed_then_removed_counts_old_lines_as_deleted() {
        let dir = init_repo();
        let p = dir.path();
        git(p, &["mv", "old.txt", "renamed.txt"]);
        fs::remove_file(p.join("renamed.txt")).unwrap();
        let files = read_wip_files(p).unwrap();
        let r = find(&files, "renamed.txt");
        assert_eq!(r.status, WipFileStatus::Deleted);
        assert_eq!(r.modified_at, None);
        assert_eq!((r.insertions, r.deletions), (Some(0), Some(3)));
    }

    #[test]
    fn reports_staged_and_unstaged_sides() {
        let dir = init_repo();
        let p = dir.path();
        fs::write(p.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        git(p, &["add", "a.txt"]);
        fs::write(p.join("b.txt"), "b changed\n").unwrap();
        fs::write(p.join("new.txt"), "n\n").unwrap();
        let files = read_wip_files(p).unwrap();
        let a = find(&files, "a.txt");
        assert!(a.staged && !a.unstaged);
        let b = find(&files, "b.txt");
        assert!(!b.staged && b.unstaged);
        let n = find(&files, "new.txt");
        assert!(!n.staged && n.unstaged);
    }

    #[test]
    fn binary_new_file_has_no_line_counts() {
        let dir = init_repo();
        fs::write(dir.path().join("blob.bin"), [0u8, 1, 2, 0, 3]).unwrap();
        let files = read_wip_files(dir.path()).unwrap();
        let b = find(&files, "blob.bin");
        assert_eq!((b.insertions, b.deletions), (None, None));
    }
}
