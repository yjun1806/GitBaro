//! Child-process execution for V11 test-run evidence.
//!
//! **Security constraints** (verify contract §3.4):
//!
//! - The command string is executed through `/bin/sh -c` because test commands
//!   legitimately need shell syntax (`pnpm test -- --run`). It must therefore
//!   originate from user settings only — never from a session log, commit
//!   message or diff.
//! - `current_dir` is the caller-validated repository path.
//! - Only the last [`MAX_OUTPUT_TAIL_BYTES`] of interleaved stdout+stderr are
//!   kept, and the body is never written to `tracing` (test output can contain
//!   tokens).
//! - The caller supplies the timeout; on expiry the child is killed and the run
//!   is recorded as failed. A timeout is evidence too.

use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;

use crate::error::AppError;

/// Contract default: 10 minutes.
pub const DEFAULT_TEST_TIMEOUT: Duration = Duration::from_secs(600);

const MAX_OUTPUT_TAIL_BYTES: usize = 8 * 1024;
const MAX_PROGRESS_LINE_CHARS: usize = 2_048;
/// Per-line memory ceiling. Output without newlines (a dumped blob) must not be
/// able to grow the buffer without limit; the excess is drained and discarded.
const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug)]
pub struct ProcessOutcome {
    pub exit_code: Option<i32>,
    pub passed: bool,
    pub duration_ms: u64,
    pub output_tail: String,
    pub timed_out: bool,
}

/// Runs `command` in `repo_path`, streaming every output line to `on_line` and
/// keeping a bounded tail. Returns `Err` only when the process could not be
/// spawned or waited on — a failing or timing-out test suite is a successful
/// observation, not an error.
pub async fn execute<F>(
    repo_path: &Path,
    command: &str,
    timeout: Duration,
    on_line: F,
) -> Result<ProcessOutcome, AppError>
where
    F: Fn(&str) + Send,
{
    let started = Instant::now();
    let mut child = Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .current_dir(repo_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    // Shared so the tail survives a timeout, which drops the reader futures.
    let tail = Mutex::new(TailBuffer::new(MAX_OUTPUT_TAIL_BYTES));

    let waited = tokio::time::timeout(timeout, async {
        let (status, (), ()) = tokio::join!(
            child.wait(),
            drain(stdout, &tail, &on_line),
            drain(stderr, &tail, &on_line),
        );
        status
    })
    .await;

    let duration_ms = started.elapsed().as_millis() as u64;

    match waited {
        Ok(status) => {
            let status = status?;
            Ok(ProcessOutcome {
                exit_code: status.code(),
                passed: status.success(),
                duration_ms,
                output_tail: render(&tail),
                timed_out: false,
            })
        }
        Err(_) => {
            let _ = child.kill().await;
            let notice = format!(
                "[gitbaro] test command timed out after {}s and was terminated",
                timeout.as_secs()
            );
            on_line(&notice);
            push(&tail, &notice);
            tracing::warn!("[verify] test command timed out after {}s", timeout.as_secs());
            Ok(ProcessOutcome {
                exit_code: None,
                passed: false,
                duration_ms,
                output_tail: render(&tail),
                timed_out: true,
            })
        }
    }
}

async fn drain<R, F>(reader: Option<R>, tail: &Mutex<TailBuffer>, on_line: &F)
where
    R: AsyncRead + Unpin,
    F: Fn(&str),
{
    let Some(reader) = reader else {
        return;
    };
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        // A read error ends the stream; the exit status still decides pass/fail.
        match read_bounded_line(&mut reader, &mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(strip_eol(&buffer));
        on_line(clip_chars(&line, MAX_PROGRESS_LINE_CHARS));
        push(tail, &line);
    }
}

/// Reads up to and including the next `\n`, keeping at most [`MAX_LINE_BYTES`]
/// in `out` while still consuming the rest of the line. Returns the number of
/// bytes consumed from the stream; `0` means EOF.
async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    out: &mut Vec<u8>,
) -> std::io::Result<usize> {
    let mut consumed = 0usize;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(consumed);
        }
        let (chunk, advance, done) = match available.iter().position(|&byte| byte == b'\n') {
            Some(index) => (&available[..index], index + 1, true),
            None => (available, available.len(), false),
        };
        let room = MAX_LINE_BYTES.saturating_sub(out.len());
        if room > 0 {
            out.extend_from_slice(&chunk[..room.min(chunk.len())]);
        }
        reader.consume(advance);
        consumed += advance;
        if done {
            return Ok(consumed);
        }
    }
}

fn strip_eol(bytes: &[u8]) -> &[u8] {
    match bytes.last() {
        Some(b'\r') => &bytes[..bytes.len() - 1],
        _ => bytes,
    }
}

