import { describe, it, expect } from "vitest";
import type { Finding } from "@/types";
import { buildFileRisk, sortByRisk } from "../risk-sort";

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

describe("buildFileRisk", () => {
  it("counts findings per file", () => {
    const risk = buildFileRisk([
      finding({ file: "src/a.ts", severity: "danger" }),
      finding({ file: "src/a.ts", severity: "warn" }),
      finding({ file: "src/b.ts", severity: "info" }),
    ]);
    expect(risk.get("src/a.ts")).toEqual({ danger: 1, warn: 1, info: 0, total: 2 });
    expect(risk.get("src/b.ts")).toEqual({ danger: 0, warn: 0, info: 1, total: 1 });
  });

  it("ignores commit- and session-level findings", () => {
    const risk = buildFileRisk([finding({ file: "", ruleId: "v31.tangledCommit" })]);
    expect(risk.size).toBe(0);
  });
});

describe("sortByRisk", () => {
  const files = [
    { path: "src/a.ts" },
    { path: "src/b.ts" },
    { path: "src/c.ts" },
    { path: "src/d.ts" },
  ];
  const pathOf = (file: { path: string }) => file.path;

  it("puts danger files first, then warn, then info, then the rest", () => {
    const risk = buildFileRisk([
      finding({ file: "src/b.ts", severity: "info" }),
      finding({ file: "src/c.ts", severity: "danger" }),
      finding({ file: "src/d.ts", severity: "warn" }),
    ]);
    expect(sortByRisk(files, pathOf, risk).map(pathOf)).toEqual([
      "src/c.ts",
      "src/d.ts",
      "src/b.ts",
      "src/a.ts",
    ]);
  });

  it("breaks ties on the higher count before falling back to the original order", () => {
    const risk = buildFileRisk([
      finding({ file: "src/a.ts", severity: "danger" }),
      finding({ file: "src/b.ts", severity: "danger" }),
      finding({ file: "src/b.ts", severity: "danger" }),
    ]);
    expect(sortByRisk(files, pathOf, risk).map(pathOf)).toEqual([
      "src/b.ts",
      "src/a.ts",
      "src/c.ts",
      "src/d.ts",
    ]);
  });

  it("is stable, so turning the sort off restores the caller's ordering", () => {
    const risk = buildFileRisk([
      finding({ file: "src/a.ts", severity: "warn" }),
      finding({ file: "src/c.ts", severity: "warn" }),
    ]);
    expect(sortByRisk(files, pathOf, risk).map(pathOf)).toEqual([
      "src/a.ts",
      "src/c.ts",
      "src/b.ts",
      "src/d.ts",
    ]);
  });

  it("keeps every file — risk sorting reorders, it never hides", () => {
    const risk = buildFileRisk([finding({ file: "src/d.ts", severity: "danger" })]);
    expect(sortByRisk(files, pathOf, risk)).toHaveLength(files.length);
  });

  it("does not mutate the input array", () => {
    const risk = buildFileRisk([finding({ file: "src/d.ts", severity: "danger" })]);
    sortByRisk(files, pathOf, risk);
    expect(files.map(pathOf)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
  });

  it("returns the original order when nothing was flagged", () => {
    expect(sortByRisk(files, pathOf, new Map()).map(pathOf)).toEqual(files.map(pathOf));
  });
});
