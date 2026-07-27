//! LCOV tracefile parser (V12).
//!
//! Only the records the diff gutter needs are recognised:
//!
//! | Record | Meaning | Used for |
//! |---|---|---|
//! | `SF:<path>` | start of a file section | file key |
//! | `DA:<line>,<hits>[,<checksum>]` | line execution count | covered / uncovered lines |
//! | `BRDA:<line>,<block>,<branch>,<taken\|->` | branch execution | branch counters |
//! | `end_of_record` | end of a file section | — |
//!
//! Everything else (`TN:`, `FN*`, `LF:`, `LH:`, `BRF:`, `BRH:`) is ignored on
//! purpose: unknown records must never make the parser fail (a tool-specific
//! extension is not a reason to hide coverage).

use super::model::{CoverageReport, FileCoverage};

/// Parses an LCOV tracefile. Malformed records are skipped, never fatal —
/// a report with zero files is how the caller learns the parse was useless.
pub fn parse_lcov(text: &str) -> CoverageReport {
    let mut report = CoverageReport::default();
    let mut current: Option<FileCoverage> = None;

    for raw in text.lines() {
        let line = raw.trim();
        if let Some(path) = line.strip_prefix("SF:") {
            if let Some(done) = current.take() {
                report.merge(done);
            }
            let path = path.trim();
            if !path.is_empty() {
                current = Some(FileCoverage::new(path));
            }
        } else if line == "end_of_record" {
            if let Some(done) = current.take() {
                report.merge(done);
            }
        } else if let Some(rest) = line.strip_prefix("DA:") {
            if let Some(file) = current.as_mut() {
                apply_da(file, rest);
            }
        } else if let Some(rest) = line.strip_prefix("BRDA:") {
            if let Some(file) = current.as_mut() {
                apply_brda(file, rest);
            }
        }
    }

    // A tracefile whose last section is missing `end_of_record` still counts.
    if let Some(done) = current.take() {
        report.merge(done);
    }
    report
}

/// `DA:<line>,<hits>` — the optional third field (MD5 checksum) is ignored.
fn apply_da(file: &mut FileCoverage, rest: &str) {
    let mut parts = rest.split(',');
    let (Some(line), Some(hits)) = (parts.next(), parts.next()) else {
        return;
    };
    let (Ok(line), Ok(hits)) = (line.trim().parse::<u32>(), hits.trim().parse::<u64>()) else {
        return;
    };
    if line > 0 {
        file.add_line(line, hits);
    }
}

/// `BRDA:<line>,<block>,<branch>,<taken>` where `taken` is `-` when the
/// enclosing block never executed.
fn apply_brda(file: &mut FileCoverage, rest: &str) {
    let parts: Vec<&str> = rest.split(',').collect();
    if parts.len() < 4 {
        return;
    }
    let Ok(line) = parts[0].trim().parse::<u32>() else {
        return;
    };
    let taken = parts[3].trim();
    let hit = taken
        .parse::<u64>()
        .map(|count| count > 0)
        .unwrap_or(false);
    if line > 0 {
        file.add_branch(line, hit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_single_file_section() {
        let text = "\
TN:
SF:src/lib/utils.ts
FN:3,formatDate
FNDA:2,formatDate
DA:3,2
DA:4,0
DA:7,15
LF:3
LH:2
end_of_record
";
        let report = parse_lcov(text);
        let file = report.files.get("src/lib/utils.ts").expect("file parsed");
        assert_eq!(file.lines.get(&3), Some(&2));
        assert_eq!(file.lines.get(&4), Some(&0));
        assert_eq!(file.lines.get(&7), Some(&15));
        assert_eq!(file.lines.len(), 3);
    }

    #[test]
    fn parses_multiple_sections_and_branch_records() {
        let text = "\
SF:a.ts
DA:1,1
BRDA:1,0,0,1
BRDA:1,0,1,-
end_of_record
SF:b.ts
DA:9,0
end_of_record
";
        let report = parse_lcov(text);
        assert_eq!(report.files.len(), 2);
        let a = report.files.get("a.ts").expect("a.ts");
        assert_eq!(a.branches.get(&1), Some(&(1, 2)));
        assert_eq!(report.files.get("b.ts").expect("b.ts").lines.get(&9), Some(&0));
    }

    #[test]
    fn ignores_malformed_and_unknown_records() {
        let text = "\
SF:a.ts
DA:notanumber,1
DA:5
DA:6,1,ab12cd
BRDA:7,0
WHATEVER:1,2,3
DA:8,0
end_of_record
";
        let report = parse_lcov(text);
        let a = report.files.get("a.ts").expect("a.ts");
        assert_eq!(a.lines.len(), 2);
        assert_eq!(a.lines.get(&6), Some(&1));
        assert_eq!(a.lines.get(&8), Some(&0));
        assert!(a.branches.is_empty());
    }

    #[test]
    fn merges_repeated_sections_for_the_same_file_by_max_hits() {
        let text = "\
SF:a.ts
DA:1,0
end_of_record
SF:a.ts
DA:1,4
DA:2,0
end_of_record
";
        let report = parse_lcov(text);
        let a = report.files.get("a.ts").expect("a.ts");
        assert_eq!(a.lines.get(&1), Some(&4));
        assert_eq!(a.lines.get(&2), Some(&0));
    }

    #[test]
    fn accepts_a_final_section_without_end_of_record() {
        let report = parse_lcov("SF:a.ts\nDA:1,1\n");
        assert_eq!(report.files.get("a.ts").expect("a.ts").lines.get(&1), Some(&1));
    }

    #[test]
    fn empty_input_yields_no_files() {
        assert!(parse_lcov("").files.is_empty());
    }
}
