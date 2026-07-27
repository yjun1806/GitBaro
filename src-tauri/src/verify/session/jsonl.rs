//! Budget-limited streaming JSONL reader (contract §2.12 / spec §7-⑦).
//!
//! Codex session files are known to reach 700 MB–2 GB, so the whole file is
//! never held in memory. Lines are read one at a time through a `BufReader`,
//! oversized lines are dropped (not buffered), and unparseable lines are
//! skipped rather than failing the file.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::Instant;

use serde_json::Value;

use crate::error::AppError;

/// Lines longer than this are skipped without being kept in memory.
pub const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
/// Bytes read past this point are ignored; the summary is marked `truncated`.
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// Hard cap on records folded from a single file.
pub const MAX_RECORDS: usize = 200_000;
/// Wall-clock budget for parsing one file.
pub const MAX_PARSE_MILLIS: u64 = 5_000;
/// The first user prompt is stored truncated to this many chars.
pub const MAX_PROMPT_CHARS: usize = 2_000;
/// Bash commands are stored truncated to this many chars.
pub const MAX_COMMAND_CHARS: usize = 512;
/// Reserved for evidence tails carried alongside session data.
pub const MAX_OUTPUT_TAIL_BYTES: usize = 8 * 1024;

/// Why a streaming scan stopped before EOF.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    /// The whole file was consumed.
    Eof,
    ByteBudget,
    RecordBudget,
    TimeBudget,
}

/// Counters describing how complete a scan was. Callers surface these as
/// `SessionSummary::truncated` / `skipped_records` — never as an error.
#[derive(Clone, Copy, Debug, Default)]
pub struct ScanStats {
    pub records_read: usize,
    /// Lines dropped for being oversized, invalid UTF-8, or invalid JSON.
    pub skipped_records: usize,
    pub bytes_read: u64,
}

impl ScanStats {
    pub fn is_empty(&self) -> bool {
        self.records_read == 0
    }
}

/// Outcome of a streaming scan.
#[derive(Clone, Copy, Debug)]
pub struct ScanOutcome {
    pub stats: ScanStats,
    pub stop: StopReason,
}

impl ScanOutcome {
    /// True when the tail of the file was never observed, so every derived
    /// signal is a partial observation.
    pub fn truncated(&self) -> bool {
        self.stop != StopReason::Eof
    }
}

/// Control returned by the per-record callback.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flow {
    Continue,
    Stop,
}

/// Stream a JSONL file, invoking `on_record` for each successfully parsed line.
///
/// Only opening the file can fail. Oversized lines, invalid UTF-8, malformed
/// JSON and budget exhaustion are all recorded in [`ScanOutcome`] instead of
/// producing an error — a changed or corrupt log degrades to "less data",
/// never to a broken feature (spec §7-⑥).
pub fn stream_records<F>(path: &Path, mut on_record: F) -> Result<ScanOutcome, AppError>
where
    F: FnMut(&Value) -> Flow,
{
    let file = File::open(path).map_err(|e| AppError::SessionParse {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;

    let started = Instant::now();
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut stats = ScanStats::default();
    let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024);
    let mut stop = StopReason::Eof;

    loop {
        buf.clear();
        let read = read_line_capped(&mut reader, &mut buf)?;
        match read {
            LineRead::Eof => break,
            LineRead::Oversized(n) => {
                stats.skipped_records += 1;
                stats.bytes_read = stats.bytes_read.saturating_add(n);
            }
            LineRead::Line(n) => {
                stats.bytes_read = stats.bytes_read.saturating_add(n);
                match parse_line(&buf) {
                    Some(value) => {
                        stats.records_read += 1;
                        if on_record(&value) == Flow::Stop {
                            break;
                        }
                    }
                    None => stats.skipped_records += 1,
                }
            }
        }

        if stats.bytes_read >= MAX_FILE_BYTES {
            stop = StopReason::ByteBudget;
            break;
        }
        if stats.records_read >= MAX_RECORDS {
            stop = StopReason::RecordBudget;
            break;
        }
        if started.elapsed().as_millis() as u64 >= MAX_PARSE_MILLIS {
            stop = StopReason::TimeBudget;
            break;
        }
    }

    if stop != StopReason::Eof {
        // Path and counts only — session logs carry prompts and secrets.
        tracing::debug!(
            "[verify] session scan stopped early ({:?}) after {} records: {}",
            stop,
            stats.records_read,
            path.display()
        );
    }

    Ok(ScanOutcome { stats, stop })
}

enum LineRead {
    Eof,
    Line(u64),
    /// Line exceeded `MAX_LINE_BYTES`; its bytes were drained, not buffered.
    Oversized(u64),
}

/// Read one `\n`-terminated line, giving up on the buffer (but still draining
/// the line from the stream) once it exceeds `MAX_LINE_BYTES`.
fn read_line_capped<R: BufRead>(reader: &mut R, buf: &mut Vec<u8>) -> Result<LineRead, AppError> {
    let mut total: u64 = 0;
    let mut oversized = false;

    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            break;
        }
        match chunk.iter().position(|b| *b == b'\n') {
            Some(idx) => {
                if !oversized && buf.len() + idx <= MAX_LINE_BYTES {
                    buf.extend_from_slice(&chunk[..idx]);
                } else {
                    oversized = true;
                }
                reader.consume(idx + 1);
                total += idx as u64 + 1;
                return Ok(if oversized {
                    LineRead::Oversized(total)
                } else {
                    LineRead::Line(total)
                });
            }
            None => {
                let len = chunk.len();
                if !oversized && buf.len() + len <= MAX_LINE_BYTES {
                    buf.extend_from_slice(chunk);
                } else {
                    oversized = true;
                    buf.clear();
                    buf.shrink_to_fit();
                }
                reader.consume(len);
                total += len as u64;
            }
        }
    }

    if total == 0 {
        Ok(LineRead::Eof)
    } else if oversized {
        Ok(LineRead::Oversized(total))
    } else {
        Ok(LineRead::Line(total))
    }
}

