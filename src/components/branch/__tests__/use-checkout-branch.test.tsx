// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import type { BranchInfo, StatusEntry, WorktreeInfo } from "@/types";

const data = vi.hoisted(() => ({
  branches: undefined as BranchInfo[] | undefined,
  status: undefined as StatusEntry[] | undefined,
  worktrees: undefined as WorktreeInfo[] | undefined,
}));
const openWorktree = vi.hoisted(() => vi.fn());

vi.mock("@/api/queries", () => ({
  useBranches: () => ({ data: data.branches }),
  useStatus: () => ({ data: data.status }),
  useWorktrees: () => ({ data: data.worktrees }),
}));
vi.mock("@/api/commands", () => ({
  switchBranch: vi.fn(),
  stashPush: vi.fn(),
  stashPopByOid: vi.fn(),
}));
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => openWorktree }));

import { stashPush, switchBranch } from "@/api/commands";
import { useCheckoutBranch } from "../useCheckoutBranch";

const REPO = "/repos/app";
const OTHER = "/repos/app-worktrees/feat";

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    isHead: false,
    isRemote: false,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
    ...extra,
  };
}

function worktree(path: string, branchName: string, isMain = false): WorktreeInfo {
  return {
    path,
    head: "abc",
    branch: branchName,
    isMain,
    isBare: false,
    isLocked: false,
    lockReason: null,
    isDirty: false,
    isPrunable: false,
    base: null,
  };
}

const dirty = [{ path: "a.ts" }] as StatusEntry[];

function renderCheckout() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useCheckoutBranch(), { wrapper }).result;
}

describe("useCheckoutBranch", () => {
  beforeEach(() => {
    vi.mocked(switchBranch).mockReset().mockResolvedValue(undefined);
    vi.mocked(stashPush).mockReset();
    openWorktree.mockReset();
    useToastStore.setState({ toasts: [] });
    useRepositoryStore.setState({ activeRepoPath: REPO, activeWorktrees: {}, repos: [] });
    data.branches = [branch("main", { isHead: true }), branch("feat"), branch("origin/feat", { isRemote: true })];
    data.status = [];
    data.worktrees = [worktree(REPO, "main", true)];
  });

  it("does nothing for a remote branch whose same-name local is the current branch", () => {
    data.branches = [branch("main", { isHead: true }), branch("origin/main", { isRemote: true })];
    data.status = dirty;
    const result = renderCheckout();
    act(() => result.current.checkout("origin/main"));
    expect(result.current.element).toBeNull();
    expect(switchBranch).not.toHaveBeenCalled();
    expect(stashPush).not.toHaveBeenCalled();
  });

  it("opens the worktree that holds the same-name local of a remote branch", () => {
    data.worktrees = [worktree(REPO, "main", true), worktree(OTHER, "feat")];
    const result = renderCheckout();
    act(() => result.current.checkout("origin/feat"));
    expect(openWorktree).toHaveBeenCalledWith(OTHER);
    expect(switchBranch).not.toHaveBeenCalled();
  });

  it("opens the worktree that holds a local branch", () => {
    data.worktrees = [worktree(REPO, "main", true), worktree(OTHER, "feat")];
    const result = renderCheckout();
    act(() => result.current.checkout("feat"));
    expect(openWorktree).toHaveBeenCalledWith(OTHER);
  });

  it("switches to the local name when a remote branch has a same-name local", async () => {
    const result = renderCheckout();
    await act(async () => result.current.checkout("origin/feat"));
    expect(switchBranch).toHaveBeenCalledWith(REPO, "feat");
  });

  it("passes a remote-only branch through so the backend creates a tracking branch", async () => {
    data.branches = [branch("main", { isHead: true }), branch("origin/new", { isRemote: true })];
    const result = renderCheckout();
    await act(async () => result.current.checkout("origin/new"));
    expect(switchBranch).toHaveBeenCalledWith(REPO, "origin/new");
  });

  it("asks what to do with uncommitted changes before switching", () => {
    data.status = dirty;
    const result = renderCheckout();
    act(() => result.current.checkout("feat"));
    expect(result.current.element).not.toBeNull();
    expect(switchBranch).not.toHaveBeenCalled();
  });

  it("ignores checkout until the lists are loaded", () => {
    data.status = undefined;
    const result = renderCheckout();
    expect(result.current.ready).toBe(false);
    act(() => result.current.checkout("feat"));
    expect(switchBranch).not.toHaveBeenCalled();
    expect(result.current.element).toBeNull();
  });
});
