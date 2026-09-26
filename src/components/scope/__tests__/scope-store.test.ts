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
