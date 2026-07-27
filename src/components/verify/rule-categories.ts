import type { RuleDescriptor } from "@/types";
import { parseVNumber } from "./rules";

/**
 * Rule ids carry a `v<number>` prefix that traces back to the internal spec.
 * That number is an implementation detail: it is a stable key for i18n, for the
 * per-rule toggle and for sorting, and it must never reach the screen. What the
 * user sees is a category named after the thing that actually went wrong.
 */
export type RuleCategoryId =
  | "hookBypass"
  | "suppression"
  | "testRemoval"
  | "testQuality"
  | "dependency"
  | "scopeAndDeletion"
  | "codebaseContext"
  | "agentSession"
  | "execution"
  | "reviewTools"
  | "other";

/**
 * Display order. Roughly "how directly does this tell me someone skipped a
 * safeguard" — bypasses first, supporting evidence last.
 */
export const RULE_CATEGORY_ORDER: readonly RuleCategoryId[] = [
  "hookBypass",
  "suppression",
  "testRemoval",
  "testQuality",
  "dependency",
  "scopeAndDeletion",
  "codebaseContext",
  "agentSession",
  "execution",
  "reviewTools",
  "other",
];

/**
 * V number → category. Kept as a lookup rather than a range check so adding a
 * rule to an existing V number needs no change here, while a brand-new V number
 * falls to `other` and trips `everyRegistryRuleHasACategory` in the tests.
 *
 * Note V5 and V21 are deliberately NOT in the same category. Both are
 * "verification was skipped", but they are different events: V5 is a suppression
 * comment left in the code and visible in the diff; V21 is a hook that never ran
 * at all, leaving no trace in the code and detectable only from the session log.
 * Grouping them would hide that difference.
 */
const CATEGORY_BY_V_NUMBER: Readonly<Record<number, RuleCategoryId>> = {
  21: "hookBypass",
  5: "suppression",
  2: "testRemoval",
  3: "testQuality",
  4: "dependency",
  6: "scopeAndDeletion",
  10: "scopeAndDeletion",
  16: "scopeAndDeletion",
  31: "scopeAndDeletion",
  32: "scopeAndDeletion",
  35: "scopeAndDeletion",
  1: "codebaseContext",
  7: "codebaseContext",
  8: "codebaseContext",
  9: "codebaseContext",
  17: "codebaseContext",
  19: "agentSession",
  20: "agentSession",
  22: "agentSession",
  23: "agentSession",
  24: "agentSession",
  25: "agentSession",
  26: "agentSession",
  27: "agentSession",
  28: "agentSession",
  11: "execution",
  12: "execution",
  15: "execution",
  18: "reviewTools",
  36: "reviewTools",
};

export function ruleCategory(ruleId: string): RuleCategoryId {
  const vNumber = parseVNumber(ruleId);
  if (vNumber === null) return "other";
  return CATEGORY_BY_V_NUMBER[vNumber] ?? "other";
}

export interface RuleCategoryGroup {
  id: RuleCategoryId;
  /** `verify.category.<id>.title` */
  titleKey: string;
  /** `verify.category.<id>.subtitle` — one line of what and why, always shown. */
  subtitleKey: string;
  rules: RuleDescriptor[];
}

/**
 * Groups rules into user-facing categories, in {@link RULE_CATEGORY_ORDER}.
 * Empty categories are dropped; rules inside a group sort by id so the order is
 * stable across reloads.
 */
export function groupRulesByCategory(
  rules: readonly RuleDescriptor[],
): RuleCategoryGroup[] {
  const grouped = new Map<RuleCategoryId, RuleDescriptor[]>();
  for (const rule of rules) {
    const id = ruleCategory(rule.ruleId);
    const existing = grouped.get(id);
    grouped.set(id, existing ? [...existing, rule] : [rule]);
  }

  return RULE_CATEGORY_ORDER.flatMap((id) => {
    const groupRules = grouped.get(id);
    if (groupRules === undefined || groupRules.length === 0) return [];
    return [
      {
        id,
        titleKey: `verify.category.${id}.title`,
        subtitleKey: `verify.category.${id}.subtitle`,
        rules: [...groupRules].sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
      },
    ];
  });
}
