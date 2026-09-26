// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AppSettings, RepoInfo, RepoReviewStatus, RepoSyncStatus, RepoWorkingBranches } from "@/types";

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
let settingsData: Partial<AppSettings> | undefined;
let workingBranchesData: (RepoWorkingBranches | undefined)[] = [];
let openPrsByRepo: Record<string, ReadonlyMap<string, number>> = {};

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
  useSettings: () => ({ data: settingsData }),
  useWorkingBranches: () => workingBranchesData,
  useCachedOpenPrsByRepo: (repos: { path: string }[]) =>
    Object.fromEntries(repos.map((r) => [r.path, openPrsByRepo[r.path] ?? new Map()])),
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
  settingsData = undefined;
  workingBranchesData = [];
  openPrsByRepo = {};
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

describe("useSidebarTreeData — working branches", () => {
  function branch(over: Partial<RepoWorkingBranches["branches"][number]>): RepoWorkingBranches["branches"][number] {
    return {
      name: "feat/x",
      isDefault: false,
      worktreePath: null,
      upstream: null,
      behind: 0,
      unpushed: 0,
      lastCommitTime: 0,
      mergedIntoDefault: true,
      ...over,
    };
  }

  it("builds each repository's working-branch rows from its settings window and cached open PRs", () => {
    settingsData = { workingBranchRecentDays: 30 };
    workingBranchesData = [
      {
        path: API,
        defaultBranch: "main",
        branches: [
          branch({ name: "main", isDefault: true, worktreePath: API }),
          branch({ name: "feat/x", unpushed: 2 }),
          branch({ name: "feat/old" }),
        ],
        error: null,
      },
    ];
    openPrsByRepo = { [API]: new Map([["feat/x", 12]]) };

    const { result } = renderHook(() => useSidebarTreeData());
    const rows = result.current.workingBranchRowsOf(API);
    expect(rows).toHaveLength(1);
    expect(rows[0].branch.name).toBe("feat/x");
    expect(rows[0].reasons).toEqual(["unpushed", "openPr"]);
    expect(rows[0].prNumber).toBe(12);
  });

  it("gives an empty list for a repository with no working-branch data yet", () => {
    const { result } = renderHook(() => useSidebarTreeData());
    expect(result.current.workingBranchRowsOf(API)).toEqual([]);
    expect(result.current.workingBranchRowsOf("/r/other")).toEqual([]);
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
