// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { pickRepoAccountId, useAssignRepoAccount } from "../useRepoAccountId";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import type { RepoInfo } from "@/types";

const repo = (path: string, accountId: string | null): RepoInfo => ({
  path,
  name: path,
  currentBranch: "main",
  isDirty: false,
  remotes: [],
  accountId,
});

describe("pickRepoAccountId", () => {
  it("uses the open repository's account", () => {
    expect(pickRepoAccountId(repo("/a", "work"), "personal")).toBe("work");
  });

  it("never falls back to the previous repository's account", () => {
    expect(pickRepoAccountId(repo("/b", null), "work")).toBeNull();
  });

  it("uses the active account only when no repository is open", () => {
    expect(pickRepoAccountId(null, "work")).toBe("work");
  });
});

describe("useAssignRepoAccount", () => {
  beforeEach(() => {
    useRepositoryStore.setState({
      repos: [repo("/a", "work"), repo("/b", null)],
      activeRepoPath: "/b",
      activeWorktrees: {},
    });
    useAccountStore.setState({ activeAccountId: "work" });
  });

  it("assigns the picked account to the open repository", () => {
    const { result } = renderHook(() => useAssignRepoAccount());
    act(() => result.current("personal"));
    const repos = useRepositoryStore.getState().repos;
    expect(repos.find((r) => r.path === "/b")?.accountId).toBe("personal");
    expect(repos.find((r) => r.path === "/a")?.accountId).toBe("work");
    expect(useAccountStore.getState().activeAccountId).toBe("personal");
  });

  it("assigns the owner repository when a worktree is open", () => {
    useRepositoryStore.setState({ activeRepoPath: "/a-wt", activeWorktrees: { "/a": "/a-wt" } });
    const { result } = renderHook(() => useAssignRepoAccount());
    act(() => result.current("personal"));
    expect(useRepositoryStore.getState().repos.find((r) => r.path === "/a")?.accountId).toBe("personal");
  });
});
