import { describe, expect, it } from "vitest";
import type { GroupedBranches } from "@/hooks/useBranchGroups";
import type { BranchInfo } from "@/types";
import { getVisibleBranches, nextActiveName } from "../visible-branches";

const branch = (name: string, isRemote = false) => ({ name, isRemote, lastCommitTime: 0 }) as BranchInfo;

const groups: GroupedBranches = {
  default: branch("main"),
  recent: [branch("hotfix")],
  other: [branch("zeta"), branch("feature/a"), branch("feature/b")],
  remoteOnly: [branch("origin/remote-a", true)],
};

const names = (list: BranchInfo[]) => list.map((b) => b.name);

describe("getVisibleBranches", () => {
  it("lists rows in render order: folders sorted with ungrouped branches", () => {
    const visible = getVisibleBranches(groups, "name", {
      collapsedPrefixes: new Set(),
      remoteCollapsed: false,
    });
    expect(names(visible)).toEqual([
      "main",
      "hotfix",
      "feature/a",
      "feature/b",
      "zeta",
      "origin/remote-a",
    ]);
  });

  it("skips branches inside a collapsed folder and a collapsed remote group", () => {
    const visible = getVisibleBranches(groups, "name", {
      collapsedPrefixes: new Set(["feature"]),
      remoteCollapsed: true,
    });
    expect(names(visible)).toEqual(["main", "hotfix", "zeta"]);
  });
});

describe("nextActiveName", () => {
  const visible = ["main", "hotfix", "zeta"];

  it("starts at the first or last row", () => {
    expect(nextActiveName(visible, null, "down")).toBe("main");
    expect(nextActiveName(visible, null, "up")).toBe("zeta");
  });

  it("wraps around at both ends", () => {
    expect(nextActiveName(visible, "zeta", "down")).toBe("main");
    expect(nextActiveName(visible, "main", "up")).toBe("zeta");
  });

  it("restarts when the highlighted branch was hidden", () => {
    expect(nextActiveName(visible, "origin/remote-a", "down")).toBe("main");
  });

  it("returns null for an empty list", () => {
    expect(nextActiveName([], "main", "down")).toBeNull();
  });
});
