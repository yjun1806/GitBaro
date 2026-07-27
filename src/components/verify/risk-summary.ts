// One-line risk summary (IA decision §2.2–§2.6).
//
// Turns a `VerificationReport` into *data* that says why a commit is worth
// looking at. Data, not markup: this module returns i18n keys and numbers, and
// the component calls `t()`. That is what makes it testable, and the ranking is
// the part that decides what the user reads first, so it is the part that gets
// tests.

import type { Severity, VerificationReport } from "@/types";
import { severityRank } from "./severity";
import { ruleImportance } from "./rule-weights";

/** The minimum a summary needs. Commit and session reports share this shape. */
export type RiskSummaryInput = Pick<VerificationReport, "findings" | "unchecked">;

export interface RiskSummaryClause {
  ruleId: string;
  severity: Severity;
  /** Findings grouped under this rule. Interpolated into the phrase. */
  count: number;
  /** `verify.summary.clause.<ruleId>` — interpolates `{{count}}`. */
  i18nKey: string;
}

export interface RiskSummary {
  /** Highest severity across all findings. `null` means no rule flagged
   *  anything — which is never the same as "safe". */
  severity: Severity | null;
  /** Ranked, 0–2 clauses. Empty means render `zeroKey`. */
  clauses: RiskSummaryClause[];
  /** **Findings** left out of `clauses` — not rules. */
  overflowCount: number;
  /** Rules that never ran. Rendered **always**, findings or not (§7-①). */
  uncheckedCount: number;
  /** The only zero-finding phrase there is. No "passed" key exists. */
  zeroKey: "verify.summary.noSignal" | null;
}

/** Three clauses stop being a sentence and start being a list. */
export const MAX_CLAUSES = 2;

const CLAUSE_KEY_PREFIX = "verify.summary.clause.";

interface RuleGroup {
  ruleId: string;
  severity: Severity;
  count: number;
}

/**
 * Groups findings by `ruleId`, keeping the **highest** severity seen for that
 * rule — the backend can escalate one rule to different severities within a
 * single report.
 */
function groupByRule(findings: RiskSummaryInput["findings"]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  for (const finding of findings) {
    const existing = groups.get(finding.ruleId);
    groups.set(
      finding.ruleId,
      existing
        ? {
            ruleId: finding.ruleId,
            severity:
              severityRank(finding.severity) > severityRank(existing.severity)
                ? finding.severity
                : existing.severity,
            count: existing.count + 1,
          }
        : { ruleId: finding.ruleId, severity: finding.severity, count: 1 },
    );
  }
  return Array.from(groups.values());
}

/**
 * Total order, so the same report always produces the same sentence:
 * severity desc → importance desc → count desc → ruleId asc.
 *
 * Severity is compared first on purpose. Importance only reorders rules that
 * already sit in the same band — one `danger` always beats a hundred `info`s.
 * That is P6 ("spend attention in proportion to risk") expressed mechanically.
 */
function compareGroups(a: RuleGroup, b: RuleGroup): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    ruleImportance(b.ruleId) - ruleImportance(a.ruleId) ||
    b.count - a.count ||
    a.ruleId.localeCompare(b.ruleId)
  );
}

/**
 * Folds a commit report (and optionally the session report behind it) into a
 * one-line risk summary.
 *
 * Pure — no i18n, no clock, no DOM. With a `session` the two finding lists are
 * pooled and `unchecked` is counted as the **union of rule ids**, so a rule
 * both reports gave up on is not counted twice.
 */
export function summarizeRisk(
  commit: RiskSummaryInput,
  session?: RiskSummaryInput | null,
): RiskSummary {
  const findings = session ? [...commit.findings, ...session.findings] : commit.findings;
  const uncheckedCount = new Set(
    session ? [...commit.unchecked, ...session.unchecked] : commit.unchecked,
  ).size;

  const ranked = groupByRule(findings).sort(compareGroups);
  const top = ranked.slice(0, MAX_CLAUSES);
  const shown = top.reduce((sum, group) => sum + group.count, 0);

  return {
    severity: ranked.length > 0 ? ranked[0].severity : null,
    clauses: top.map((group) => ({
      ruleId: group.ruleId,
      severity: group.severity,
      count: group.count,
      i18nKey: `${CLAUSE_KEY_PREFIX}${group.ruleId}`,
    })),
    overflowCount: findings.length - shown,
    uncheckedCount,
    zeroKey: ranked.length === 0 ? "verify.summary.noSignal" : null,
  };
}

/** Narrow shape of i18next's `t`, injected so this module stays dependency-free. */
export type RiskSummaryTranslate = (key: string, options?: { count: number }) => string;

/**
 * Renders a `RiskSummary` as the single line every surface shows:
 *
 * ```
 * [clause 1] · [clause 2] · [+N more] · [not checked M]
 * ```
 *
 * The unchecked count is appended unconditionally and is never truncated — it
 * is the last line of defence for §7-①, where an empty finding list must never
 * read as "safe".
 */
export function formatRiskSummary(
  summary: RiskSummary,
  t: RiskSummaryTranslate,
): string {
  if (summary.zeroKey !== null) {
    return t(summary.zeroKey, { count: summary.uncheckedCount });
  }

  const parts = summary.clauses.map((clause) =>
    t(clause.i18nKey, { count: clause.count }),
  );
  if (summary.overflowCount > 0) {
    parts.push(t("verify.summary.more", { count: summary.overflowCount }));
  }
  parts.push(t("verify.badge.unchecked", { count: summary.uncheckedCount }));
  return parts.join(" · ");
}
