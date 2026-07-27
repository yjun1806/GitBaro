//! Istanbul `coverage-final.json` parser (V12).
//!
//! Shape (only the parts we consume):
//!
//! ```json
//! {
//!   "/abs/path/src/a.ts": {
//!     "path": "/abs/path/src/a.ts",
//!     "statementMap": { "0": { "start": { "line": 3, "column": 2 }, "end": {} } },
//!     "s": { "0": 4 }
//!   }
//! }
//! ```
//!
//! Every unknown field is ignored so that a newer istanbul version cannot break
//! the parser. Function and branch maps are deliberately not read: the diff
//! gutter renders line coverage only.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::model::{CoverageReport, FileCoverage};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IstanbulFile {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    statement_map: BTreeMap<String, Statement>,
    /// Statement id -> execution count.
    #[serde(default)]
    s: BTreeMap<String, u64>,
}

#[derive(Deserialize)]
struct Statement {
    #[serde(default)]
    start: Position,
}

#[derive(Deserialize, Default)]
struct Position {
    #[serde(default)]
    line: Option<u32>,
}

/// Parses an istanbul JSON report. A structurally invalid document is an error
/// (the caller turns it into `ScanLimit { ParseFailed }`, never a finding).
pub fn parse_istanbul(text: &str) -> Result<CoverageReport, serde_json::Error> {
    let raw: BTreeMap<String, IstanbulFile> = serde_json::from_str(text)?;
    let mut report = CoverageReport::default();

    for (key, entry) in raw {
        let path = entry.path.filter(|p| !p.is_empty()).unwrap_or(key);
        let mut file = FileCoverage::new(&path);
        for (id, statement) in &entry.statement_map {
            let Some(line) = statement.start.line else {
                continue;
            };
            if line == 0 {
                continue;
            }
            let hits = entry.s.get(id).copied().unwrap_or(0);
            file.add_line(line, hits);
        }
        report.merge(file);
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "/repo/src/a.ts": {
        "path": "/repo/src/a.ts",
        "statementMap": {
          "0": { "start": { "line": 3, "column": 0 }, "end": { "line": 3, "column": 9 } },
          "1": { "start": { "line": 7, "column": 2 }, "end": { "line": 7, "column": 8 } },
          "2": { "start": { "line": 7, "column": 20 }, "end": { "line": 7, "column": 30 } }
        },
        "s": { "0": 5, "1": 0, "2": 3 },
        "fnMap": {}, "f": {}, "branchMap": {}, "b": {}
      }
    }"#;

    #[test]
    fn maps_statements_onto_lines() {
        let report = parse_istanbul(SAMPLE).expect("parses");
        let file = report.files.get("/repo/src/a.ts").expect("file");
        assert_eq!(file.lines.get(&3), Some(&5));
        // Two statements share line 7; one ran, so the line ran (merge by max).
        assert_eq!(file.lines.get(&7), Some(&3));
    }

    #[test]
    fn uncovered_statements_keep_a_zero_entry() {
        let report = parse_istanbul(
            r#"{ "a.ts": { "statementMap": { "0": { "start": { "line": 2 } } }, "s": { "0": 0 } } }"#,
        )
        .expect("parses");
        assert_eq!(report.files.get("a.ts").expect("file").lines.get(&2), Some(&0));
    }

    #[test]
    fn falls_back_to_the_map_key_when_path_is_absent() {
        let report =
            parse_istanbul(r#"{ "src/b.ts": { "statementMap": {}, "s": {} } }"#).expect("parses");
        assert!(report.files.contains_key("src/b.ts"));
    }

    #[test]
    fn missing_counter_entries_count_as_uncovered() {
        let report =
            parse_istanbul(r#"{ "a.ts": { "statementMap": { "0": { "start": { "line": 4 } } } } }"#)
                .expect("parses");
        assert_eq!(report.files.get("a.ts").expect("file").lines.get(&4), Some(&0));
    }

    #[test]
    fn invalid_json_is_an_error_not_a_silent_empty_report() {
        assert!(parse_istanbul("{ not json").is_err());
    }
}
