import { describe, it, expect } from "vitest";
import type { Finding, FindingKind, Severity } from "@/types";
import {
  MAX_CLAUSES,
  formatRiskSummary,
  summarizeRisk,
  type RiskSummaryInput,
} from "../risk-summary";

function finding(
  ruleId: string,
  severity: Severity,
  overrides: Partial<Finding> = {},
): Finding {
  return {
    kind: ruleId.split(".")[1] as FindingKind,
    severity,
    file: "src/a.ts",
    line: 1,
    message: "evidence",
    detail: null,
    ruleId,
    ...overrides,
  };
}

function report(findings: Finding[], unchecked: string[] = []): RiskSummaryInput {
  return { findings, unchecked };
}

/** Renders keys verbatim so tests assert composition, not translations. */
const t = (key: string, options?: { count: number }) =>
  options ? `${key}(${options.count})` : key;

describe("summarizeRisk — severity ordering", () => {
  it("puts a single danger ahead of a hundred infos", () => {
    const infos = Array.from({ length: 100 }, () => finding("v19.readLessEdit", "info"));
    const summary = summarizeRisk(report([...infos, finding("v2.testFileDeleted", "danger")]));

    expect(summary.severity).toBe("danger");
    expect(summary.clauses[0].ruleId).toBe("v2.testFileDeleted");
    expect(summary.clauses[1].ruleId).toBe("v19.readLessEdit");
  });

  it("reports the highest severity a rule reached when the backend escalated it", () => {
    const summary = summarizeRisk(
      report([
        finding("v5.verificationBypassed", "warn"),
        finding("v5.verificationBypassed", "danger"),
      ]),
    );

    expect(summary.clauses[0].severity).toBe("danger");
    expect(summary.clauses[0].count).toBe(2);
    expect(summary.severity).toBe("danger");
  });
});

describe("summarizeRisk — tie-breaks", () => {
  it("uses the importance weight inside one severity band", () => {
    const summary = summarizeRisk(
      report([finding("v1.structuralDiff", "info"), finding("v19.readLessEdit", "info")]),
    );

    expect(summary.clauses.map((c) => c.ruleId)).toEqual([
      "v19.readLessEdit",
      "v1.structuralDiff",
    ]);
  });

  it("never lets count beat the weight", () => {
    const structural = Array.from({ length: 9 }, () =>
      finding("v1.structuralDiff", "info"),
    );
    const summary = summarizeRisk(
      report([...structural, finding("v19.readLessEdit", "info")]),
    );

    expect(summary.clauses[0].ruleId).toBe("v19.readLessEdit");
  });

  it("falls back to count, then to the rule id, for equally weighted rules", () => {
    // Both unknown to the weight table, so both weigh 0.
    const summary = summarizeRisk(
      report([
        finding("v98.bbb", "warn"),
        finding("v99.aaa", "warn"),
        finding("v99.aaa", "warn"),
      ]),
    );
    expect(summary.clauses.map((c) => c.ruleId)).toEqual(["v99.aaa", "v98.bbb"]);

    const tied = summarizeRisk(report([finding("v99.aaa", "warn"), finding("v98.bbb", "warn")]));
    expect(tied.clauses.map((c) => c.ruleId)).toEqual(["v98.bbb", "v99.aaa"]);
  });

  it("is stable regardless of the order findings arrive in", () => {
    const findings = [
      finding("v19.readLessEdit", "info"),
      finding("v2.testSkipAdded", "warn"),
      finding("v21.hookBypassCommand", "danger"),
    ];
    const forward = summarizeRisk(report(findings)).clauses.map((c) => c.ruleId);
    const reversed = summarizeRisk(report([...findings].reverse())).clauses.map(
      (c) => c.ruleId,
    );

    expect(forward).toEqual(reversed);
  });
});

