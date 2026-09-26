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
/** 함께 그리는 다른 워크트리의 이력 조회 결과(`useWorktreeHeadHistories`). 기본은 빈 배열(다른 워크트리 없음). */
const otherHistoryState = vi.hoisted(() => ({
  queries: [] as { data: CommitInfo[] | undefined; isSuccess: boolean; dataUpdatedAt: number }[],
}));

vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
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
  useWorktreeHeadHistories: () => otherHistoryState.queries,
  useCommitStats: () => new Map(),
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
  otherHistoryState.queries = [];
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

describe("CommitGraph new-commit cue with another worktree drawn together (#5)", () => {
  const FEAT = "/work/feat";
  const at = (c: CommitInfo, timestamp: number): CommitInfo => ({ ...c, timestamp });
  const viewWithFeat = () => (
    <QueryClientProvider client={new QueryClient()}>
      <CommitGraph wips={[]} worktreeHeads={[{ path: FEAT, head: "f1" }]} />
    </QueryClientProvider>
  );

  beforeEach(() => {
    // 자신의 이력: c1(최신) · c2 · c3(가장 오래됨). feat의 f1은 c2와 c3 사이에 낄 시각으로 나중에 온다.
    historyState.data = { pages: [[at(commit("c1", ["c2"]), 300), at(commit("c2", ["c3"]), 200), at(commit("c3", []), 100)]] };
    // 처음에는 feat의 이력을 아직 불러오지 못한 상태(isSuccess: false).
    otherHistoryState.queries = [{ data: undefined, isSuccess: false, dataUpdatedAt: 0 }];
  });

  it("does not flash another worktree's commit that only arrives once its history finishes loading", () => {
    const { rerender } = render(viewWithFeat());
    expect(flashed()).toEqual([]);

    // feat의 이력이 늦게 도착 — 시간순으로 c2와 c3 사이에 f1이 끼어든다.
    otherHistoryState.queries = [{ data: [at(commit("f1", []), 150)], isSuccess: true, dataUpdatedAt: 1 }];
    rerender(viewWithFeat());
    expect(flashed()).toEqual([]);

    // 그 뒤로는 평소처럼: 자신의 이력에 진짜 새 커밋(c0)이 생기면 그것만 비춘다.
    historyState.data = {
      pages: [[at(commit("c0", ["c1"]), 400), at(commit("c1", ["c2"]), 300), at(commit("c2", ["c3"]), 200), at(commit("c3", []), 100)]],
    };
    rerender(viewWithFeat());
    expect(flashed()).toEqual(["c0"]);
  });

  it("records but does not flash while another worktree's history is still loading, across separate renders", () => {
    const { rerender } = render(viewWithFeat());
    // 아직 feat 이력을 불러오는 중 — 다시 그려도(예: 다른 상태 변화) 비추지 않는다.
    rerender(viewWithFeat());
    expect(flashed()).toEqual([]);

    otherHistoryState.queries = [{ data: [at(commit("f1", []), 150)], isSuccess: true, dataUpdatedAt: 1 }];
    rerender(viewWithFeat());
    expect(flashed()).toEqual([]);
  });
});