fn push(tail: &Mutex<TailBuffer>, line: &str) {
    if let Ok(mut buffer) = tail.lock() {
        buffer.push(line);
    }
}

fn render(tail: &Mutex<TailBuffer>) -> String {
    tail.lock().map(|buffer| buffer.render()).unwrap_or_default()
}

/// Truncates to `max` characters on a char boundary.
fn clip_chars(text: &str, max: usize) -> &str {
    match text.char_indices().nth(max) {
        Some((index, _)) => &text[..index],
        None => text,
    }
}

/// Keeps the last `max` bytes of a line, snapping forward to a char boundary.
fn keep_tail_bytes(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut start = text.len() - max;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

/// Line-granular ring buffer bounded by total bytes.
#[derive(Debug)]
struct TailBuffer {
    lines: VecDeque<String>,
    bytes: usize,
    max: usize,
}

impl TailBuffer {
    fn new(max: usize) -> Self {
        Self {
            lines: VecDeque::new(),
            bytes: 0,
            max: max.max(1),
        }
    }

    fn push(&mut self, line: &str) {
        let kept = keep_tail_bytes(line, self.max);
        self.bytes += kept.len() + 1;
        self.lines.push_back(kept.to_string());
        while self.bytes > self.max && self.lines.len() > 1 {
            if let Some(dropped) = self.lines.pop_front() {
                self.bytes -= dropped.len() + 1;
            }
        }
    }

    fn render(&self) -> String {
        self.lines
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_the_most_recent_lines_within_budget() {
        let mut tail = TailBuffer::new(16);
        for line in ["aaaa", "bbbb", "cccc", "dddd"] {
            tail.push(line);
        }
        let rendered = tail.render();
        assert!(rendered.ends_with("dddd"));
        assert!(!rendered.contains("aaaa"));
        assert!(rendered.len() <= 16);
    }

    #[test]
    fn tail_keeps_the_end_of_an_oversized_single_line() {
        let mut tail = TailBuffer::new(8);
        tail.push("0123456789abcdef");
        assert_eq!(tail.render(), "89abcdef");
    }

    #[test]
    fn tail_never_splits_a_multibyte_character() {
        let mut tail = TailBuffer::new(7);
        // Each Hangul syllable is 3 bytes.
        tail.push("가나다라");
        let rendered = tail.render();
        assert!(rendered.len() <= 7);
        assert!("가나다라".ends_with(&rendered));
    }

    #[test]
    fn tail_of_an_empty_run_is_empty() {
        assert_eq!(TailBuffer::new(64).render(), "");
    }

    #[test]
    fn progress_lines_are_clipped_on_char_boundaries() {
        assert_eq!(clip_chars("abcdef", 3), "abc");
        assert_eq!(clip_chars("abc", 10), "abc");
        assert_eq!(clip_chars("가나다", 2), "가나");
    }

    #[test]
    fn strips_a_trailing_carriage_return() {
        assert_eq!(strip_eol(b"ok\r"), b"ok");
        assert_eq!(strip_eol(b"ok"), b"ok");
        assert_eq!(strip_eol(b""), b"");
    }

    /// `&[u8]` implements `AsyncRead`, so the reader can be exercised without a
    /// child process.
    async fn collect(source: &[u8]) -> Vec<String> {
        let seen = Mutex::new(Vec::new());
        let tail = Mutex::new(TailBuffer::new(MAX_OUTPUT_TAIL_BYTES));
        drain(Some(source), &tail, &|line: &str| {
            seen.lock().expect("lock").push(line.to_string())
        })
        .await;
        seen.into_inner().expect("into_inner")
    }

    #[tokio::test]
    async fn splits_output_into_lines_including_a_missing_final_newline() {
        assert_eq!(collect(b"a\nb\nc").await, vec!["a", "b", "c"]);
        assert_eq!(collect(b"a\r\nb\n").await, vec!["a", "b"]);
        assert!(collect(b"").await.is_empty());
    }

    #[tokio::test]
    async fn a_line_without_a_newline_cannot_grow_past_the_ceiling() {
        let blob = vec![b'x'; MAX_LINE_BYTES + 4096];
        let seen = Mutex::new(Vec::new());
        let tail = Mutex::new(TailBuffer::new(MAX_OUTPUT_TAIL_BYTES));
        drain(Some(&blob[..]), &tail, &|line: &str| {
            seen.lock().expect("lock").push(line.len())
        })
        .await;
        let lengths = seen.into_inner().expect("into_inner");
        assert_eq!(lengths, vec![MAX_PROGRESS_LINE_CHARS]);
        assert!(render(&tail).len() <= MAX_OUTPUT_TAIL_BYTES);
    }
}
