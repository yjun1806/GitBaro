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

/** hunk 머리(`@@ -oldStart,oldLines +newStart,newLines @@`)와 줄. */
function hunk(newStart: number, newLines: number, lines: DiffLine[] = []): DiffHunk {
  return { oldStart: newStart, oldLines: newLines, newStart, newLines, header: "", lines };
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
  it("uses each hunk's new-side range, like the mockup's 61–69", () => {
    // gen_d2.py lines5: `@@ -61,9 +61,15 @@` with a delete at 63, adds at 63 and 65.
    const d = diff(
      hunk(61, 15, [ctx(61, 61), ctx(62, 62), del(63), add(63), ctx(64, 64), add(65), ctx(65, 66)]),
      hunk(112, 19, [add(112), ctx(110, 113)]),
    );
    expect(changedLineRanges(d)).toEqual([
      { start: 61, end: 75 },
      { start: 112, end: 130 },
    ]);
  });

  it("counts a hunk with no new-side lines as the one line where it sits", () => {
    expect(changedLineRanges(diff(hunk(10, 0, [del(11), del(12)])))).toEqual([{ start: 10, end: 10 }]);
    expect(changedLineRanges(diff(hunk(0, 0, [del(1)])))).toEqual([{ start: 1, end: 1 }]);
  });

  it("merges hunks that touch", () => {
    expect(changedLineRanges(diff(hunk(5, 3), hunk(8, 2)))).toEqual([{ start: 5, end: 9 }]);
  });

  it("ignores binary diffs", () => {
    expect(changedLineRanges({ hunks: [hunk(1, 1, [add(1)])], binary: true })).toEqual([]);
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
  const mine = diff(hunk(61, 9));

  it("says the two worktrees change different lines", () => {
    const theirs = diff(hunk(112, 19));
    const result = compareLineRanges(mine, theirs);
    expect(result?.shared).toEqual([]);
    expect(formatRanges(result!.mine)).toBe("61–69");
    expect(formatRanges(result!.theirs)).toBe("112–130");
  });

  it("calls overlapping hunks shared even when the edited lines themselves differ", () => {
    // Mine edits line 62 inside 61–69, theirs edits line 68 inside 65–71: the hunks overlap.
    const theirs = diff(hunk(65, 7, [ctx(65, 65), add(68)]));
    expect(compareLineRanges(mine, theirs)?.shared).toEqual([{ start: 65, end: 69 }]);
  });

  it("gives no answer until both diffs are loaded, or for binary files", () => {
    expect(compareLineRanges(mine, undefined)).toBeNull();
    expect(compareLineRanges(null, mine)).toBeNull();
    expect(compareLineRanges(mine, { hunks: [], binary: true })).toBeNull();
  });
});
