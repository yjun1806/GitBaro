import { describe, it, expect } from "vitest";
import type { CommitVerificationSummary, Finding, Severity } from "@/types";
import {
  EMPTY_COUNTS,
  countBySeverity,
  countsFromSummary,
  groupBySeverity,
  groupFindingsByFile,
  severityRank,
  topSeverity,
} from "../severity";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    kind: "testSkipAdded",
    severity: "warn",
    file: "src/a.ts",
    line: 1,
    message: "it.skip added",
    detail: null,
    ruleId: "v2.testSkipAdded",
    ...overrides,
  };
}

describe("severityRank", () => {
  it("orders danger above warn above info", () => {
    expect(severityRank("danger")).toBeGreaterThan(severityRank("warn"));
    expect(severityRank("warn")).toBeGreaterThan(severityRank("info"));
  });
});

describe("countBySeverity", () => {
  it("counts each severity and the total", () => {
    const counts = countBySeverity([
      finding({ severity: "danger" }),
      finding({ severity: "danger" }),
      finding({ severity: "warn" }),
      finding({ severity: "info" }),
    ]);
    expect(counts).toEqual({ danger: 2, warn: 1, info: 1, total: 4 });
  });

  it("returns zeroes for an empty list without mutating the shared constant", () => {
    expect(countBySeverity([])).toEqual(EMPTY_COUNTS);
    countBySeverity([finding({ severity: "danger" })]);
    expect(EMPTY_COUNTS).toEqual({ danger: 0, warn: 0, info: 0, total: 0 });
  });
});

describe("countsFromSummary", () => {
  it("maps a history badge summary onto the same shape", () => {
    const summary: CommitVerificationSummary = {
      commitId: "abc",
      maxSeverity: "danger",
      dangerCount: 1,
      warnCount: 2,
      infoCount: 3,
      uncheckedCount: 9,
    };
    expect(countsFromSummary(summary)).toEqual({ danger: 1, warn: 2, info: 3, total: 6 });
  });
});

describe("topSeverity", () => {
  it("returns the highest severity present", () => {
    expect(topSeverity({ danger: 0, warn: 1, info: 5, total: 6 })).toBe<Severity>("warn");
    expect(topSeverity({ danger: 1, warn: 0, info: 0, total: 1 })).toBe<Severity>("danger");
  });

  it("returns null when nothing was flagged — never a 'safe' value", () => {
    expect(topSeverity(EMPTY_COUNTS)).toBeNull();
  });
});

describe("groupBySeverity", () => {
  it("groups danger → warn → info and drops empty groups", () => {
    const groups = groupBySeverity([
      finding({ severity: "info" }),
      finding({ severity: "danger" }),
      finding({ severity: "info" }),
    ]);
    expect(groups.map((g) => g.severity)).toEqual(["danger", "info"]);
    expect(groups[1].findings).toHaveLength(2);
  });

  it("preserves the backend's ordering inside a group", () => {
    const first = finding({ severity: "warn", file: "src/a.ts", line: 1 });
    const second = finding({ severity: "warn", file: "src/b.ts", line: 2 });
    const groups = groupBySeverity([first, second]);
    expect(groups[0].findings).toEqual([first, second]);
  });

  it("returns nothing for an empty report", () => {
    expect(groupBySeverity([])).toEqual([]);
  });
});

describe("groupFindingsByFile", () => {
  it("keys findings by path", () => {
    const grouped = groupFindingsByFile([
      finding({ file: "src/a.ts" }),
      finding({ file: "src/b.ts" }),
      finding({ file: "src/a.ts" }),
    ]);
    expect(grouped.get("src/a.ts")).toHaveLength(2);
    expect(grouped.get("src/b.ts")).toHaveLength(1);
  });

  it("drops commit- and session-level findings, which belong to no file row", () => {
    const grouped = groupFindingsByFile([
      finding({ file: "", ruleId: "v31.tangledCommit" }),
      finding({ file: "src/a.ts" }),
    ]);
    expect(grouped.has("")).toBe(false);
    expect(grouped.size).toBe(1);
  });
});
