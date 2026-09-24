// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { RepoInfo, RepoReviewStatus, RepoSyncStatus } from "@/types";

const API = "/r/api";
const WT = "/r/api/.worktrees/feat";

const reviewRepos: RepoReviewStatus[] = [
  {
    repoPath: API,
    worktrees: [
      { path: API, branch: "main", headOid: "a", isMain: true },
      { path: WT, branch: "feat/login", headOid: "b", isMain: false },
    ],
  },
];

const syncCalls: string[][] = [];

vi.mock("@/api/queries", () => ({
  useRepoSyncStatuses: (paths: string[]) => {
    syncCalls.push(paths);
    const data: Record<string, RepoSyncStatus> = {
      [WT]: {
        path: WT,
        branch: "feat/login",
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        unpushed: 0,
        isDirty: true,
        dirtyCount: 2,
        dirtyLatestMtime: null,
      },
    };
    return { data };
  },
}));

vi.mock("@/hooks/useReviewStatus", () => ({
  useReviewStatus: () => ({ repos: reviewRepos, byPath: {}, markSeen: () => {}, isLoading: false }),
}));

import {
  allWorktreePaths,
  SIDEBAR_WATCH_KEY,
  useSidebarTreeData,
  useSidebarWatchPaths,
} from "../useSidebarTreeData";

const repo: RepoInfo = {
  path: API,
  name: "api",
  currentBranch: "main",
  isDirty: false,
  remotes: [{ name: "origin", url: "https://github.com/acme/api.git" }],
  accountId: null,
};

beforeEach(() => {
  syncCalls.length = 0;
  useRepositoryStore.setState({ repos: [repo] });
  useWorkspaceStore.setState({ workspaces: [], collapsed: [] });
  useActivityTargetsStore.setState({ extraByKey: {} });
});

afterEach(cleanup);

describe("useSidebarTreeData", () => {
  it("reads repository and worktree status in one batched call", () => {
    const { result } = renderHook(() => useSidebarTreeData());
    expect(syncCalls[syncCalls.length - 1]).toEqual([API, WT]);
    expect(result.current.signals[WT].dirtyCount).toBe(2);
    expect(result.current.branchOf(WT)).toBe("feat/login");
  });

  it("does not register watch targets itself (the tree does, from what it shows)", () => {
    renderHook(() => useSidebarTreeData());
    expect(useActivityTargetsStore.getState().extraByKey[SIDEBAR_WATCH_KEY]).toBeUndefined();
  });
});

describe("useSidebarWatchPaths", () => {
  it("registers the given paths, replaces them when they change and removes them on unmount", () => {
    const { rerender, unmount } = renderHook(({ paths }) => useSidebarWatchPaths(paths), {
      initialProps: { paths: [WT] },
    });
    expect(useActivityTargetsStore.getState().extraByKey[SIDEBAR_WATCH_KEY]).toEqual([WT]);

    rerender({ paths: [] });
    expect(useActivityTargetsStore.getState().extraByKey[SIDEBAR_WATCH_KEY]).toEqual([]);

    unmount();
    expect(useActivityTargetsStore.getState().extraByKey[SIDEBAR_WATCH_KEY]).toBeUndefined();
  });

  it("registers under a caller-given key, independent of the default sidebar key", () => {
    // RepoRail uses this to keep watching worktrees under a fallback key while
    // RepoTree (which owns SIDEBAR_WATCH_KEY) is unmounted — rail collapsed, or
    // hover mode with the mouse away.
    const { unmount } = renderHook(() => useSidebarWatchPaths([WT], "sidebar-collapsed"));
    expect(useActivityTargetsStore.getState().extraByKey["sidebar-collapsed"]).toEqual([WT]);
    expect(useActivityTargetsStore.getState().extraByKey[SIDEBAR_WATCH_KEY]).toBeUndefined();

    unmount();
    expect(useActivityTargetsStore.getState().extraByKey["sidebar-collapsed"]).toBeUndefined();
  });
});

describe("allWorktreePaths", () => {
  it("flattens every repo's worktree paths into one list", () => {
    expect(
      allWorktreePaths({
        [API]: [{ path: API, branch: "main" }],
        "/other": [
          { path: "/other", branch: "main" },
          { path: WT, branch: "feat/login" },
        ],
      }),
    ).toEqual([API, "/other", WT]);
  });

  it("returns an empty list for no repos", () => {
    expect(allWorktreePaths({})).toEqual([]);
  });
});
