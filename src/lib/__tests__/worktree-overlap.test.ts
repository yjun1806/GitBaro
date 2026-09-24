import { describe, expect, it } from "vitest";
import {
  changedLineRanges,
  compareLineRanges,
  findSameFileWorktrees,
  formatRanges,
  intersectRanges,
  mergeRanges,
} from "@/lib/worktree-overlap";
import type { DiffHunk, DiffLine } from "@/types";

const ctx = (o: number, n: number): DiffLine => ({ content: "", lineType: "context", oldLineNo: o, newLineNo: n });
const add = (n: number): DiffLine => ({ content: "", lineType: "add", oldLineNo: null, newLineNo: n });
const del = (o: number): DiffLine => ({ content: "", lineType: "delete", oldLineNo: o, newLineNo: null });

function hunk(newStart: number, lines: DiffLine[]): DiffHunk {
  return { oldStart: newStart, oldLines: 0, newStart, newLines: 0, header: "", lines };
}

function diff(...hunks: DiffHunk[]) {
  return { hunks, binary: false };
}

describe("findSameFileWorktrees", () => {
  const siblings = [
    { path: "/w/app-a", branch: "feat/a", files: ["src/x.ts", "src/y.ts"] },
    { path: "/w/app-b", branch: null, files: ["src/x.ts", "README.md"] },
  ];

  it("reports only files that another worktree also changes, with every such worktree", () => {
    const result = findSameFileWorktrees(["src/x.ts", "src/y.ts", "src/z.ts"], siblings);
    expect([...result.keys()].sort()).toEqual(["src/x.ts", "src/y.ts"]);
    expect(result.get("src/x.ts")).toEqual([
      { path: "/w/app-a", branch: "feat/a" },
      { path: "/w/app-b", branch: null },
    ]);
    expect(result.get("src/y.ts")).toEqual([{ path: "/w/app-a", branch: "feat/a" }]);
    expect(result.has("src/z.ts")).toBe(false);
  });

  it("compares whole paths only: same name in another folder is not the same file", () => {
    const result = findSameFileWorktrees(["lib/x.ts", "src/X.ts"], siblings);
    expect(result.size).toBe(0);
  });

  it("returns nothing with no siblings or no files, and lists a worktree once per file", () => {
    expect(findSameFileWorktrees(["src/x.ts"], []).size).toBe(0);
    expect(findSameFileWorktrees([], siblings).size).toBe(0);
    const dup = findSameFileWorktrees(["a"], [{ path: "/w/c", branch: "c", files: ["a", "a"] }]);
    expect(dup.get("a")).toHaveLength(1);
  });
});

describe("changedLineRanges", () => {
  it("groups added lines into ranges on the new side", () => {
    const d = diff(
      hunk(61, [ctx(61, 61), add(62), add(63), ctx(62, 64), add(65)]),
      hunk(112, [add(112), add(113), ctx(110, 114)]),
    );
    // 62–63 and 65 are one line apart, so they stay separate; 65 touches nothing.
    expect(changedLineRanges(d)).toEqual([
      { start: 62, end: 63 },
      { start: 65, end: 65 },
      { start: 112, end: 113 },
    ]);
  });

  it("counts a deletion-only spot as the new-side line right after it", () => {
    const d = diff(hunk(10, [ctx(10, 10), del(11), del(12), ctx(13, 11)]));
    expect(changedLineRanges(d)).toEqual([{ start: 11, end: 11 }]);
  });

  it("merges a replacement (deleted then added) into one range", () => {
    const d = diff(hunk(5, [ctx(5, 5), del(6), add(6), add(7), ctx(7, 8)]));
    expect(changedLineRanges(d)).toEqual([{ start: 6, end: 7 }]);
  });

  it("ignores binary diffs", () => {
    expect(changedLineRanges({ hunks: [hunk(1, [add(1)])], binary: true })).toEqual([]);
  });
});

describe("range helpers", () => {
  it("merges overlapping and touching ranges in order", () => {
    expect(
      mergeRanges([
        { start: 20, end: 25 },
        { start: 1, end: 3 },
        { start: 4, end: 6 },
        { start: 22, end: 30 },
      ]),
    ).toEqual([
      { start: 1, end: 6 },
      { start: 20, end: 30 },
    ]);
  });

  it("intersects two range lists", () => {
    expect(
      intersectRanges(
        [
          { start: 61, end: 69 },
          { start: 100, end: 105 },
        ],
        [
          { start: 65, end: 70 },
          { start: 112, end: 130 },
        ],
      ),
    ).toEqual([{ start: 65, end: 69 }]);
    expect(intersectRanges([{ start: 61, end: 69 }], [{ start: 112, end: 130 }])).toEqual([]);
  });

  it("formats ranges like the mockup and cuts long lists", () => {
    expect(formatRanges([{ start: 61, end: 69 }])).toBe("61–69");
    expect(formatRanges([{ start: 7, end: 7 }, { start: 9, end: 12 }])).toBe("7, 9–12");
    expect(
      formatRanges([
        { start: 1, end: 1 },
        { start: 3, end: 3 },
        { start: 5, end: 5 },
        { start: 7, end: 7 },
      ]),
    ).toBe("1, 3, 5, …");
  });
});

describe("compareLineRanges", () => {
  const mine = diff(hunk(61, [add(61), add(62), add(69)]));

  it("says the two worktrees change different lines", () => {
    const theirs = diff(hunk(112, [add(112), add(130)]));
    const result = compareLineRanges(mine, theirs);
    expect(result?.shared).toEqual([]);
    expect(formatRanges(result!.mine)).toBe("61–62, 69");
    expect(formatRanges(result!.theirs)).toBe("112, 130");
  });

  it("finds the lines both worktrees change", () => {
    const theirs = diff(hunk(60, [ctx(60, 60), add(61), add(62)]));
    expect(compareLineRanges(mine, theirs)?.shared).toEqual([{ start: 61, end: 62 }]);
  });

  it("gives no answer until both diffs are loaded, or for binary files", () => {
    expect(compareLineRanges(mine, undefined)).toBeNull();
    expect(compareLineRanges(null, mine)).toBeNull();
    expect(compareLineRanges(mine, { hunks: [], binary: true })).toBeNull();
  });
});
