import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKING_BRANCH_RECENT_DAYS,
  workingBranchReasons,
  workingBranchRecentDays,
  type WorkingBranchContext,
} from "@/lib/working-branches";
import type { WorkingBranch } from "@/types";

const DAY = 24 * 60 * 60;
const NOW_S = 1_800_000_000;

function branch(patch: Partial<WorkingBranch> = {}): WorkingBranch {
  return {
    name: "feat/x",
    isDefault: false,
    worktreePath: null,
    upstream: null,
    behind: 0,
    unpushed: 0,
    lastCommitTime: NOW_S - 30 * DAY,
    mergedIntoDefault: false,
    ...patch,
  };
}

const ctx = (patch: Partial<WorkingBranchContext> = {}): WorkingBranchContext => ({
  openPrHeads: new Set(),
  recentDays: 7,
  now: NOW_S * 1000,
  ...patch,
});

describe("workingBranchReasons", () => {
  it("gives an old, pushed branch without a worktree or PR no row", () => {
    expect(workingBranchReasons(branch(), ctx())).toEqual([]);
  });

  it("lists every matching reason in order", () => {
    const b = branch({ worktreePath: "/wt", unpushed: 2, lastCommitTime: NOW_S - DAY });
    expect(workingBranchReasons(b, ctx({ openPrHeads: new Set(["feat/x"]) }))).toEqual([
      "worktree",
      "unpushed",
      "openPr",
      "recent",
    ]);
  });

  it("never gives the default branch its own row", () => {
    const main = branch({ name: "main", isDefault: true, worktreePath: "/repo", unpushed: 3, lastCommitTime: NOW_S });
    expect(workingBranchReasons(main, ctx({ openPrHeads: new Set(["main"]) }))).toEqual([]);
  });

  it("counts a recent commit only while the branch is not merged", () => {
    const recent = branch({ lastCommitTime: NOW_S - 7 * DAY });
    expect(workingBranchReasons(recent, ctx())).toEqual(["recent"]);
    expect(workingBranchReasons({ ...recent, mergedIntoDefault: true }, ctx())).toEqual([]);
    expect(workingBranchReasons(branch({ lastCommitTime: NOW_S - 7 * DAY - 1 }), ctx())).toEqual([]);
    expect(workingBranchReasons(branch({ lastCommitTime: NOW_S - 20 * DAY }), ctx({ recentDays: 30 }))).toEqual([
      "recent",
    ]);
  });

  it("keeps a merged branch that still has commits on no remote", () => {
    expect(workingBranchReasons(branch({ mergedIntoDefault: true, unpushed: 1 }), ctx())).toEqual(["unpushed"]);
  });
});

describe("workingBranchRecentDays", () => {
  it("defaults to 7 and clamps to 1..365 whole days", () => {
    expect(DEFAULT_WORKING_BRANCH_RECENT_DAYS).toBe(7);
    expect(workingBranchRecentDays(null)).toBe(7);
    expect(workingBranchRecentDays({})).toBe(7);
    expect(workingBranchRecentDays({ workingBranchRecentDays: 14 })).toBe(14);
    expect(workingBranchRecentDays({ workingBranchRecentDays: 0 })).toBe(7);
    expect(workingBranchRecentDays({ workingBranchRecentDays: 2.5 })).toBe(7);
    expect(workingBranchRecentDays({ workingBranchRecentDays: 9999 })).toBe(365);
  });
});
