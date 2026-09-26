// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useFollowStore } from "@/stores/follow";
import type { CommitInfo, RepoInfo } from "@/types";
import { insertedCommitIds } from "../useNewCommits";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => vi.fn() }));

const REPO = "/work/app";
const OTHER = "/work/other";

function commit(id: string, parentIds: string[]): CommitInfo {
  return {
    id,
    shortId: id,
    message: id,
    summary: id,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp: 1_700_000_000,
    parentIds,
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

/** 커밋 목록 응답. 테스트가 새 객체로 바꾸고 다시 그리면 react-query가 새 데이터를 준 것과 같다. */
const historyState = vi.hoisted(() => ({ data: { pages: [[]] as CommitInfo[][] }, hasNextPage: false }));

vi.mock("@/api/queries", () => ({
  useChangesVsDefaultOnHead: (entries: readonly unknown[]) => entries.map(() => ({ data: undefined })),
  useCommitHistoryInfinite: () => ({
    data: historyState.data,
    isLoading: false,
    hasNextPage: historyState.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useBranches: () => ({ data: [] }),
  useStatus: () => ({ data: [] }),
  useWorktrees: () => ({ data: [] }),
  useRemoteTags: () => ({ data: undefined }),
  useCommitAvatars: () => ({ data: undefined }),
  useWorktreeHeadHistories: () => [],
}));

const { CommitGraph } = await import("../CommitGraph");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;
const other = { path: OTHER, name: "other", remotes: [], accountId: null } as unknown as RepoInfo;

Element.prototype.scrollIntoView = vi.fn();

const base = () => [commit("c1", ["c2"]), commit("c2", ["c3"]), commit("c3", [])];
const view = () => (
  <QueryClientProvider client={new QueryClient()}>
    <CommitGraph wips={[]} />
  </QueryClientProvider>
);
const flashed = () =>
  [...document.querySelectorAll("[data-testid=commit-flash]")].map((el) =>
    el.closest("[data-commit-id]")?.getAttribute("data-commit-id"),
  );

beforeEach(() => {
  historyState.data = { pages: [base()] };
  historyState.hasNextPage = false;
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo, other], activeRepo: repo, activeRepoPath: REPO });
  useFollowStore.getState().start(REPO);
});
afterEach(() => {
  cleanup();
  useFollowStore.getState().stop();
});

describe("insertedCommitIds", () => {
  const seen = new Set(["c1", "c2", "c3"]);

  it("returns commits that appeared above the ones already seen, in list order", () => {
    expect(insertedCommitIds(seen, ["n2", "n1", "c1", "c2", "c3"])).toEqual(["n2", "n1"]);
  });

  it("ignores commits appended below the last seen one (the next page)", () => {
    expect(insertedCommitIds(seen, ["c1", "c2", "c3", "c4", "c5"])).toEqual([]);
    // 위에 새 커밋, 아래에 다음 페이지가 함께 와도 위쪽만 센다.
    expect(insertedCommitIds(seen, ["n1", "c1", "c2", "c3", "c4"])).toEqual(["n1"]);
  });

  it("counts a commit inserted between seen ones (another worktree's newer commit)", () => {
    expect(insertedCommitIds(seen, ["c1", "f1", "c2", "c3"])).toEqual(["f1"]);
  });

  it("treats a list with nothing in common as a different history, not as new commits", () => {
    expect(insertedCommitIds(seen, ["x1", "x2"])).toEqual([]);
    expect(insertedCommitIds(new Set(), ["c1"])).toEqual([]);
  });
});

describe("CommitGraph new-commit cue", () => {
  it("flashes only the commit that just arrived while following, and only once", () => {
    const { rerender } = render(view());
    expect(flashed()).toEqual([]);

    historyState.data = { pages: [[commit("c0", ["c1"]), ...base()]] };
    rerender(view());
    expect(flashed()).toEqual(["c0"]);
    const overlay = document.querySelector("[data-testid=commit-flash]");

    // Re-rendering (a selection change, a refetch with the same commits) keeps the same overlay: no replay.
    rerender(view());
    expect(flashed()).toEqual(["c0"]);
    expect(document.querySelector("[data-testid=commit-flash]")).toBe(overlay);
  });

  it("does not flash the next page of older commits", () => {
    historyState.hasNextPage = true;
    const { rerender } = render(view());
    historyState.data = { pages: [base(), [commit("c4", ["c5"]), commit("c5", [])]] };
    rerender(view());
    expect(flashed()).toEqual([]);
  });

  it("does not flash when nothing is being followed", () => {
    useFollowStore.getState().stop();
    const { rerender } = render(view());
    historyState.data = { pages: [[commit("c0", ["c1"]), ...base()]] };
    rerender(view());
    expect(flashed()).toEqual([]);
  });

  it("does not flash a whole new history after switching repositories", () => {
    const { rerender } = render(view());
    useRepositoryStore.setState({ activeRepo: other, activeRepoPath: OTHER });
    useFollowStore.getState().start(OTHER);
    historyState.data = { pages: [[commit("o1", ["o2"]), commit("o2", [])]] };
    rerender(view());
    expect(flashed()).toEqual([]);

    // A commit that lands in the new repository afterwards does flash.
    historyState.data = { pages: [[commit("o0", ["o1"]), commit("o1", ["o2"]), commit("o2", [])]] };
    rerender(view());
    expect(flashed()).toEqual(["o0"]);
  });
});
