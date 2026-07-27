import type { ScanLimit, UncheckedReason, VerificationReport } from "@/types";

/**
 * Reasons a rule did not run, ordered by how likely each is to be hiding a
 * real problem. `notApplicable` ("nothing of this kind in the change") is the
 * only benign one, so it goes last.
 */
export const UNCHECKED_REASON_ORDER: readonly UncheckedReason[] = [
  "budgetExceeded",
  "parseFailed",
  "missingArtifact",
  "unsupportedLanguage",
  "notImplemented",
  "disabled",
  "notApplicable",
];

export interface UncheckedGroup {
  reason: UncheckedReason;
  limits: ScanLimit[];
}

/** Groups in `UNCHECKED_REASON_ORDER`; rules inside a group sorted by id. */
export function groupLimitsByReason(limits: readonly ScanLimit[]): UncheckedGroup[] {
  return UNCHECKED_REASON_ORDER.map((reason) => ({
    reason,
    limits: limits
      .filter((limit) => limit.reason === reason)
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
  })).filter((group) => group.limits.length > 0);
}

/**
 * A rule may sit in `checked` *and* `unchecked` at once — it ran on the TS
 * files and gave up on the Python ones. The contract calls that a partial
 * scan, and a partial scan is not a pass.
 */
export function partialRuleIds(
  checked: readonly string[],
  unchecked: readonly string[],
): string[] {
  const uncheckedSet = new Set(unchecked);
  return Array.from(new Set(checked))
    .filter((ruleId) => uncheckedSet.has(ruleId))
    .sort();
}

export interface ScopeCounts {
  /** Rules that ran on every target they had. */
  fullyChecked: number;
  /** Rules that ran on some targets and skipped others. */
  partial: number;
  /** Rules with at least one target they could not look at. */
  unchecked: number;
}

export function scopeCounts(
  report: Pick<VerificationReport, "checked" | "unchecked">,
): ScopeCounts {
  const partial = partialRuleIds(report.checked, report.unchecked).length;
  return {
    fullyChecked: new Set(report.checked).size - partial,
    partial,
    unchecked: new Set(report.unchecked).size,
  };
}
