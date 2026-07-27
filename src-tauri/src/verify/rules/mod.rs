// SPDX-License-Identifier: GPL-3.0-or-later
//! Static diff rule engine — the deterministic half of the verify subsystem.
//!
//! A [`DiffContext`] goes in; a [`VerificationReport`] comes out. No git2, no
//! network, no LLM: every signal is a literal token match on a parsed unified
//! diff, so the whole module is unit-testable from inline fixtures.
//!
//! Registering a rule means adding one row to [`DIFF_RULES`]. The runner owns
//! the on/off filtering and the `checked` / `unchecked` bookkeeping so that an
//! individual rule cannot forget it (contract §7-① / §7-②).

pub mod bypass;
pub mod context;
pub mod deletion;
pub mod patterns;
pub mod scope;
pub mod test_disabling;
pub mod test_quality;
pub mod unified;

use crate::verify::config::RuleConfig;
use crate::verify::registry::{registry, RuleStatus};
use crate::verify::types::{FindingKind, ScanLimit, UncheckedReason, VerificationReport};

pub use context::{
    context_from_diff, context_from_unified, ChangeKind, ChangedLine, CommitContext, DiffContext,
    FileChange, FileScope, Language, RuleOutcome,
};
pub use unified::parse_unified_diff;

pub type DiffRuleFn = fn(&DiffContext) -> RuleOutcome;

/// One registered rule: the kinds it may emit and the function that emits them.
struct DiffRule {
    kinds: &'static [FindingKind],
    run: DiffRuleFn,
}

const DIFF_RULES: &[DiffRule] = &[
    DiffRule {
        kinds: test_disabling::KINDS,
        run: test_disabling::run,
    },
    DiffRule {
        kinds: test_quality::KINDS,
        run: test_quality::run,
    },
    DiffRule {
        kinds: bypass::KINDS,
        run: bypass::run,
    },
    DiffRule {
        kinds: scope::KINDS,
        run: scope::run,
    },
    DiffRule {
        kinds: deletion::KINDS,
        run: deletion::run,
    },
];

/// Run every enabled static rule and assemble the report.
///
/// The returned report always covers the whole registry: a rule is either in
/// `checked`, in `unchecked` with a reason, or in both when it ran on some
/// files and skipped others.
pub fn run_diff_rules(ctx: &DiffContext, config: &RuleConfig) -> VerificationReport {
    let mut findings = Vec::new();
    let mut checked: Vec<String> = Vec::new();
    let mut limits: Vec<ScanLimit> = Vec::new();

    for rule in DIFF_RULES {
        let enabled: Vec<&'static str> = rule
            .kinds
            .iter()
            .map(|kind| kind.rule_id())
            .filter(|id| config.is_enabled(id))
            .collect();

        for kind in rule.kinds {
            let id = kind.rule_id();
            if !enabled.contains(&id) {
                limits.push(ScanLimit {
                    rule_id: id.to_string(),
                    reason: UncheckedReason::Disabled,
                    detail: None,
                });
            }
        }
        if enabled.is_empty() {
            continue;
        }

        let outcome = (rule.run)(ctx);
        findings.extend(
            outcome
                .findings
                .into_iter()
                .filter(|f| enabled.contains(&f.rule_id.as_str())),
        );
        checked.extend(
            outcome
                .checked
                .into_iter()
                .filter(|id| enabled.contains(&id.as_str())),
        );
        limits.extend(
            outcome
                .limits
                .into_iter()
                .filter(|l| enabled.contains(&l.rule_id.as_str())),
        );
    }

    tracing::debug!(
        "[verify] static diff scan: {} file(s), {} finding(s)",
        ctx.files.len(),
        findings.len()
    );

    finish_report(
        RuleOutcome {
            findings,
            limits,
            checked,
        },
        config,
        "staticDiff",
    )
}

/// Close a raw [`RuleOutcome`] into a report that accounts for the whole
/// registry (contract §2.3).
///
/// The static engine is not the only scan that produces findings — the syntax
/// scan (V1 · V7 · V8 · V9 · V17) has its own collectors — and every one of them
/// owes the report the same accounting. `scan_label` is a stable token naming
/// the scan, carried in the `NotApplicable` detail so a reader can tell *which*
/// pass skipped the rule. It is an identifier, not prose — the UI translates it.
pub fn finish_report(
    outcome: RuleOutcome,
    config: &RuleConfig,
    scan_label: &str,
) -> VerificationReport {
    let RuleOutcome {
        findings,
        mut limits,
        mut checked,
    } = outcome;

    checked.sort();
    checked.dedup();
    fill_registry_coverage(&checked, &mut limits, config, scan_label);

    VerificationReport::new(findings, checked, limits)
}

