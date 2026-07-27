//! Parsed-coverage model shared by the LCOV and istanbul parsers (V12).
//!
//! Internal only — never serialized. Paths are kept exactly as the report
//! spelled them; normalisation happens at lookup time because only the caller
//! knows the repository root.

use std::collections::BTreeMap;

#[derive(Clone, Debug, Default)]
pub struct CoverageReport {
    pub files: BTreeMap<String, FileCoverage>,
}

#[derive(Clone, Debug, Default)]
pub struct FileCoverage {
    pub path: String,
    /// 1-based line -> execution count. Merged by max: if any statement on the
    /// line ran, the line ran.
    pub lines: BTreeMap<u32, u64>,
    /// 1-based line -> (branches taken, branches total), from LCOV `BRDA`.
    /// Parsed and tested, but not projected onto `DiffCoverage` — the wire type
    /// has no branch field yet.
    pub branches: BTreeMap<u32, (u32, u32)>,
}

impl FileCoverage {
    pub fn new(path: &str) -> Self {
        Self {
            path: path.to_string(),
            lines: BTreeMap::new(),
            branches: BTreeMap::new(),
        }
    }

    pub fn add_line(&mut self, line: u32, hits: u64) {
        let entry = self.lines.entry(line).or_insert(0);
        *entry = (*entry).max(hits);
    }

    pub fn add_branch(&mut self, line: u32, taken: bool) {
        let entry = self.branches.entry(line).or_insert((0, 0));
        entry.1 += 1;
        if taken {
            entry.0 += 1;
        }
    }
}

impl CoverageReport {
    /// Folds a file section into the report, merging with an existing section
    /// for the same path (tools emit one section per test suite).
    pub fn merge(&mut self, file: FileCoverage) {
        match self.files.get_mut(&file.path) {
            Some(existing) => {
                for (line, hits) in file.lines {
                    existing.add_line(line, hits);
                }
                for (line, (taken, total)) in file.branches {
                    let entry = existing.branches.entry(line).or_insert((0, 0));
                    entry.0 = entry.0.max(taken);
                    entry.1 = entry.1.max(total);
                }
            }
            None => {
                self.files.insert(file.path.clone(), file);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_hits_merge_by_max() {
        let mut file = FileCoverage::new("a.ts");
        file.add_line(1, 0);
        file.add_line(1, 3);
        file.add_line(1, 1);
        assert_eq!(file.lines.get(&1), Some(&3));
    }

    #[test]
    fn branch_counters_accumulate_taken_and_total() {
        let mut file = FileCoverage::new("a.ts");
        file.add_branch(2, true);
        file.add_branch(2, false);
        file.add_branch(2, false);
        assert_eq!(file.branches.get(&2), Some(&(1, 3)));
    }

    #[test]
    fn merging_two_sections_keeps_the_best_of_each() {
        let mut report = CoverageReport::default();
        let mut first = FileCoverage::new("a.ts");
        first.add_line(1, 0);
        first.add_line(2, 5);
        report.merge(first);

        let mut second = FileCoverage::new("a.ts");
        second.add_line(1, 2);
        second.add_line(3, 0);
        report.merge(second);

        let merged = report.files.get("a.ts").expect("a.ts");
        assert_eq!(merged.lines.get(&1), Some(&2));
        assert_eq!(merged.lines.get(&2), Some(&5));
        assert_eq!(merged.lines.get(&3), Some(&0));
        assert_eq!(report.files.len(), 1);
    }
}
