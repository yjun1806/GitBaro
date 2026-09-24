import { afterEach, describe, expect, it } from "vitest";
import type { BranchInfo, CommitInfo } from "@/types";
import { activeRange, isStaleRange, rangeLabel, rangeLaneInput, useBranchRangeStore } from "../branch-range";

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
    const range = { repoPath: "/a", base: "main", target: "feat", head: "main" };
    expect(activeRange(range, "/a")).toBe(range);
    expect(activeRange(range, "/b")).toBeNull();
    expect(activeRange(range, null)).toBeNull();
    expect(rangeLabel(range)).toBe("main..feat");
  });

  it("swaps the direction and clears", () => {
    const store = useBranchRangeStore.getState();
    store.setRange({ repoPath: "/a", base: "main", target: "feat", head: "main" });
    useBranchRangeStore.getState().swap();
    expect(useBranchRangeStore.getState().range).toEqual({ repoPath: "/a", base: "feat", target: "main", head: "main" });
    useBranchRangeStore.getState().clear();
    expect(useBranchRangeStore.getState().range).toBeNull();
  });

  it("goes stale when a branch in it disappears or the worktree switches branch", () => {
    const b = (name: string, isHead = false): BranchInfo => ({
      name,
      isHead,
      isRemote: false,
      isDefault: false,
      upstream: null,
      aheadBehind: null,
      lastCommitTime: null,
      isFullyMerged: false,
      lastCommitAuthor: null,
    });
    const range = { repoPath: "/a", base: "main", target: "docs/y", head: "main" };
    expect(isStaleRange(range, undefined)).toBe(false);
    expect(isStaleRange(range, [b("main", true), b("docs/y")])).toBe(false);
    // 방향을 바꿔도 워크트리 브랜치는 그대로라 유지된다.
    expect(isStaleRange({ ...range, base: "docs/y", target: "main" }, [b("main", true), b("docs/y")])).toBe(false);
    // docs/y 이름 변경·삭제
    expect(isStaleRange(range, [b("main", true), b("docs/z")])).toBe(true);
    // 워크트리를 다른 브랜치로 전환
    expect(isStaleRange(range, [b("main"), b("docs/y"), b("fix/a", true)])).toBe(true);
    // 분리된 HEAD
    expect(isStaleRange(range, [b("main"), b("docs/y")])).toBe(true);
  });
});
