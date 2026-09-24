import { afterEach, describe, expect, it } from "vitest";
import type { CommitInfo } from "@/types";
import { activeRange, rangeLabel, rangeLaneInput, useBranchRangeStore } from "../branch-range";

function commit(id: string, parentIds: string[]): CommitInfo {
  return {
    id,
    shortId: id,
    message: id,
    summary: id,
    author: { name: "t", email: "t@t" },
    committer: { name: "t", email: "t@t" },
    timestamp: 0,
    parentIds,
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

afterEach(() => useBranchRangeStore.getState().clear());

describe("branch range", () => {
  it("drops parents outside the range so no lane stays open below it", () => {
    const input = rangeLaneInput([commit("c", ["b", "m"]), commit("b", ["base"])]);
    expect(input).toEqual([
      { oid: "c", parentIds: ["b"] },
      { oid: "b", parentIds: [] },
    ]);
  });

  it("applies only to the repository it was set for", () => {
    const range = { repoPath: "/a", base: "main", target: "feat" };
    expect(activeRange(range, "/a")).toBe(range);
    expect(activeRange(range, "/b")).toBeNull();
    expect(activeRange(range, null)).toBeNull();
    expect(rangeLabel(range)).toBe("main..feat");
  });

  it("swaps the direction and clears", () => {
    const store = useBranchRangeStore.getState();
    store.setRange({ repoPath: "/a", base: "main", target: "feat" });
    useBranchRangeStore.getState().swap();
    expect(useBranchRangeStore.getState().range).toEqual({ repoPath: "/a", base: "feat", target: "main" });
    useBranchRangeStore.getState().clear();
    expect(useBranchRangeStore.getState().range).toBeNull();
  });
});
