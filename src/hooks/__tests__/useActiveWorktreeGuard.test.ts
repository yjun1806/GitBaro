// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import type { RepoInfo, WorktreeInfo } from "@/types";

type Handler = (event: { payload: { repoPath: string } }) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));

vi.mock("@/api/commands", () => ({
  getWorktrees: vi.fn(),
  getStatus: vi.fn(),
}));

import { getStatus, getWorktrees } from "@/api/commands";
import { useActiveWorktreeGuard, WORKTREE_CHECK_DEBOUNCE_MS } from "@/hooks/useActiveWorktreeGuard";

const MAIN = "/repos/alpha";
const WT = "/repos/alpha-worktrees/feature";

const mainRepo: RepoInfo = {
  path: MAIN,
  name: "alpha",
  currentBranch: "main",
  isDirty: false,
  remotes: [],
  accountId: null,
};

function worktree(path: string, overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
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
    base: null,
    ...overrides,
  };
}

const MAIN_ONLY = [worktree(MAIN, { isMain: true, branch: "main" })];
const BOTH = [...MAIN_ONLY, worktree(WT)];

function renderGuard() {
  // 앱과 같은 기본 staleTime(main.tsx). 이 값이면 캐시가 5초 동안 새것으로 취급된다.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });
  // 지운 워크트리가 아직 캐시에 남아 있는 상태. 확인은 이 캐시를 믿지 않고 새로 읽어야 한다.
  queryClient.setQueryData(["worktrees", MAIN], BOTH);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useActiveWorktreeGuard(), { wrapper });
}

function openAt(path: string) {
  useRepositoryStore.setState({
    repos: [mainRepo],
    activeRepoPath: path,
    activeRepo: mainRepo,
    activeWorktrees: path === MAIN ? {} : { [MAIN]: path },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  handlers.clear();
  vi.mocked(getWorktrees).mockReset();
  vi.mocked(getStatus).mockReset();
  vi.mocked(getStatus).mockResolvedValue([]);
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useActiveWorktreeGuard", () => {
  it("returns to the primary folder with a toast when the open worktree is removed outside the app", async () => {
    openAt(WT);
    vi.mocked(getWorktrees).mockResolvedValue(MAIN_ONLY);
    renderGuard();
    await waitFor(() => expect(handlers.has("fs:change")).toBe(true));

    act(() => handlers.get("fs:change")!({ payload: { repoPath: WT } }));
    await act(async () => {
      vi.advanceTimersByTime(WORKTREE_CHECK_DEBOUNCE_MS);
    });

    await waitFor(() => expect(useRepositoryStore.getState().activeRepoPath).toBe(MAIN));
    expect(useToastStore.getState().toasts.some((t) => t.type === "warning")).toBe(true);
  });

  it("checks right away when the status of the open worktree fails", async () => {
    openAt(WT);
    vi.mocked(getStatus).mockRejectedValue(new Error("could not find repository"));
    vi.mocked(getWorktrees).mockResolvedValue(MAIN_ONLY);
    renderGuard();
    await waitFor(() => expect(useRepositoryStore.getState().activeRepoPath).toBe(MAIN));
  });

  it("stays when the worktree is still there after the window regains focus", async () => {
    openAt(WT);
    vi.mocked(getWorktrees).mockResolvedValue(BOTH);
    renderGuard();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      vi.advanceTimersByTime(WORKTREE_CHECK_DEBOUNCE_MS);
    });
    await waitFor(() => expect(getWorktrees).toHaveBeenCalledWith(MAIN));
    expect(useRepositoryStore.getState().activeRepoPath).toBe(WT);
  });

  it("does nothing while the primary folder is open", async () => {
    openAt(MAIN);
    renderGuard();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      vi.advanceTimersByTime(WORKTREE_CHECK_DEBOUNCE_MS * 2);
    });
    expect(getWorktrees).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
  });
});
