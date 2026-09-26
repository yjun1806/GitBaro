import { describe, expect, it } from "vitest";
import type { WipFile } from "@/types";
import { justChangedPaths } from "../useJustChanged";

const file = (path: string, modifiedAt: number | null): WipFile => ({
  path,
  origPath: null,
  status: "modified",
  staged: false,
  unstaged: true,
  modifiedAt,
  insertions: 1,
  deletions: 0,
});

describe("justChangedPaths", () => {
  const prev = new Map<string, number | null>([
    ["a.ts", 100],
    ["b.ts", 90],
    ["gone.ts", null],
  ]);

  it("returns files whose modification time moved forward", () => {
    expect(justChangedPaths(prev, [file("a.ts", 130), file("b.ts", 90)])).toEqual(["a.ts"]);
  });

  it("returns files that were not in the previous list", () => {
    expect(justChangedPaths(prev, [file("c.ts", 120), file("a.ts", 100)])).toEqual(["c.ts"]);
  });

  it("counts a file whose time was unknown before and is known now", () => {
    expect(justChangedPaths(prev, [file("gone.ts", 140)])).toEqual(["gone.ts"]);
  });

  it("skips deleted files (no time) and files with the same or an older time", () => {
    expect(justChangedPaths(prev, [file("a.ts", 100), file("b.ts", 80), file("d.ts", null)])).toEqual([]);
  });

  it("keeps the list order when several files changed", () => {
    expect(justChangedPaths(prev, [file("b.ts", 200), file("a.ts", 150)])).toEqual(["b.ts", "a.ts"]);
  });
});
