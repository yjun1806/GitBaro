// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useUIStore } from "@/stores/ui";
import type { BranchCompareResult, BranchInfo, CommitInfo, RepoInfo } from "@/types";
import { useBranchRangeStore } from "../branch-range";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => vi.fn() }));

Element.prototype.scrollIntoView = vi.fn();

const REPO = "/work/app";

function commit(id: string, parentIds: string[]): CommitInfo {
  return {
    id,
    shortId: id,
    message: `subject ${id}`,
    summary: `subject ${id}`,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp: 1_700_000_000,
    parentIds,
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    isHead: false,
    isRemote: false,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
    ...extra,
  };
}

const comparisons: [string, string][] = [];
const DEFAULT_BRANCHES = [branch("main", { isHead: true, isDefault: true }), branch("feat/x")];
let branchList: BranchInfo[] = DEFAULT_BRANCHES;
const comparison: BranchCompareResult = {
  baseBranch: "main",
  compareBranch: "feat/x",
  aheadCount: 1,
  behindCount: 2,
  aheadCommits: [commit("m1", ["base"])],
  // feat/x에만 있는 커밋. f2의 부모 base는 범위 밖이다.
  behindCommits: [commit("f1", ["f2"]), commit("f2", ["base"])],
};

vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
  useStatusMany: () => ({}),
  useBranchComparison: (_path: string, base: string | null, target: string | null) => {
    if (base && target) comparisons.push([base, target]);
    return { data: comparison, isLoading: false, error: null };
  },
  useBranches: () => ({ data: branchList }),
  useStatus: () => ({ data: [] }),
  useWorktrees: () => ({ data: [] }),
  useCommitHistoryInfinite: () => ({
    data: { pages: [[commit("h1", ["h2"]), commit("h2", [])]] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useRemoteTags: () => ({ data: undefined }),
  useCommitAvatars: () => ({ data: {} }),
  useBranchDivergence: () => ({ data: [], isLoading: false }),
  // W6-T2 워크트리 칩·겹침 경고
  useWorktreeHeadHistories: () => [],
  useWipFilesMany: () => [],
  useSiblingFileDiffs: (sides: unknown[]) => sides.map(() => ({ data: undefined })),
}));

const { CommitGraph } = await import("@/components/graph/CommitGraph");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;

function renderGraph() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CommitGraph wips={[]} />
    </QueryClientProvider>,
  );
}

function commitRows(): string[] {
  return [...document.querySelectorAll("[data-commit-id]")].map((el) => el.getAttribute("data-commit-id") ?? "");
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  comparisons.length = 0;
  branchList = DEFAULT_BRANCHES;
  useUIStore.setState({ activeTab: "history" });
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  useBranchRangeStore.getState().clear();
});
afterEach(cleanup);

describe("CommitGraph range mode", () => {
  it("draws the whole history until a range is set, then only base..target", () => {
    renderGraph();
    expect(commitRows()).toEqual(["h1", "h2"]);

    act(() => useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" }));
    expect(commitRows()).toEqual(["f1", "f2"]);
    expect(screen.getByText("main..feat/x")).toBeTruthy();
    expect(screen.getByText("2 commits")).toBeTruthy();
    expect(comparisons[comparisons.length - 1]).toEqual(["main", "feat/x"]);
    // 범위 밖 부모(base)로 가는 레인이 열려 있지 않다: 마지막 행에 아래로 나가는 선이 없다.
    const last = document.querySelector('[data-commit-id="f2"] svg');
    expect(last?.querySelectorAll("path")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Swap direction" }));
    expect(screen.getByText("feat/x..main")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave range view" }));
    expect(commitRows()).toEqual(["h1", "h2"]);
  });

  it("selects a commit from the range", () => {
    useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" });
    renderGraph();
    fireEvent.click(document.querySelector('[data-commit-id="f2"]')!);
    expect(useSelectionStore.getState().selectedCommitId).toBe("f2");
  });

  it("drops the range when another repository is opened", () => {
    useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" });
    renderGraph();
    act(() => useRepositoryStore.setState({ activeRepoPath: "/work/other" }));
    expect(useBranchRangeStore.getState().range).toBeNull();
  });

  it("drops the range when its branch is renamed away instead of showing the compare error", () => {
    useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" });
    const { rerender } = renderGraph();
    expect(commitRows()).toEqual(["f1", "f2"]);

    branchList = [branch("main", { isHead: true, isDefault: true }), branch("feat/z")];
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CommitGraph wips={[]} />
      </QueryClientProvider>,
    );
    expect(useBranchRangeStore.getState().range).toBeNull();
    expect(commitRows()).toEqual(["h1", "h2"]);
  });

  it("drops the range when the worktree switches to another branch", () => {
    useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" });
    branchList = [branch("main", { isDefault: true }), branch("feat/x", { isHead: true })];
    renderGraph();
    expect(useBranchRangeStore.getState().range).toBeNull();
    expect(screen.queryByText("main..feat/x")).toBeNull();
  });
});
