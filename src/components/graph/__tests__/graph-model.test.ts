import { describe, expect, it } from "vitest";
import { avatarColor } from "@/lib/avatar-color";
import {
  forkPointIndex,
  visibleWipRows,
  edgesThroughBottom,
  graphColumnWidth,
  laneColor,
  laneX,
  MAX_VISIBLE_LANES,
  orderWipRows,
  type GraphWip,
} from "../graph-model";

describe("orderWipRows", () => {
  const wip = (path: string, isCurrent: boolean, isMain = false): GraphWip => ({
    path,
    branch: null,
    count: 0,
    changedAt: null,
    isCurrent,
    isMain,
  });

  it("keeps the open worktree last so it sits right above its HEAD commit", () => {
    const rows = orderWipRows([wip("/r", true, true), wip("/r-b", false), wip("/r-a", false)]);
    expect(rows.map((r) => r.path)).toEqual(["/r-a", "/r-b", "/r"]);
  });

  it("lists the main worktree first among the others", () => {
    const rows = orderWipRows([wip("/r-a", true), wip("/z", false, true), wip("/r-b", false)]);
    expect(rows.map((r) => r.path)).toEqual(["/z", "/r-b", "/r-a"]);
  });
});

describe("lane geometry and colour", () => {
  it("uses the repository avatar colour for the first chain and its hue for the others", () => {
    const base = avatarColor("/work/app").background;
    const hue = /hsl\((\d+)/.exec(base)?.[1];
    expect(laneColor("/work/app", 0)).toBe(base);
    for (const chain of [1, 2, 3, 7]) {
      expect(laneColor("/work/app", chain)).toMatch(new RegExp(`^hsl\\(${hue}, `));
    }
    expect(laneColor("/work/app", 1)).not.toBe(base);
  });

  it("follows the mockup spacing and caps the graph column", () => {
    expect(laneX(0)).toBe(16);
    expect(laneX(3)).toBe(58);
    expect(graphColumnWidth(1)).toBe(32);
    expect(graphColumnWidth(99)).toBe(graphColumnWidth(MAX_VISIBLE_LANES));
  });

  it("keeps lines that leave the bottom of a row, not the ones ending at its dot", () => {
    const through = edgesThroughBottom([
      { kind: "in", toLane: 0, chain: 0 },
      { kind: "out", toLane: 0, chain: 0 },
      { kind: "pass", toLane: 2, chain: 4 },
      { kind: "out", toLane: 2, chain: 4 },
    ]);
    expect(through).toEqual([
      { lane: 0, chain: 0 },
      { lane: 2, chain: 4 },
    ]);
  });
});

describe("visibleWipRows", () => {
  const wip = (path: string, count: number | null, isCurrent = false) => ({
    path,
    branch: null,
    count,
    changedAt: null,
    isCurrent,
    isMain: false,
  });

  it("hides a worktree row with no uncommitted files", () => {
    const rows = [wip("/a", 0), wip("/b", 2), wip("/c", 0, true)];
    expect(visibleWipRows(rows, null).map((r) => r.path)).toEqual(["/b"]);
  });

  it("keeps a row whose count is still unknown", () => {
    expect(visibleWipRows([wip("/a", null, true)], null)).toHaveLength(1);
  });

  it("keeps the followed worktree even at zero (the panel below still shows it)", () => {
    expect(visibleWipRows([wip("/a", 0)], "/a/").map((r) => r.path)).toEqual(["/a"]);
  });
});

describe("forkPointIndex", () => {
  const commits = [{ id: "c3" }, { id: "c2" }, { id: "base" }, { id: "old" }];
  const changes = { baseStatus: "found", mergeBaseOid: "base", branch: "feat/x", defaultBranch: "main" };

  it("puts the row right above the merge-base commit", () => {
    expect(forkPointIndex(commits, changes)).toBe(2);
  });

  it("shows nothing on the default branch itself", () => {
    expect(forkPointIndex(commits, { ...changes, branch: "main" })).toBeNull();
  });

  it("shows nothing when the base is unknown or not loaded yet", () => {
    expect(forkPointIndex(commits, undefined)).toBeNull();
    expect(forkPointIndex(commits, { ...changes, baseStatus: "noSharedHistory" })).toBeNull();
    expect(forkPointIndex(commits, { ...changes, mergeBaseOid: "deep" })).toBeNull();
  });

  it("works for a detached HEAD", () => {
    expect(forkPointIndex(commits, { ...changes, branch: null })).toBe(2);
  });
});
