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
  useChangesVsDefaultOnHead: (entries: readonly unknown[]) => entries.map(() => ({ data: undefined })),
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
  it("re-renders only the rows whose selection changed", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommitGraph wips={[]} />
      </QueryClientProvider>,
    );
    expect(renders.get("c4")).toBe(1);
    act(() => useSelectionStore.getState().selectCommit("c2"));
    expect(renders.get("c2")).toBeGreaterThan(1);
    expect(renders.get("c1")).toBe(1);
    expect(renders.get("c4")).toBe(1);
  });
});
