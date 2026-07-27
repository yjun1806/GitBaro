import { describe, it, expect } from "vitest";
import type { ScanLimit, UncheckedReason } from "@/types";
import {
  UNCHECKED_REASON_ORDER,
  groupLimitsByReason,
  partialRuleIds,
  scopeCounts,
} from "../scan-scope";

function limit(ruleId: string, reason: UncheckedReason, detail: string | null = null): ScanLimit {
  return { ruleId, reason, detail };
}

describe("UNCHECKED_REASON_ORDER", () => {
  it("covers every reason exactly once", () => {
    expect(new Set(UNCHECKED_REASON_ORDER).size).toBe(UNCHECKED_REASON_ORDER.length);
    expect(UNCHECKED_REASON_ORDER).toHaveLength(7);
  });

  it("puts the benign 'nothing of this kind in the change' last", () => {
    expect(UNCHECKED_REASON_ORDER[UNCHECKED_REASON_ORDER.length - 1]).toBe("notApplicable");
  });
});

describe("groupLimitsByReason", () => {
  it("orders groups by how likely each reason is to hide a problem", () => {
    const groups = groupLimitsByReason([
      limit("v1.a", "notApplicable"),
      limit("v2.b", "budgetExceeded"),
      limit("v3.c", "unsupportedLanguage"),
    ]);
    expect(groups.map((g) => g.reason)).toEqual([
      "budgetExceeded",
      "unsupportedLanguage",
      "notApplicable",
    ]);
  });

  it("sorts rules inside a group by id and drops empty groups", () => {
    const groups = groupLimitsByReason([
      limit("v9.z", "notImplemented"),
      limit("v1.a", "notImplemented"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].limits.map((l) => l.ruleId)).toEqual(["v1.a", "v9.z"]);
  });

  it("does not mutate the input array", () => {
    const limits = [limit("v9.z", "disabled"), limit("v1.a", "disabled")];
    groupLimitsByReason(limits);
    expect(limits.map((l) => l.ruleId)).toEqual(["v9.z", "v1.a"]);
  });

  it("returns nothing when every rule ran", () => {
    expect(groupLimitsByReason([])).toEqual([]);
  });
});

describe("partialRuleIds", () => {
  it("finds rules that ran on some targets and were skipped on others", () => {
    expect(partialRuleIds(["v2.a", "v5.b"], ["v5.b", "v7.c"])).toEqual(["v5.b"]);
  });

  it("deduplicates and sorts", () => {
    expect(partialRuleIds(["v5.b", "v5.b", "v2.a"], ["v5.b", "v2.a"])).toEqual(["v2.a", "v5.b"]);
  });

  it("returns nothing when the lists are disjoint", () => {
    expect(partialRuleIds(["v2.a"], ["v7.c"])).toEqual([]);
  });
});

describe("scopeCounts", () => {
  it("splits fully checked from partially checked", () => {
    expect(scopeCounts({ checked: ["v2.a", "v5.b"], unchecked: ["v5.b", "v7.c"] })).toEqual({
      fullyChecked: 1,
      partial: 1,
      unchecked: 2,
    });
  });

  it("reports zero checked when no rule ran", () => {
    expect(scopeCounts({ checked: [], unchecked: ["v7.c"] })).toEqual({
      fullyChecked: 0,
      partial: 0,
      unchecked: 1,
    });
  });
});
