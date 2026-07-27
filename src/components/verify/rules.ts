import type { Finding, RuleDescriptor } from "@/types";

/**
 * Rule ids are `v<number>.<camelCaseKind>` — `"v2.testSkipAdded"`. Returns the
 * numeric part so groups sort V2 before V10 instead of lexically.
 */
export function parseVNumber(ruleId: string): number | null {
  const match = /^v(\d+)\./i.exec(ruleId);
  return match ? Number(match[1]) : null;
}

/** V19~V27 read the agent session log; V30 correlates a session to commits. */
const SESSION_V_NUMBERS = new Set([19, 20, 21, 22, 23, 24, 25, 26, 27, 30]);

export type FindingScope = "file" | "commit" | "session";

/**
 * Where a finding belongs. Findings with an empty `file` are not anchored to a
 * line, so the UI must label them instead of offering a jump.
 */
export function findingScope(finding: Finding): FindingScope {
  if (finding.file !== "") return "file";
  const vNumber = parseVNumber(finding.ruleId);
  return vNumber !== null && SESSION_V_NUMBERS.has(vNumber) ? "session" : "commit";
}

export interface RuleStatusCounts {
  /** Implemented and turned on. */
  active: number;
  /** Implemented but turned off by the user — reported as not checked. */
  disabled: number;
  /** Registered but not implemented — always reported as not checked. */
  planned: number;
}

export function countRuleStatuses(rules: readonly RuleDescriptor[]): RuleStatusCounts {
  return rules.reduce<RuleStatusCounts>(
    (acc, rule) => ({
      active: acc.active + (rule.status === "implemented" && rule.enabled ? 1 : 0),
      disabled: acc.disabled + (rule.status === "implemented" && !rule.enabled ? 1 : 0),
      planned: acc.planned + (rule.status === "planned" ? 1 : 0),
    }),
    { active: 0, disabled: 0, planned: 0 },
  );
}
