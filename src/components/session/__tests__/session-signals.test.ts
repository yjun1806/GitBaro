import { describe, expect, it } from "vitest";
import {
  durationParts,
  editRiskWeight,
  isPartialObservation,
  knownBasis,
  linkPresentation,
  readLessEdits,
  sessionDurationMs,
  sortEditsByRisk,
} from "@/components/session/session-signals";
import type { FileEditSummary, SessionSummary } from "@/types";

function makeEdit(path: string, overrides: Partial<FileEditSummary> = {}): FileEditSummary {
  return {
    path,
    editCount: 1,
    firstEditAt: 1_700_000_000_000,
    lastEditAt: 1_700_000_060_000,
    wasReadFirst: true,
    afterCompaction: false,
    bySubagent: false,
    viaBash: false,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "0d1f",
    source: "claudeCode",
    filePath: "/Users/x/.claude/projects/repo/0d1f.jsonl",
    cwd: "/Users/x/repo",
    gitBranch: "main",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_900_000,
    firstUserPrompt: "Fix the flaky auth test",
    filesRead: ["src/auth.ts"],
    filesEdited: [],
    bashCommands: [],
    compactionBoundaries: [],
    injectedRulesDigest: null,
    truncated: false,
    skippedRecords: 0,
    ...overrides,
  };
}

describe("linkPresentation", () => {
  it("states a high-confidence link as fact", () => {
    expect(linkPresentation("high")).toBe("fact");
  });

  it("hedges a medium-confidence link as an estimate", () => {
    expect(linkPresentation("medium")).toBe("estimate");
  });

  it("hides a low-confidence link entirely — misattribution is worse than none", () => {
    expect(linkPresentation("low")).toBe("hidden");
  });

  it("never presents anything below high as fact", () => {
    const belowHigh = (["medium", "low"] as const).map(linkPresentation);
    expect(belowHigh).not.toContain("fact");
  });
});

describe("knownBasis", () => {
  it("keeps the four documented basis tokens", () => {
    expect(knownBasis(["cwd", "branch", "timeWindow", "fileOverlap"])).toEqual([
      "cwd",
      "branch",
      "timeWindow",
      "fileOverlap",
    ]);
  });

  it("drops unknown tokens instead of rendering a raw i18n key", () => {
    expect(knownBasis(["cwd", "someFutureHeuristic"])).toEqual(["cwd"]);
  });
});

describe("readLessEdits", () => {
  it("returns files edited without a preceding read", () => {
    const summary = makeSummary({
      filesEdited: [
        makeEdit("src/auth.ts", { wasReadFirst: true }),
        makeEdit("src/session.ts", { wasReadFirst: false }),
      ],
    });

    expect(readLessEdits(summary).map((e) => e.path)).toEqual(["src/session.ts"]);
  });

  it("still flags a file that was only read after it was edited", () => {
    // The path appears in filesRead, but the read came after the first edit,
    // which is exactly what wasReadFirst=false encodes.
    const summary = makeSummary({
      filesRead: ["src/session.ts"],
      filesEdited: [makeEdit("src/session.ts", { wasReadFirst: false })],
    });

    expect(readLessEdits(summary)).toHaveLength(1);
  });

  it("returns an empty list when every edit was read first", () => {
    const summary = makeSummary({
      filesEdited: [makeEdit("a.ts"), makeEdit("b.ts")],
    });

    expect(readLessEdits(summary)).toEqual([]);
  });
});

describe("sessionDurationMs", () => {
  it("measures the wall-clock span", () => {
    expect(sessionDurationMs(makeSummary())).toBe(900_000);
  });

  it("clamps a backwards span to zero", () => {
    const summary = makeSummary({ startedAt: 2_000, endedAt: 1_000 });
    expect(sessionDurationMs(summary)).toBe(0);
  });
});

describe("durationParts", () => {
  it("reports sub-minute spans without a number", () => {
    expect(durationParts(45_000)).toEqual({ unit: "underMinute", value: 0 });
  });

  it("reports minutes below an hour", () => {
    expect(durationParts(15 * 60_000)).toEqual({ unit: "minutes", value: 15 });
  });

  it("reports whole hours from an hour up", () => {
    expect(durationParts(150 * 60_000)).toEqual({ unit: "hours", value: 2 });
  });
});

describe("isPartialObservation", () => {
  it("is false for a fully parsed log", () => {
    expect(isPartialObservation(makeSummary())).toBe(false);
  });

  it("is true when the parse budget cut the log short", () => {
    expect(isPartialObservation(makeSummary({ truncated: true }))).toBe(true);
  });

  it("is true when any record was skipped", () => {
    expect(isPartialObservation(makeSummary({ skippedRecords: 3 }))).toBe(true);
  });
});

describe("editRiskWeight", () => {
  it("ranks an unread edit above a read one with the same churn", () => {
    const unread = makeEdit("a.ts", { wasReadFirst: false });
    const read = makeEdit("b.ts", { wasReadFirst: true });
    expect(editRiskWeight(unread)).toBeGreaterThan(editRiskWeight(read));
  });

  it("counts bash and subagent edits, which /rewind and the main context missed", () => {
    const plain = makeEdit("a.ts");
    expect(editRiskWeight(makeEdit("a.ts", { viaBash: true }))).toBeGreaterThan(
      editRiskWeight(plain),
    );
    expect(editRiskWeight(makeEdit("a.ts", { bySubagent: true }))).toBeGreaterThan(
      editRiskWeight(plain),
    );
    expect(editRiskWeight(makeEdit("a.ts", { afterCompaction: true }))).toBeGreaterThan(
      editRiskWeight(plain),
    );
  });

  it("caps churn so one thrashed file cannot bury every other signal", () => {
    expect(editRiskWeight(makeEdit("a.ts", { editCount: 50 }))).toBe(
      editRiskWeight(makeEdit("a.ts", { editCount: 10 })),
    );
  });
});

describe("sortEditsByRisk", () => {
  it("puts the files a human has least likely seen first", () => {
    const edits = [
      makeEdit("read.ts", { editCount: 2 }),
      makeEdit("subagent.ts", { bySubagent: true }),
      makeEdit("unread.ts", { wasReadFirst: false, viaBash: true }),
    ];

    expect(sortEditsByRisk(edits).map((e) => e.path)).toEqual([
      "unread.ts",
      "subagent.ts",
      "read.ts",
    ]);
  });

  it("breaks ties by path so the order does not shuffle between renders", () => {
    const edits = [makeEdit("b.ts"), makeEdit("a.ts")];
    expect(sortEditsByRisk(edits).map((e) => e.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("does not mutate the input", () => {
    const edits = [makeEdit("b.ts"), makeEdit("a.ts", { wasReadFirst: false })];
    sortEditsByRisk(edits);
    expect(edits.map((e) => e.path)).toEqual(["b.ts", "a.ts"]);
  });
});