/// Give every registry entry an account of itself. Without this, a rule owned by
/// another subsystem (session, coverage, dependencies) would silently vanish
/// from the report and an empty `findings` list would read as "all clear".
fn fill_registry_coverage(
    checked: &[String],
    limits: &mut Vec<ScanLimit>,
    config: &RuleConfig,
    scan_label: &str,
) {
    for entry in registry() {
        if checked.iter().any(|id| id == entry.id)
            || limits.iter().any(|limit| limit.rule_id == entry.id)
        {
            continue;
        }
        // `detail` is a stable token, never prose: the frontend owns the wording
        // and the translations. `NotImplemented` needs none — the reason says it.
        let (reason, detail) = if entry.status == RuleStatus::Planned {
            (UncheckedReason::NotImplemented, None)
        } else if !config.is_enabled(entry.id) {
            (UncheckedReason::Disabled, None)
        } else {
            (
                UncheckedReason::NotApplicable,
                Some(scan_label.to_string()),
            )
        };
        limits.push(ScanLimit {
            rule_id: entry.id.to_string(),
            reason,
            detail,
        });
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::path::Path;

    use super::*;
    use crate::verify::types::Severity;

    /// Every rule forced on, so a test exercises the rule and not the default.
    fn all_enabled() -> RuleConfig {
        let mut config = RuleConfig::default();
        for entry in registry() {
            config.enabled.insert(entry.id.to_string(), true);
        }
        config
    }

    fn report(diff: &str, config: &RuleConfig) -> VerificationReport {
        let ctx = context_from_unified(Path::new("/repo"), diff, None, None);
        run_diff_rules(&ctx, config)
    }

    /// Contract §2.3: the registry must be fully accounted for, always.
    fn assert_registry_is_covered(report: &VerificationReport) {
        let covered: BTreeSet<&str> = report
            .checked
            .iter()
            .chain(report.unchecked.iter())
            .map(String::as_str)
            .collect();
        for entry in registry() {
            assert!(
                covered.contains(entry.id),
                "rule {} appears in neither checked nor unchecked",
                entry.id
            );
        }
        let from_limits: BTreeSet<String> = report
            .limits
            .iter()
            .map(|limit| limit.rule_id.clone())
            .collect();
        assert_eq!(
            report.unchecked,
            from_limits.into_iter().collect::<Vec<_>>(),
            "unchecked must be the deduplicated, sorted set of limit rule_ids"
        );
    }

    #[test]
    fn empty_diff_still_covers_the_whole_registry() {
        let report = report("", &all_enabled());
        assert!(report.findings.is_empty());
        assert_registry_is_covered(&report);
    }

    #[test]
    fn default_config_covers_the_whole_registry() {
        let report = report(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,2 @@
 const a = 1;
+  it.skip(\"x\", () => {});
",
            &RuleConfig::default(),
        );
        assert_registry_is_covered(&report);
        assert!(report
            .findings
            .iter()
            .any(|f| f.rule_id == "v2.testSkipAdded"));
    }

    #[test]
    fn disabled_rule_yields_no_findings_and_a_disabled_limit() {
        let mut config = all_enabled();
        config.enabled.insert("v2.testSkipAdded".to_string(), false);

        let report = report(
            "\
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,1 +1,2 @@
 const a = 1;
+  it.skip(\"x\", () => {});
",
            &config,
        );

        assert!(report
            .findings
            .iter()
            .all(|f| f.rule_id != "v2.testSkipAdded"));
        assert!(report
            .limits
            .iter()
            .any(|limit| limit.rule_id == "v2.testSkipAdded"
                && limit.reason == UncheckedReason::Disabled));
        assert!(!report.checked.contains(&"v2.testSkipAdded".to_string()));
        assert_registry_is_covered(&report);
    }

    #[test]
    fn a_mixed_diff_reports_several_rules_at_once() {
        let report = report(
            "\
diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,3 @@
-export function fetchUser() {}
-  } catch (e) { report(e); }
+// @ts-ignore
+const internal = 1;
diff --git a/src/api.test.ts b/src/api.test.ts
deleted file mode 100644
--- a/src/api.test.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-it(\"works\", () => {
-  expect(fetchUser()).toEqual({});
",
            &all_enabled(),
        );

        let ids: BTreeSet<&str> = report.findings.iter().map(|f| f.rule_id.as_str()).collect();
        assert!(ids.contains("v2.testFileDeleted"));
        assert!(ids.contains("v5.verificationBypassed"));
        assert!(ids.contains("v10.publicExportDeleted"));
        assert_registry_is_covered(&report);
    }

    #[test]
    fn findings_are_sorted_by_descending_severity() {
        let report = report(
            "\
diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,2 +1,2 @@
-export function fetchUser() {}
+// @ts-ignore
 const a = 1;
diff --git a/src/api.test.ts b/src/api.test.ts
deleted file mode 100644
--- a/src/api.test.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-it(\"works\", () => {});
",
            &all_enabled(),
        );
        let severities: Vec<Severity> = report.findings.iter().map(|f| f.severity).collect();
        assert_eq!(severities[0], Severity::Danger);
        assert!(severities.windows(2).all(|w| w[0] >= w[1]));
    }

    #[test]
    fn unsupported_language_only_diff_checks_nothing_but_confesses_it() {
        let report = report(
            "\
diff --git a/main.py b/main.py
--- a/main.py
+++ b/main.py
@@ -1,1 +1,2 @@
 a = 1
+b = 2  # type: ignore
",
            &all_enabled(),
        );
        assert!(report.findings.is_empty());
        assert!(report
            .unchecked
            .iter()
            .any(|id| id == "v5.verificationBypassed"));
        assert!(report
            .limits
            .iter()
            .any(|limit| limit.reason == UncheckedReason::UnsupportedLanguage
                && limit.rule_id == "v5.verificationBypassed"));
        assert_registry_is_covered(&report);
    }
}