fn parse_line(buf: &[u8]) -> Option<Value> {
    let trimmed = trim_ascii(buf);
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_slice::<Value>(trimmed).ok()
}

fn trim_ascii(buf: &[u8]) -> &[u8] {
    let start = buf.iter().position(|b| !b.is_ascii_whitespace());
    let Some(start) = start else { return &[] };
    let end = buf
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .unwrap_or(start);
    &buf[start..=end]
}

/// Truncate on a char boundary, appending an ellipsis marker when cut.
pub fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::session::test_support::TempDir;

    fn collect(path: &Path) -> (Vec<Value>, ScanOutcome) {
        let mut seen = Vec::new();
        let outcome = stream_records(path, |v| {
            seen.push(v.clone());
            Flow::Continue
        })
        .expect("scan");
        (seen, outcome)
    }

    #[test]
    fn reads_every_valid_record() {
        let dir = TempDir::new();
        let path = dir.write("ok.jsonl", "{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n");
        let (seen, outcome) = collect(&path);
        assert_eq!(seen.len(), 3);
        assert_eq!(outcome.stats.skipped_records, 0);
        assert!(!outcome.truncated());
    }

    #[test]
    fn skips_corrupt_and_blank_lines_without_failing() {
        let dir = TempDir::new();
        // A truncated final line is the normal shape of an append-only log that
        // was still being written when we read it.
        let path = dir.write(
            "mixed.jsonl",
            "{\"a\":1}\n\nnot json at all\n{\"a\":2}\n{\"a\":3",
        );
        let (seen, outcome) = collect(&path);
        assert_eq!(seen.len(), 2, "only the two complete objects parse");
        assert_eq!(outcome.stats.skipped_records, 3, "blank + garbage + partial");
        assert!(!outcome.truncated(), "corrupt lines are not truncation");
    }

    #[test]
    fn skips_oversized_lines_but_keeps_reading() {
        let dir = TempDir::new();
        let huge = format!("{{\"big\":\"{}\"}}", "x".repeat(MAX_LINE_BYTES + 16));
        let body = format!("{{\"a\":1}}\n{}\n{{\"a\":2}}\n", huge);
        let path = dir.write("huge.jsonl", &body);
        let (seen, outcome) = collect(&path);
        assert_eq!(seen.len(), 2, "the oversized record is dropped");
        assert_eq!(outcome.stats.skipped_records, 1);
        assert!(!outcome.truncated());
    }

    #[test]
    fn callback_can_stop_the_scan() {
        let dir = TempDir::new();
        let path = dir.write("stop.jsonl", "{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n");
        let mut count = 0;
        stream_records(&path, |_| {
            count += 1;
            if count == 2 {
                Flow::Stop
            } else {
                Flow::Continue
            }
        })
        .expect("scan");
        assert_eq!(count, 2);
    }

    #[test]
    fn record_budget_stops_the_scan_and_marks_it_truncated() {
        let dir = TempDir::new();
        let mut body = String::with_capacity(MAX_RECORDS * 10);
        for i in 0..MAX_RECORDS + 50 {
            body.push_str(&format!("{{\"a\":{}}}\n", i));
        }
        let path = dir.write("budget.jsonl", &body);
        let (seen, outcome) = collect(&path);
        assert_eq!(outcome.stop, StopReason::RecordBudget);
        assert!(outcome.truncated(), "the tail was never observed");
        assert_eq!(seen.len(), MAX_RECORDS);
    }

    #[test]
    fn missing_file_is_the_only_error() {
        let dir = TempDir::new();
        let err = stream_records(&dir.path().join("nope.jsonl"), |_| Flow::Continue);
        assert!(matches!(err, Err(AppError::SessionParse { .. })));
    }

    #[test]
    fn truncate_chars_respects_char_boundaries() {
        assert_eq!(truncate_chars("abc", 10), "abc");
        assert_eq!(truncate_chars("한국어테스트", 3), "한국어…");
    }
}
