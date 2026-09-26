// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useHistoryViewStore } from "@/stores/history-view";
import { useScopeStore } from "../scope-store";
import type { RepoInfo } from "@/types";

vi.mock("@/hooks/useCurrentBranch", () => ({ useCurrentBranch: () => "feat/x" }));

const { useScope } = await import("../useScope");

const repo: RepoInfo = {
  path: "/r/a",
  name: "a",
  currentBranch: "feat/x",
  isDirty: false,
  remotes: [],
  accountId: null,
};

describe("useScope", () => {
  beforeEach(() => {
    useRepositoryStore.setState({
      repos: [repo],
      activeRepoPath: "/r/a",
      activeRepo: repo,
      activeWorktrees: {},
    });
    useWorkspaceStore.setState({ activeWorkspaceId: null, workspaces: [] });
    useHistoryViewStore.setState({ repoPath: null, target: null });
    useScopeStore.setState({ aggregateRepoPath: null });
  });

  it("resolves to the checked-out branch by default", () => {
    const { result } = renderHook(() => useScope());
    expect(result.current).toEqual({ kind: "branch", repoPath: "/r/a", branch: "feat/x", worktreePath: "/r/a" });
  });

  it("resolves to the workspace when one is active", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });
    const { result } = renderHook(() => useScope());
    expect(result.current).toEqual({ kind: "workspace", workspaceId: "w1" });
  });

  it("resolves to the repo scope when the sidebar repo row is chosen", () => {
    useScopeStore.setState({ aggregateRepoPath: "/r/a" });
    const { result } = renderHook(() => useScope());
    expect(result.current).toEqual({ kind: "repo", repoPath: "/r/a" });
  });

  it("resolves to the viewed (not checked out) local branch, clearing the worktree", () => {
    useHistoryViewStore.setState({ repoPath: "/r/a", target: { kind: "ref", name: "feat/other", isRemote: false } });
    const { result } = renderHook(() => useScope());
    expect(result.current).toEqual({ kind: "branch", repoPath: "/r/a", branch: "feat/other", worktreePath: null });
  });

  it("falls back to the checked-out branch when viewing a remote ref (not a local branch scope)", () => {
    useHistoryViewStore.setState({ repoPath: "/r/a", target: { kind: "ref", name: "origin/x", isRemote: true } });
    const { result } = renderHook(() => useScope());
    expect(result.current).toEqual({ kind: "branch", repoPath: "/r/a", branch: "feat/x", worktreePath: "/r/a" });
  });

  it("is null when nothing is open", () => {
    useRepositoryStore.setState({ repos: [], activeRepoPath: null, activeRepo: null, activeWorktrees: {} });
    const { result } = renderHook(() => useScope());
    expect(result.current).toBeNull();
  });
});
