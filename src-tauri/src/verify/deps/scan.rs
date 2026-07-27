//! Accumulator for a V4 scan.
//!
//! It exists so the *accounting* — which rules ran, which did not, and why —
//! cannot be forgotten while writing the interesting part. Contract §9-① names
//! exactly that as the likeliest way this subsystem goes wrong: a rule that
//! reports findings but never populates `checked`/`limits` makes an empty
//! report read as "safe", which is worse than no tool at all (spec §7-①).

use std::collections::BTreeSet;

use crate::verify::config::RuleConfig;
use crate::verify::registry::{registry, RuleStatus};
use crate::verify::types::{
    Finding, FindingKind, ScanLimit, UncheckedReason, VerificationReport,
};

/// `Finding::detail` is capped by the contract; cap it at the source too.
const MAX_DETAIL_CHARS: usize = 512;

/// Which of the two V4 rules the user left on (contract §7-②: both default OFF).
#[derive(Clone, Copy)]
pub(super) struct EnabledRules {
    pub hallucinated: bool,
    pub suspicious: bool,
}

impl EnabledRules {
    pub fn from_config(config: &RuleConfig) -> Self {
        EnabledRules {
            hallucinated: config.is_enabled(FindingKind::HallucinatedDependency.rule_id()),
            suspicious: config.is_enabled(FindingKind::SuspiciousNewDependency.rule_id()),
        }
    }

    fn allows(&self, kind: FindingKind) -> bool {
        match kind {
            FindingKind::HallucinatedDependency => self.hallucinated,
            _ => self.suspicious,
        }
    }

    pub fn active_ids(&self) -> Vec<&'static str> {
        let mut ids = Vec::new();
        if self.hallucinated {
            ids.push(FindingKind::HallucinatedDependency.rule_id());
        }
        if self.suspicious {
            ids.push(FindingKind::SuspiciousNewDependency.rule_id());
        }
        ids
    }
}

/// A newly added npm package worth a registry lookup, if the user opts in.
#[derive(Clone, Debug)]
pub(super) struct Candidate {
    pub package: String,
    pub file: String,
    pub line: Option<u32>,
}

pub(super) struct OfflineScan {
    pub rules: EnabledRules,
    pub npm_candidates: Vec<Candidate>,
    findings: Vec<Finding>,
    checked: BTreeSet<String>,
    limits: Vec<ScanLimit>,
    seen_limits: BTreeSet<(String, String)>,
    /// `(rule_id, package)` already reported — keeps the registry pass from
    /// repeating what the lockfile already proved.
    flagged: BTreeSet<(String, String)>,
}

impl OfflineScan {
    pub fn new(rules: EnabledRules) -> Self {
        OfflineScan {
            rules,
            npm_candidates: Vec::new(),
            findings: Vec::new(),
            checked: BTreeSet::new(),
            limits: Vec::new(),
            seen_limits: BTreeSet::new(),
            flagged: BTreeSet::new(),
        }
    }

    /// Record that the active rules actually evaluated something. Call it at
    /// the point of evaluation, not on entry — a rule that bailed for a missing
    /// lockfile did not run.
    pub fn mark_checked(&mut self) {
        for id in self.rules.active_ids() {
            self.checked.insert(id.to_string());
        }
    }

    pub fn limit_all(&mut self, reason: UncheckedReason, detail: impl Into<String>) {
        let detail = detail.into();
        for id in self.rules.active_ids() {
            self.limit(id, reason, detail.clone());
        }
    }

    pub fn limit(&mut self, rule_id: &str, reason: UncheckedReason, detail: impl Into<String>) {
        let detail = truncate(&detail.into(), MAX_DETAIL_CHARS);
        if self.seen_limits.insert((rule_id.to_string(), detail.clone())) {
            self.limits.push(ScanLimit {
                rule_id: rule_id.to_string(),
                reason,
                detail: Some(detail),
            });
        }
    }

    /// Add a finding unless the rule is off or the same package was already
    /// reported under the same rule.
    pub fn add(
        &mut self,
        kind: FindingKind,
        package: &str,
        file: &str,
        line: Option<u32>,
        message: String,
        detail: Option<String>,
    ) {
        if !self.rules.allows(kind) {
            return;
        }
        if !self
            .flagged
            .insert((kind.rule_id().to_string(), package.to_string()))
        {
            return;
        }
        let mut finding = Finding::new(kind, file, message);
        if let Some(line) = line {
            finding = finding.at_line(line);
        }
        if let Some(detail) = detail {
            finding = finding.with_detail(truncate(&detail, MAX_DETAIL_CHARS));
        }
        self.findings.push(finding);
    }

