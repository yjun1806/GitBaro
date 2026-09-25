//! 추적하지 않는 새 파일의 줄 수. 너무 큰 파일은 읽지 않는다.
//!
//! 새 파일은 에이전트가 만든 로그·빌드 결과물일 수 있어 크기가 제한이 없다. 1 MiB 를 넘으면
//! 줄 수를 세지 않고 diff 도 「너무 큼」으로 보여 준다(WIP 목록과 main 대비 변경이 같은 규칙).

use std::io::Read;
use std::path::Path;

/// 새(추적 안 된) 파일은 이 크기까지만 읽어 줄 수를 센다.
pub const UNTRACKED_COUNT_LIMIT: u64 = 1024 * 1024;
/// 이 앞부분에 NUL 바이트가 있으면 바이너리로 본다(git 과 같은 기준).
const BINARY_SNIFF_LEN: usize = 8000;

/// 새 파일 하나를 센 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UntrackedLines {
    /// 줄 수. 모두 추가된 줄이다.
    Text(usize),
    Binary,
    /// `UNTRACKED_COUNT_LIMIT` 보다 커서 읽지 않았다.
    TooLarge,
    /// 파일이 아니거나(폴더 등) 읽지 못했다.
    Unreadable,
}

/// 새 파일의 줄 수. 마지막 줄에 줄바꿈이 없어도 한 줄로 센다.
pub fn untracked_lines(full_path: &Path) -> UntrackedLines {
    let Ok(meta) = std::fs::symlink_metadata(full_path) else {
        return UntrackedLines::Unreadable;
    };
    if meta.file_type().is_symlink() {
        // git 은 링크 대상 경로 한 줄을 내용으로 본다.
        return UntrackedLines::Text(1);
    }
    if !meta.is_file() {
        return UntrackedLines::Unreadable;
    }
    if meta.len() > UNTRACKED_COUNT_LIMIT {
        return UntrackedLines::TooLarge;
    }
    match std::fs::File::open(full_path) {
        Ok(file) => lines_from(file),
        Err(_) => UntrackedLines::Unreadable,
    }
}

/// 읽은 내용의 줄 수. 크기를 본 뒤에도 파일이 자랄 수 있어(에이전트가 쓰는 중인 로그) 한도 + 1 바이트까지만
/// 읽고, 그보다 길면 「너무 큼」이다.
fn lines_from(reader: impl Read) -> UntrackedLines {
    let mut bytes = Vec::new();
    if reader.take(UNTRACKED_COUNT_LIMIT + 1).read_to_end(&mut bytes).is_err() {
        return UntrackedLines::Unreadable;
    }
    if bytes.len() as u64 > UNTRACKED_COUNT_LIMIT {
        return UntrackedLines::TooLarge;
    }
    match count_lines(&bytes) {
        Some(n) => UntrackedLines::Text(n),
        None => UntrackedLines::Binary,
    }
}

/// 바이트열의 줄 수. 바이너리면 `None`.
fn count_lines(bytes: &[u8]) -> Option<usize> {
    if bytes[..bytes.len().min(BINARY_SNIFF_LEN)].contains(&0) {
        return None;
    }
    let newlines = bytes.iter().filter(|b| **b == b'\n').count();
    let trailing = usize::from(bytes.last().is_some_and(|b| *b != b'\n'));
    Some(newlines + trailing)
}

/// 작업 트리 파일이 추적하지 않는 새 파일이고 한도보다 큰가. 파일이 없거나 인덱스에 있으면 `false`.
pub fn is_too_large_untracked(repo: &git2::Repository, rel_path: &str) -> bool {
    let Some(workdir) = repo.workdir() else { return false };
    let in_index = repo
        .index()
        .ok()
        .is_some_and(|index| index.get_path(Path::new(rel_path), 0).is_some());
    !in_index
        && std::fs::symlink_metadata(workdir.join(rel_path))
            .is_ok_and(|m| m.is_file() && m.len() > UNTRACKED_COUNT_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_lines_of_new_content() {
        assert_eq!(count_lines(b""), Some(0));
        assert_eq!(count_lines(b"a\nb\n"), Some(2));
        assert_eq!(count_lines(b"a\nb"), Some(2));
        assert_eq!(count_lines(b"a\0b"), None);
    }

    #[test]
    fn stops_reading_at_the_limit_when_the_file_grew_after_the_size_check() {
        // 끝없는 입력으로 흉내 낸다. 한도 없이 읽으면 멈추지 않는다.
        assert_eq!(lines_from(std::io::repeat(b'x')), UntrackedLines::TooLarge);
        assert_eq!(lines_from(&b"a\nb\n"[..]), UntrackedLines::Text(2));
    }

    #[test]
    fn counts_text_and_refuses_large_or_binary_files() {
        let dir = std::env::temp_dir().join(format!("gitbaro-untracked-lines-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "1\n2\n3").unwrap();
        std::fs::write(dir.join("b.bin"), [0u8, 1, 2]).unwrap();
        std::fs::write(dir.join("big.log"), vec![b'x'; UNTRACKED_COUNT_LIMIT as usize + 1]).unwrap();
        assert_eq!(untracked_lines(&dir.join("a.txt")), UntrackedLines::Text(3));
        assert_eq!(untracked_lines(&dir.join("b.bin")), UntrackedLines::Binary);
        assert_eq!(untracked_lines(&dir.join("big.log")), UntrackedLines::TooLarge);
        assert_eq!(untracked_lines(&dir.join("missing")), UntrackedLines::Unreadable);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
