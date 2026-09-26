// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import type { CommitInfo, RepoInfo } from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => vi.fn() }));

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("../GraphRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../GraphRow")>();
  return {
    ...actual,
    GraphRow: (props: Parameters<typeof actual.GraphRow>[0]) => {
      renders.set(props.commit.id, (renders.get(props.commit.id) ?? 0) + 1);
      return actual.GraphRow(props);
    },
  };
});

const REPO = "/work/app";

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

const history = { pages: [[commit("c1", ["c2"]), commit("c2", ["c3"]), commit("c3", ["c4"]), commit("c4", [])]] };

vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
  useCommitHistoryInfinite: () => ({
    data: history,
    isLoading: false,
    hasNextPage: false,
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

Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  renders.clear();
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
});
afterEach(cleanup);

describe("CommitGraph rows", () => {
  it("re-renders only the rows whose selection or highlighted chain actually changed", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommitGraph wips={[]} />
      </QueryClientProvider>,
    );
    expect(renders.get("c4")).toBe(1);
    // c1~c4는 한 줄기다. 첫 선택은 그 줄기 전체를 강조하므로(D6, 줄기 강조) 같은 줄기의 다른 행도
    // 함께 다시 그려진다 — 강조 없음(null) → 있음(그 줄기)으로 모든 행의 강조 상태가 바뀌기 때문이다.
    act(() => useSelectionStore.getState().selectCommit("c2"));
    expect(renders.get("c2")).toBeGreaterThan(1);
    const c1AfterFirstSelect = renders.get("c1")!;
    const c4AfterFirstSelect = renders.get("c4")!;
    // 같은 줄기 안에서 고르는 커밋만 바꾸면(c2 → c3) 강조 줄기 번호는 그대로라, 관련 없는 행
    // (c1, c4)은 다시 그려지지 않는다 — memo가 여전히 걸러낸다.
    act(() => useSelectionStore.getState().selectCommit("c3"));
    expect(renders.get("c3")).toBeGreaterThan(1);
    expect(renders.get("c1")).toBe(c1AfterFirstSelect);
    expect(renders.get("c4")).toBe(c4AfterFirstSelect);
  });
});
