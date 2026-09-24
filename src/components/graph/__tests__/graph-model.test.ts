import { describe, expect, it } from "vitest";
import { avatarColor } from "@/lib/avatar-color";
import {
  edgesThroughBottom,
  graphColumnWidth,
  laneColor,
  laneX,
  markNewCommits,
  MAX_VISIBLE_LANES,
  orderWipRows,
  type GraphWip,
} from "../graph-model";

/** c1 → c2 → c3 → c4 → c5 한 줄 이력(위가 최신). */
const line = ["c1", "c2", "c3", "c4", "c5"].map((id, i, all) => ({
  id,
  parentIds: i + 1 < all.length ? [all[i + 1]] : [],
}));

describe("markNewCommits", () => {
  it("puts the divider right under the last new commit (basis oid)", () => {
    const marks = markNewCommits(line, { newCount: 2, basis: "oid", seenOid: "c3" });
    expect([...marks.newIds]).toEqual(["c1", "c2"]);
    expect(marks.dividerBefore).toBe(2);
  });

  it("takes the top N commits when the count came from author time or the merge base", () => {
    const marks = markNewCommits(line, { newCount: 3, basis: "mergeBase", seenOid: null });
    expect([...marks.newIds]).toEqual(["c1", "c2", "c3"]);
    expect(marks.dividerBefore).toBe(3);
  });

  it("does not count an old commit merged in above the baseline as new", () => {
    // m1 merges side branch s1 (older, already seen through the baseline b1).
    // Time order puts s1 above b1, but s1 is reachable from the baseline.
    const commits = [
      { id: "m1", parentIds: ["b1", "s1"] },
      { id: "s1", parentIds: ["b0"] },
      { id: "b1", parentIds: ["s1"] },
      { id: "b0", parentIds: [] },
    ];
    const marks = markNewCommits(commits, { newCount: 1, basis: "oid", seenOid: "b1" });
    expect([...marks.newIds]).toEqual(["m1"]);
    expect(marks.dividerBefore).toBe(1);
  });

  it("draws no divider while the new commits are not all loaded yet", () => {
    const marks = markNewCommits(line, { newCount: 8, basis: "mergeBase", seenOid: null });
    expect(marks.newIds.size).toBe(5);
    expect(marks.dividerBefore).toBeNull();
  });

  it("marks nothing when there is nothing new or the count is unknown", () => {
    expect(markNewCommits(line, { newCount: 0, basis: "oid", seenOid: "c1" }).dividerBefore).toBeNull();
    expect(markNewCommits(line, { newCount: null, basis: null, seenOid: null }).newIds.size).toBe(0);
  });

  it("puts the divider after the last row when every loaded commit is new", () => {
    const marks = markNewCommits(line, { newCount: 5, basis: "mergeBase", seenOid: null });
    expect(marks.dividerBefore).toBe(5);
  });
});

describe("orderWipRows", () => {
  const wip = (path: string, isCurrent: boolean, isMain = false): GraphWip => ({
    path,
    branch: null,
    count: 0,
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
  it("uses the repository avatar colour for the first chain", () => {
    expect(laneColor("/work/app", 0)).toBe(avatarColor("/work/app").background);
    expect(laneColor("/work/app", 3)).toBe(avatarColor("/work/app#3").background);
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