describe("summarizeRisk — truncation and overflow", () => {
  it("keeps at most two clauses", () => {
    const summary = summarizeRisk(
      report([
        finding("v21.hookBypassCommand", "danger"),
        finding("v2.testSkipAdded", "warn"),
        finding("v19.readLessEdit", "info"),
      ]),
    );

    expect(summary.clauses).toHaveLength(MAX_CLAUSES);
    expect(summary.overflowCount).toBe(1);
  });

  it("counts overflow in findings, not in rules", () => {
    const summary = summarizeRisk(
      report([
        finding("v21.hookBypassCommand", "danger"),
        finding("v2.testSkipAdded", "warn"),
        finding("v19.readLessEdit", "info"),
        finding("v23.subagentEdit", "info"),
        finding("v23.subagentEdit", "info"),
      ]),
    );

    // Two rules left out, but four findings.
    expect(summary.overflowCount).toBe(3);
  });

  it("reports no overflow when everything fits", () => {
    const summary = summarizeRisk(
      report([finding("v2.testSkipAdded", "warn"), finding("v2.testSkipAdded", "warn")]),
    );

    expect(summary.clauses).toHaveLength(1);
    expect(summary.clauses[0].count).toBe(2);
    expect(summary.overflowCount).toBe(0);
  });
});

describe("summarizeRisk — zero findings", () => {
  it("says 'no signal' plus the unchecked count, never 'safe'", () => {
    const summary = summarizeRisk(report([], ["v3.noAssertionTest", "v15.mutationScore"]));

    expect(summary.severity).toBeNull();
    expect(summary.clauses).toEqual([]);
    expect(summary.overflowCount).toBe(0);
    expect(summary.uncheckedCount).toBe(2);
    expect(summary.zeroKey).toBe("verify.summary.noSignal");
  });

  it("drops the zero key as soon as a finding exists", () => {
    expect(summarizeRisk(report([finding("v1.structuralDiff", "info")])).zeroKey).toBeNull();
  });
});

describe("summarizeRisk — merged session findings", () => {
  const commit = report(
    [finding("v2.testSkipAdded", "warn"), finding("v2.testSkipAdded", "warn")],
    ["v3.noAssertionTest", "v12.uncoveredNewLines"],
  );
  const session = report(
    [
      finding("v20.testFailureThenTestEdited", "danger", { file: "" }),
      finding("v19.readLessEdit", "info", { file: "" }),
    ],
    ["v12.uncoveredNewLines", "v25.repeatedEdit"],
  );

  it("pools findings from both reports", () => {
    const summary = summarizeRisk(commit, session);

    expect(summary.severity).toBe("danger");
    expect(summary.clauses.map((c) => c.ruleId)).toEqual([
      "v20.testFailureThenTestEdited",
      "v2.testSkipAdded",
    ]);
    expect(summary.clauses[1].count).toBe(2);
    expect(summary.overflowCount).toBe(1);
  });

  it("counts unchecked rules as a union so overlap is not double-counted", () => {
    expect(summarizeRisk(commit, session).uncheckedCount).toBe(3);
  });

  it("treats null and undefined session reports as commit-only", () => {
    expect(summarizeRisk(commit, null)).toEqual(summarizeRisk(commit));
  });
});

describe("formatRiskSummary", () => {
  it("joins clauses with ' · ' and always ends with the unchecked count", () => {
    const summary = summarizeRisk(
      report(
        [
          finding("v2.testSkipAdded", "warn"),
          finding("v2.testSkipAdded", "warn"),
          finding("v2.testSkipAdded", "warn"),
          finding("v19.readLessEdit", "info"),
          finding("v19.readLessEdit", "info"),
        ],
        ["v15.mutationScore"],
      ),
    );

    expect(formatRiskSummary(summary, t)).toBe(
      "verify.summary.clause.v2.testSkipAdded(3) · verify.summary.clause.v19.readLessEdit(2) · verify.badge.unchecked(1)",
    );
  });

  it("appends the overflow clause before the unchecked count", () => {
    const summary = summarizeRisk(
      report([
        finding("v21.hookBypassCommand", "danger"),
        finding("v2.testSkipAdded", "warn"),
        finding("v19.readLessEdit", "info"),
      ]),
    );

    expect(formatRiskSummary(summary, t)).toContain("verify.summary.more(1)");
    expect(formatRiskSummary(summary, t).endsWith("verify.badge.unchecked(0)")).toBe(true);
  });

  it("renders the zero case as the no-signal phrase alone", () => {
    const summary = summarizeRisk(report([], ["v15.mutationScore", "v16.claimMismatch"]));

    expect(formatRiskSummary(summary, t)).toBe("verify.summary.noSignal(2)");
  });
});
