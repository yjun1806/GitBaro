// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRepositoryStore } from "@/stores/repository";
import type { RepoInfo, StatusEntry } from "@/types";

const REPO = "/r/app";

vi.mock("@/hooks/useReviewStatus", () => ({
  useReviewStatus: () => ({
    repos: [{ repoPath: REPO, worktrees: [{ path: REPO, branch: "main", headOid: "a", isMain: true }] }],
    byPath: {},
  }),
}));
vi.mock("@/hooks/useCurrentBranch", () => ({ useCurrentBranch: () => "main" }));
vi.mock("@/api/queries", () => ({
  useRepoSyncStatuses: () => ({ data: {} }),
  useStatus: () => ({
    data: [
      { path: "a.ts", status: "modified", staged: true },
      { path: "a.ts", status: "modified", staged: false },
      { path: "b.ts", status: "untracked", staged: false },
    ] as StatusEntry[],
  }),
}));

const { useGraphReview } = await import("../useGraphReview");

const repo = { path: REPO, name: "app", currentBranch: "main", isDirty: true, remotes: [], accountId: null } as RepoInfo;

describe("useGraphReview", () => {
  beforeEach(() => {
    useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  });

  it("counts a partially staged file once in the current worktree's WIP row", () => {
    const { result } = renderHook(() => useGraphReview());
    expect(result.current.wips.find((w) => w.isCurrent)?.count).toBe(2);
  });
});
