import { beforeEach, describe, expect, it } from "vitest";
import { useRepositoryStore } from "@/stores/repository";
import { useScopeStore } from "../scope-store";

describe("useScopeStore (「저장소」 단계 보기)", () => {
  beforeEach(() => {
    useScopeStore.setState({ aggregateRepoPath: null });
    useRepositoryStore.setState({ repos: [], activeRepoPath: null, activeRepo: null, activeWorktrees: {} });
  });

  it("starts with no repository in aggregate view", () => {
    expect(useScopeStore.getState().aggregateRepoPath).toBeNull();
  });

  it("remembers the chosen repository and can turn it off", () => {
    useScopeStore.getState().viewRepoAggregate("/r/a");
    expect(useScopeStore.getState().aggregateRepoPath).toBe("/r/a");
    useScopeStore.getState().viewRepoAggregate(null);
    expect(useScopeStore.getState().aggregateRepoPath).toBeNull();
  });

  it("turns off aggregate view when the owning repository changes", () => {
    useScopeStore.getState().viewRepoAggregate("/r/a");
    useRepositoryStore.setState({ activeRepoPath: "/r/b" });
    expect(useScopeStore.getState().aggregateRepoPath).toBeNull();
  });

  it("keeps aggregate view when the same owning repository's worktree changes", () => {
    useRepositoryStore.setState({
      repos: [{ path: "/r/a", name: "a", currentBranch: "main", isDirty: false, remotes: [], accountId: null }],
      activeRepoPath: "/r/a",
      activeRepo: { path: "/r/a", name: "a", currentBranch: "main", isDirty: false, remotes: [], accountId: null },
    });
    useScopeStore.getState().viewRepoAggregate("/r/a");
    // 같은 소유 저장소(/r/a) 안의 다른 워크트리로 옮겨도 activeRepo는 그대로 /r/a다.
    useRepositoryStore.setState({ activeRepoPath: "/r/a-worktree" });
    expect(useScopeStore.getState().aggregateRepoPath).toBe("/r/a");
  });
});

describe("useScopeStore (레인 칩·선택)", () => {
  beforeEach(() => {
    useScopeStore.setState({ repoShown: {}, laneShown: {}, lastSelection: null });
  });

  it("keeps only the chips the user touched, without wiping the others", () => {
    useScopeStore.getState().setLaneShown("/r/a", false);
    useScopeStore.getState().setLaneShown("/r/b", true);
    useScopeStore.getState().setLanesShown({ "/r/a": true, "/r/c": false });
    expect(useScopeStore.getState().laneShown).toEqual({ "/r/a": true, "/r/b": true, "/r/c": false });
    useScopeStore.getState().setRepoShown("/r/x", true);
    expect(useScopeStore.getState().repoShown).toEqual({ "/r/x": true });
  });

  it("remembers the last picked lane and commit", () => {
    useScopeStore.getState().rememberSelection({ laneId: "/r/a", commitOid: "c1" });
    expect(useScopeStore.getState().lastSelection).toEqual({ laneId: "/r/a", commitOid: "c1" });
  });
});
