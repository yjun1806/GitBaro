// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUnpushedRangeViewStore } from "../unpushed-range-view";
import type { CommitInfo, RepoInfo } from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => vi.fn() }));

const REPO = "/work/app";

function commit(id: string, parentIds: string[], extra: Partial<CommitInfo> = {}): CommitInfo {
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
    ...extra,
  };
}

/**
 * 지금의 커밋 목록. 테스트가 직접 바꾼다. `useCommitHistoryInfinite`가 매번 이 배열을 새 객체로
 * 감싸 돌려줘(`{ pages: [commits] }`) `historyData` 참조가 매 렌더 바뀌게 한다 — react-query가
 * 실제로 다시 가져온 뒤 하는 일과 같다. (다른 그래프 테스트의 mock은 `history` 객체 참조를 그대로
 * 돌려주므로 `rerender`로는 recompute가 강제되지 않는다 — 이 파일만의 의도된 차이다.)
 */
let commits: CommitInfo[] = [
  commit("c1", ["c2"], { isUnpushed: true }),
  commit("c2", ["c3"], { isUnpushed: true }),
  commit("c3", ["c4"], { isUnpushed: false }),
  commit("c4", [], { isUnpushed: false }),
];
const branches = [
  { name: "main", isHead: true, isRemote: false },
  { name: "origin/main", isHead: false, isRemote: true },
];

vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
  useCommitHistoryInfinite: () => ({
    data: { pages: [commits] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useBranches: () => ({ data: branches }),
  useStatus: () => ({ data: [] }),
  useWorktrees: () => ({ data: [] }),
  useRemoteTags: () => ({ data: undefined }),
  useCommitAvatars: () => ({ data: undefined }),
  useWorktreeHeadHistories: () => [],
}));

const { CommitGraph } = await import("../CommitGraph");

const repo = {
  path: REPO,
  name: "app",
  remotes: [{ name: "origin", url: "https://github.com/o/app.git" }],
  accountId: null,
} as unknown as RepoInfo;

Element.prototype.scrollIntoView = vi.fn();

function renderGraph() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CommitGraph wips={[]} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  commits = [
    commit("c1", ["c2"], { isUnpushed: true }),
    commit("c2", ["c3"], { isUnpushed: true }),
    commit("c3", ["c4"], { isUnpushed: false }),
    commit("c4", [], { isUnpushed: false }),
  ];
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  useUnpushedRangeViewStore.getState().close();
});

afterEach(cleanup);

describe("open unpushed range follows HEAD and the moving boundary (#2)", () => {
  it("moves the range's head to a newly landed commit without closing it", () => {
    const { rerender } = renderGraph();
    fireEvent.click(screen.getByRole("button", { name: "See everything to push" }));
    expect(useUnpushedRangeViewStore.getState().range).toMatchObject({ baseOid: "c3", headOid: "c1" });

    // 따라가는 중 새 커밋이 쌓인다(에이전트가 커밋함) — 아직 push 전이라 head가 거기로 옮겨가야 한다.
    commits = [commit("c0", ["c1"], { isUnpushed: true }), ...commits];
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CommitGraph wips={[]} />
      </QueryClientProvider>,
    );
    expect(useUnpushedRangeViewStore.getState().range).toMatchObject({ baseOid: "c3", headOid: "c0" });
    // 버튼의 눌림 상태도 지금 이 그래프에 속한 범위를 따라가야 한다.
    expect(screen.getByRole("button", { name: "See everything to push" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the range once every commit is pushed", () => {
    const { rerender } = renderGraph();
    fireEvent.click(screen.getByRole("button", { name: "See everything to push" }));
    expect(useUnpushedRangeViewStore.getState().range).not.toBeNull();

    commits = commits.map((c) => ({ ...c, isUnpushed: false }));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CommitGraph wips={[]} />
      </QueryClientProvider>,
    );
    expect(useUnpushedRangeViewStore.getState().range).toBeNull();
    expect(screen.queryByTestId("unpushed-header-row")).toBeNull();
  });
});
