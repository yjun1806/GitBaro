import { describe, expect, it } from "vitest";
import { avatarColor } from "@/lib/avatar-color";
import {
  edgesThroughBottom,
  formatSeenClock,
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
  it("puts the divider right under the last new commit", () => {
    const marks = markNewCommits(line, { newCount: 2, ids: ["c1", "c2"] });
    expect([...marks.newIds]).toEqual(["c1", "c2"]);
    expect(marks.dividerBefore).toBe(2);
  });

  it("does not mark base-branch commits merged in after the recorded commit (basis oid)", () => {
    // feat/x recorded f1. main moved on (m1, m2) and was merged in as M. The backend counts
    // only M (it hides f1 and main's tip), so only M gets a dot and the divider sits under M.
    const commits = [
      { id: "M", parentIds: ["f1", "m2"] },
      { id: "m2", parentIds: ["m1"] },
      { id: "m1", parentIds: ["b0"] },
      { id: "f1", parentIds: ["b0"] },
      { id: "b0", parentIds: [] },
    ];
    const marks = markNewCommits(commits, { newCount: 1, ids: ["M"] });
    expect([...marks.newIds]).toEqual(["M"]);
    expect(marks.dividerBefore).toBe(1);
  });

  it("keeps the branch's own commits new below newer merged-in base commits (merge base)", () => {
    // f1, f2 on the branch, then main (m1, m2, newer than f2) merged in as M. Time order puts
    // m2 and m1 above f2, but base..HEAD is {M, f2, f1}.
    const commits = [
      { id: "M", parentIds: ["f2", "m2"] },
      { id: "m2", parentIds: ["m1"] },
      { id: "m1", parentIds: ["b0"] },
      { id: "f2", parentIds: ["f1"] },
      { id: "f1", parentIds: ["b0"] },
      { id: "b0", parentIds: [] },
    ];
    const marks = markNewCommits(commits, { newCount: 3, ids: ["M", "f2", "f1"] });
    expect([...marks.newIds]).toEqual(["M", "f2", "f1"]);
    expect(marks.newIds.has("m2")).toBe(false);
    expect(marks.dividerBefore).toBe(5);
  });

  it("draws no divider while the new commits are not all loaded yet", () => {
    const marks = markNewCommits(line, { newCount: 7, ids: ["c1", "c2", "c3", "c4", "c5", "x6", "x7"] });
    expect(marks.newIds.size).toBe(5);
    expect(marks.dividerBefore).toBeNull();
  });

  it("draws no divider when the backend list was cut at its cap", () => {
    const marks = markNewCommits(line, { newCount: 3000, ids: ["c1", "c2"] });
    expect(marks.newIds.size).toBe(2);
    expect(marks.dividerBefore).toBeNull();
  });

  it("marks nothing when there is nothing new or the count is unknown", () => {
    expect(markNewCommits(line, { newCount: 0, ids: [] }).dividerBefore).toBeNull();
    expect(markNewCommits(line, null).newIds.size).toBe(0);
  });

  it("puts the divider after the last row when every loaded commit is new", () => {
    const marks = markNewCommits(line, { newCount: 5, ids: ["c1", "c2", "c3", "c4", "c5"] });
    expect(marks.dividerBefore).toBe(5);
  });
});

describe("formatSeenClock", () => {
  const labels = { today: (t: string) => `today ${t}`, yesterday: (t: string) => `yesterday ${t}` };
  const now = new Date(2026, 8, 24, 16, 0).getTime();

  it("shows the clock time for today and yesterday", () => {
    expect(formatSeenClock(new Date(2026, 8, 24, 14, 10).getTime(), now, labels)).toBe("today 14:10");
    expect(formatSeenClock(new Date(2026, 8, 23, 9, 5).getTime(), now, labels)).toBe("yesterday 09:05");
  });

  it("adds the date for older times", () => {
    expect(formatSeenClock(new Date(2026, 8, 20, 8, 0).getTime(), now, labels, "en-US")).toBe("Sep 20 08:00");
  });
});

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
