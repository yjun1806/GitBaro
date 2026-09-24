// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useUIStore } from "@/stores/ui";
import type { RepoInfo, WorktreeInfo } from "@/types";

vi.mock("@/api/commands", () => ({
  getBranches: vi.fn(),
  getStatus: vi.fn(),
}));

import { getBranches, getStatus } from "@/api/commands";

const MAIN_A = "/repos/alpha";
const WT_A = "/repos/alpha-worktrees/feature";

const mainRepo: RepoInfo = {
  path: MAIN_A,
  name: "alpha",
  currentBranch: "main",
  isDirty: false,
  remotes: [],
  accountId: null,
};

function makeWorktree(path: string, overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path,
    head: "abc123",
    branch: "feature",
    isMain: false,
    isBare: false,
    isLocked: false,
    lockReason: null,
    isDirty: false,
    isPrunable: false,
    ...overrides,
  };
}

function renderOpen(worktrees: WorktreeInfo[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useOpenWorktree(MAIN_A, worktrees), { wrapper }).result;
}

describe("useOpenWorktree", () => {
  beforeEach(() => {
    vi.mocked(getBranches).mockReset();
    vi.mocked(getStatus).mockReset();
    useToastStore.setState({ toasts: [] });
    useUIStore.setState({ isSwitchingBranch: false });
    useRepositoryStore.setState({
      repos: [mainRepo],
      activeRepoPath: MAIN_A,
      activeRepo: mainRepo,
      activeWorktrees: {},
    });
  });

  it("열지 못하면 이전 위치로 되돌리고 알린다", async () => {
    vi.mocked(getBranches).mockRejectedValue(new Error("not a git repository"));
    vi.mocked(getStatus).mockRejectedValue(new Error("not a git repository"));
    const open = renderOpen([makeWorktree(MAIN_A, { isMain: true }), makeWorktree(WT_A)]);

    await act(() => open.current(WT_A));

    const repo = useRepositoryStore.getState();
    expect(repo.activeRepoPath).toBe(MAIN_A);
    expect(repo.activeRepo?.path).toBe(MAIN_A);
    expect(repo.activeWorktrees).toEqual({});
    expect(useUIStore.getState().isSwitchingBranch).toBe(false);
    expect(useToastStore.getState().toasts.map((t) => t.type)).toContain("error");
  });

  it("폴더가 사라진 워크트리로는 전환하지 않는다", async () => {
    const open = renderOpen([
      makeWorktree(MAIN_A, { isMain: true }),
      makeWorktree(WT_A, { isPrunable: true }),
    ]);

    await act(() => open.current(WT_A));

    expect(getBranches).not.toHaveBeenCalled();
    expect(useRepositoryStore.getState().activeRepoPath).toBe(MAIN_A);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("열리면 그 워크트리를 기억한다", async () => {
    vi.mocked(getBranches).mockResolvedValue([]);
    vi.mocked(getStatus).mockResolvedValue([]);
    const open = renderOpen([makeWorktree(MAIN_A, { isMain: true }), makeWorktree(WT_A)]);

    await act(() => open.current(WT_A));

    expect(useRepositoryStore.getState().activeRepoPath).toBe(WT_A);
    expect(useRepositoryStore.getState().activeWorktrees).toEqual({ [MAIN_A]: WT_A });
  });
});
