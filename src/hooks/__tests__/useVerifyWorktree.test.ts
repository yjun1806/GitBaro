// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useVerifyWorktree } from "@/hooks/useVerifyWorktree";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import type { RepoInfo, WorktreeInfo } from "@/types";

vi.mock("@/api/commands", () => ({
  getWorktrees: vi.fn(),
}));

import { getWorktrees } from "@/api/commands";

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

const HEALTHY = [makeWorktree(MAIN_A, { isMain: true, branch: "main" }), makeWorktree(WT_A)];

function renderVerify() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useVerifyWorktree(), { wrapper }).result;
}

/** 워크트리 WT_A를 보고 있는 상태로 만든다. */
function enterWorktree() {
  useRepositoryStore.setState({
    repos: [mainRepo],
    activeRepoPath: WT_A,
    activeRepo: mainRepo,
    activeWorktrees: { [MAIN_A]: WT_A },
  });
}

describe("useVerifyWorktree", () => {
  beforeEach(() => {
    vi.mocked(getWorktrees).mockReset();
    useToastStore.setState({ toasts: [] });
    enterWorktree();
  });

  it("살아있는 워크트리는 그대로 둔다", async () => {
    vi.mocked(getWorktrees).mockResolvedValue(HEALTHY);

    renderVerify().current(MAIN_A, WT_A);

    await waitFor(() => expect(getWorktrees).toHaveBeenCalledWith(MAIN_A));
    expect(useRepositoryStore.getState().activeRepoPath).toBe(WT_A);
    expect(useRepositoryStore.getState().activeWorktrees).toEqual({ [MAIN_A]: WT_A });
  });

  // 폴더를 지워도 git은 prune 전까지 목록에 남겨둔다. 목록 존재 여부만 보면 놓친다.
  it("폴더가 사라진(prunable) 워크트리는 메인으로 되돌린다", async () => {
    vi.mocked(getWorktrees).mockResolvedValue([
      makeWorktree(MAIN_A, { isMain: true, branch: "main" }),
      makeWorktree(WT_A, { isPrunable: true }),
    ]);

    renderVerify().current(MAIN_A, WT_A);

    await waitFor(() =>
      expect(useRepositoryStore.getState().activeRepoPath).toBe(MAIN_A),
    );
    expect(useRepositoryStore.getState().activeWorktrees).toEqual({});
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("목록에서 완전히 사라진 워크트리도 메인으로 되돌린다", async () => {
    vi.mocked(getWorktrees).mockResolvedValue([
      makeWorktree(MAIN_A, { isMain: true, branch: "main" }),
    ]);

    renderVerify().current(MAIN_A, WT_A);

    await waitFor(() =>
      expect(useRepositoryStore.getState().activeRepoPath).toBe(MAIN_A),
    );
    expect(useRepositoryStore.getState().activeWorktrees).toEqual({});
  });

  it("목록 조회가 실패하면 멀쩡한 워크트리를 되돌리지 않는다", async () => {
    vi.mocked(getWorktrees).mockRejectedValue(new Error("git unavailable"));

    renderVerify().current(MAIN_A, WT_A);

    await waitFor(() => expect(getWorktrees).toHaveBeenCalled());
    expect(useRepositoryStore.getState().activeRepoPath).toBe(WT_A);
    expect(useRepositoryStore.getState().activeWorktrees).toEqual({ [MAIN_A]: WT_A });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("확인이 끝나기 전에 사용자가 다른 곳으로 옮겼으면 건드리지 않는다", async () => {
    vi.mocked(getWorktrees).mockResolvedValue([
      makeWorktree(MAIN_A, { isMain: true, branch: "main" }),
    ]);

    renderVerify().current(MAIN_A, WT_A);
    useRepositoryStore.setState({ activeRepoPath: "/repos/beta", activeRepo: null });

    await waitFor(() => expect(getWorktrees).toHaveBeenCalled());
    expect(useRepositoryStore.getState().activeRepoPath).toBe("/repos/beta");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
