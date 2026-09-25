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
const defaultBranchCalls: string[][] = [];

vi.mock("@/api/queries", () => ({
  useDefaultBranches: (paths: string[]) => {
    defaultBranchCalls.push(paths);
    return { data: { [API]: { path: API, name: "main", hasLocal: true, remoteRef: "origin/main" } } };
  },
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
  defaultBranchCalls.length = 0;
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

  it("reads every repository's default branch in one batched call", () => {
    const { result } = renderHook(() => useSidebarTreeData());
    expect(defaultBranchCalls[defaultBranchCalls.length - 1]).toEqual([API]);
    expect(result.current.defaultBranchOf(API)?.name).toBe("main");
    expect(result.current.defaultBranchOf("/r/other")).toBeUndefined();
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
});