    pub fn into_report(self) -> VerificationReport {
        let OfflineScan {
            findings,
            checked,
            mut limits,
            ..
        } = self;
        let checked: Vec<String> = checked.into_iter().collect();
        cover_registry(&checked, &mut limits);
        VerificationReport::new(findings, checked, limits)
    }
}

/// Every registry rule must land in `checked` or `unchecked` (contract §2.3).
/// A dependency scan runs two rules, so the rest are explicitly *not looked at*
/// rather than silently absent — that distinction is the whole point of §7-①.
fn cover_registry(checked: &[String], limits: &mut Vec<ScanLimit>) {
    let mut covered: BTreeSet<&str> = checked.iter().map(String::as_str).collect();
    covered.extend(limits.iter().map(|limit| limit.rule_id.as_str()));

    let missing: Vec<(&'static str, UncheckedReason)> = registry()
        .iter()
        .filter(|entry| !covered.contains(entry.id))
        .map(|entry| {
            let reason = match entry.status {
                RuleStatus::Planned => UncheckedReason::NotImplemented,
                RuleStatus::Implemented => UncheckedReason::NotApplicable,
            };
            (entry.id, reason)
        })
        .collect();

    for (id, reason) in missing {
        limits.push(ScanLimit {
            rule_id: id.to_string(),
            reason,
            detail: Some("outside the dependency scan".to_string()),
        });
    }
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    text.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_on() -> EnabledRules {
        EnabledRules {
            hallucinated: true,
            suspicious: true,
        }
    }

    #[test]
    fn the_same_package_is_reported_once_per_rule() {
        let mut scan = OfflineScan::new(all_on());
        for line in 1..=3 {
            scan.add(
                FindingKind::HallucinatedDependency,
                "ghost",
                "src/a.ts",
                Some(line),
                "imported but absent".to_string(),
                None,
            );
        }
        assert_eq!(scan.findings.len(), 1);
        assert_eq!(scan.findings[0].line, Some(1));
    }

    #[test]
    fn disabled_rules_swallow_their_findings() {
        let mut scan = OfflineScan::new(EnabledRules {
            hallucinated: false,
            suspicious: true,
        });
        scan.add(
            FindingKind::HallucinatedDependency,
            "ghost",
            "src/a.ts",
            None,
            "message".to_string(),
            None,
        );
        scan.add(
            FindingKind::SuspiciousNewDependency,
            "ghost",
            "src/a.ts",
            None,
            "message".to_string(),
            None,
        );
        assert_eq!(scan.findings.len(), 1);
        assert_eq!(
            scan.findings[0].kind,
            FindingKind::SuspiciousNewDependency
        );
    }

    #[test]
    fn identical_limits_are_not_repeated() {
        let mut scan = OfflineScan::new(all_on());
        scan.limit_all(UncheckedReason::MissingArtifact, "no npm lockfile found");
        scan.limit_all(UncheckedReason::MissingArtifact, "no npm lockfile found");
        assert_eq!(scan.limits.len(), 2, "one per active rule, not four");
    }

    #[test]
    fn details_are_capped_at_the_contract_limit() {
        let mut scan = OfflineScan::new(all_on());
        scan.add(
            FindingKind::HallucinatedDependency,
            "ghost",
            "src/a.ts",
            None,
            "message".to_string(),
            Some("x".repeat(MAX_DETAIL_CHARS + 100)),
        );
        let detail = scan.findings[0].detail.as_ref().expect("detail");
        assert_eq!(detail.chars().count(), MAX_DETAIL_CHARS);
    }

    #[test]
    fn a_report_that_found_nothing_still_accounts_for_every_rule() {
        let report = OfflineScan::new(all_on()).into_report();
        let covered: BTreeSet<&str> = report
            .checked
            .iter()
            .chain(report.unchecked.iter())
            .map(String::as_str)
            .collect();
        for entry in registry() {
            assert!(covered.contains(entry.id), "{} unaccounted for", entry.id);
        }
    }
}
