// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useFollowStore } from "@/stores/follow";
import type { RepoInfo, StatusEntry } from "@/types";

// Heavy children talk to Tauri; the shell only decides which one to show.
vi.mock("@/components/toolbar", () => ({ ToolbarRoot: () => <div>toolbar</div> }));
// The commit graph renders for real; its one commit is titled "history-list"
// so picking it reads the same as picking a row of the old list.
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/components/stash/StashView", () => ({ StashView: () => <div>stash-list</div> }));
vi.mock("@/components/actions/ActionsView", () => ({ ActionsView: () => <div>actions-list</div> }));
vi.mock("@/components/commit/ChangesView", () => ({ ChangesView: () => <div>changes-view</div> }));
vi.mock("@/components/repository/RepoListView", () => ({ RepoListView: () => <div>repo-list</div> }));
vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));
vi.mock("@/components/stash/StashDetailView", () => ({ StashDetailView: () => <div>stash-detail</div> }));
vi.mock("@/components/actions/ActionsDetailView", () => ({ ActionsDetailView: () => <div>actions-detail</div> }));

const statusEntries: StatusEntry[] = [
  { path: "a.ts", status: "modified", staged: false },
  { path: "b.ts", status: "untracked", staged: false },
] as StatusEntry[];

const historyPages = {
  pages: [
    [
      {
        id: "c1",
        shortId: "c1",
        message: "history-list",
        summary: "history-list",
        author: { name: "YJ", email: "yj@example.com" },
        committer: { name: "YJ", email: "yj@example.com" },
        timestamp: 1_700_000_000,
        parentIds: [],
        refs: [],
        coAuthors: [],
        isAgentAuthored: false,
      },
    ],
  ],
};

/** 지금 연 저장소가 병합·pull 충돌 등으로 멈췄는지(`useMergeState`). */
let mergeStateValue: string | null = null;

vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
  useMergeState: () => ({ data: mergeStateValue }),
  useStatus: (path: string | null) => ({ data: path ? statusEntries : [] }),
  useCommitHistoryInfinite: () => ({
    data: historyPages,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useBranches: () => ({ data: [] }),
  useRemoteTags: () => ({ data: undefined }),
  useWorktrees: () => ({ data: [] }),
  useRepoSyncStatuses: () => ({ data: undefined }),
  // 크게 보기 머리 줄(작업 중인 변경)의 브랜치 이름.
  useCachedRepoSyncStatus: () => undefined,
  useUnpushedCommits: () => ({ data: undefined }),
  useReviewStatusQuery: () => ({ data: undefined, isLoading: false }),
  useStashList: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: [] }),
  useFileDiff: () => ({ data: null, isLoading: false, isError: false }),
  useCommitDetail: () => ({ data: undefined, isLoading: true }),
  useCommitFileDiff: () => ({ data: null }),
  useCommitAvatars: () => ({ data: {} }),
  // 커밋 그래프 「변경」 칸(3.15)
  useCommitStats: () => new Map(),
  useCommitStatsAcrossRepos: () => new Map(),
  commitStatsAcrossReposKey: (path: string, oid: string) => `${path}\u0000${oid}`,
  // W4-T3 워크스페이스 리뷰 화면
  useWorkspaceHistories: (repos: { path: string }[]) =>
    repos.map((r) => ({
      path: r.path,
      branch: "main",
      headOid: "c1",
      defaultBranch: "main",
      baseRef: "origin/main",
      baseStatus: "found",
      mergeBaseOid: "c1",
      mergeBaseCommit: null,
      commits: [],
      truncated: false,
      error: null,
    })),
  useStatusMany: () => ({}),
  // W6-T1 따라가기
  useWipFiles: () => ({
    data: [
      { path: "a.ts", origPath: null, status: "modified", staged: false, unstaged: true, modifiedAt: 1, insertions: 1, deletions: 0 },
    ],
    isLoading: false,
    isError: false,
  }),
  fetchFileDiff: () => new Promise(() => {}),
  useStashMutations: () => ({ push: { mutateAsync: vi.fn() } }),
  // 따라가기 줄의 「눈여겨볼 것」(D49)
  useUnpushedFileTouches: () => [{ status: "pending" }],
  // W6-T2 워크트리 칩·겹침 경고
  useWorktreeHeadHistories: () => [],
  useWipFilesMany: () => [],
  useSiblingFileDiffs: (sides: unknown[]) => sides.map(() => ({ data: undefined })),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const { MainColumn } = await import("@/components/layout/MainColumn");

const repo: RepoInfo = {
  path: "/work/app",
  name: "app",
  currentBranch: "main",
  isDirty: true,
  remotes: [],
  accountId: null,
} as RepoInfo;

function renderShell() {
  const client = new QueryClient();
  const tree = () => (
    <QueryClientProvider client={client}>
      <MainColumn />
    </QueryClientProvider>
  );
  const result = render(tree());
  /** 모의 조회 값이 바뀐 뒤 다시 그린다. */
  return { ...result, refresh: () => result.rerender(tree()) };
}

// jsdom has no scrollIntoView; the graph's keyboard nav scrolls the picked row into view.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useUIStore.setState({ activeTab: "changes", repoListOpen: false });
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: repo.path });
  useFollowStore.getState().stop();
  mergeStateValue = null;
});

afterEach(cleanup);

describe("MainColumn (two-column shell)", () => {
  it("shows an empty screen when no repository is selected", () => {
    useRepositoryStore.setState({ activeRepo: null, activeRepoPath: null });
    renderShell();
    expect(screen.getByText("No repository selected")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("changes-view")).toBeNull();
    // The toolbar stays so accounts and settings are still reachable.
    expect(screen.getByText("toolbar")).toBeTruthy();
  });

  it("follows the worktree when the uncommitted-changes row is picked, and opens the staging list from there", () => {
    useUIStore.setState({ activeTab: "history" });
    renderShell();
    expect(screen.queryByText("changes-view")).toBeNull();

    const row = screen.getByRole("button", { name: /^Uncommitted changes · .* · primary folder · 2 files$/ });
    fireEvent.click(row);

    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("follow-panel")).toBeTruthy();
    expect(screen.getAllByText("Following").length).toBeGreaterThan(0);
    expect(screen.queryByText("changes-view")).toBeNull();

    // The D4 footer: stage all / commit… / stash. "Commit…" ends following and shows the staging list.
    expect(screen.getByRole("button", { name: "Stage all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stash" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open staging" }));
    expect(useFollowStore.getState().target).toBeNull();
    expect(screen.getByText("changes-view")).toBeTruthy();
  });

  it("D47/5.4: folds the graph once following opens a file, and unfolds it from the folded pane", () => {
    renderShell();
    const graphPane = screen.getByTestId("graph-pane");
    expect(graphPane.dataset.paneLevel).toBe("1");
    expect(graphPane.style.width).toBe("46%");

    // 따라가기는 첫 파일을 스스로 고르므로(D49) 곧바로 2단계(접힌 그래프)로 간다.
    fireEvent.click(screen.getByRole("button", { name: /^Uncommitted changes · .* · primary folder · 2 files$/ }));
    expect(graphPane.dataset.paneLevel).toBe("2");
    expect(graphPane.style.width).toBe("120px");
    // 그래프 자체는 접혀도 그대로 화면에 있다(다시 마운트되지 않는다).
    expect(screen.getByRole("tablist")).toBeTruthy();

    // 접힌 그래프 칸을 누르면 지금 탭(변경)의 선택을 지우고 1단계로 되돌아간다.
    fireEvent.click(screen.getByRole("button", { name: "Back to the graph" }));
    expect(useFollowStore.getState().target).toBeNull();
    expect(graphPane.dataset.paneLevel).toBe("1");
    expect(graphPane.style.width).toBe("46%");
  });

  it("stops following and shows the staging list (conflict banner) once a merge or pull stops on a conflict", () => {
    const view = renderShell();
    fireEvent.click(screen.getByRole("button", { name: /^Uncommitted changes · .* · primary folder · 2 files$/ }));
    expect(screen.getByTestId("follow-panel")).toBeTruthy();

    // Pull hits a conflict: the toolbar only calls setActiveTab("changes"), which is already the tab.
    mergeStateValue = "merge";
    useUIStore.getState().setActiveTab("changes");
    view.refresh();
    expect(useFollowStore.getState().target).toBeNull();
    expect(screen.getByText("changes-view")).toBeTruthy();

    // Picking the row again during the merge still shows the staging list first.
    fireEvent.click(screen.getByRole("button", { name: /^Uncommitted changes · .* · primary folder · 2 files$/ }));
    expect(screen.queryByTestId("follow-panel")).toBeNull();
    expect(screen.getByText("changes-view")).toBeTruthy();
  });

  it("switches to the commit detail when a commit is picked, and back to changes via the row", () => {
    renderShell();
    fireEvent.click(screen.getByText("history-list"));
    expect(useUIStore.getState().activeTab).toBe("history");
    expect(screen.queryByText("changes-view")).toBeNull();
    // Commit detail is loading (mocked query).
    expect(screen.getByText("Loading history")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Uncommitted changes · .* · primary folder · 2 files$/ }));
    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
    expect(screen.getByTestId("follow-panel")).toBeTruthy();

    // Picking the same commit again still opens its detail.
    fireEvent.click(screen.getByText("history-list"));
    expect(useUIStore.getState().activeTab).toBe("history");
  });

  it("has three panel tabs that switch the list and the area below", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Commit graph", "Stash", "Actions"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("history-list")).toBeTruthy();

    fireEvent.click(tabs[1]);
    expect(screen.getByText("stash-list")).toBeTruthy();
    expect(screen.queryByText("history-list")).toBeNull();
    expect(screen.getByText("No stash selected")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(screen.getByText("actions-list")).toBeTruthy();
    act(() => useSelectionStore.getState().selectRun(7));
    expect(screen.getByText("actions-detail")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("tab")[0]);
    expect(screen.getByText("history-list")).toBeTruthy();
    // No commit picked yet, so the graph tab opens on the uncommitted changes.
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(screen.getByText("changes-view")).toBeTruthy();
  });

  it("blocks the staging list and the diff while a branch switch runs", () => {
    renderShell();
    // D47/5.4: the diff pane only exists once a file is picked (2단계) — pick one first.
    act(() => useSelectionStore.getState().selectFile("a.ts", false));
    act(() => useUIStore.getState().setSwitchingBranch(true));
    try {
      const changesCard = screen.getByText("changes-view").closest("section");
      expect(changesCard?.querySelector(".animate-spin")).toBeTruthy();
      const diffCard = screen.getByText("diff-viewer").closest("section");
      expect(diffCard?.querySelector(".animate-spin")).toBeTruthy();
    } finally {
      act(() => useUIStore.getState().setSwitchingBranch(false));
    }
  });

  it("keeps the stash tab when the panel remounts with an old commit selection", () => {
    const { unmount } = renderShell();
    fireEvent.click(screen.getByText("history-list"));
    fireEvent.click(screen.getByRole("tab", { name: "Stash" }));
    expect(useUIStore.getState().activeTab).toBe("stash");
    expect(useSelectionStore.getState().selectedCommitId).toBe("c1");
    unmount();

    // Opening and closing the repository list remounts the panel.
    renderShell();
    expect(useUIStore.getState().activeTab).toBe("stash");
    expect(screen.getByText("stash-list")).toBeTruthy();
  });

  it("names the stash tab 스태시 in Korean", async () => {
    await i18n.changeLanguage("ko");
    renderShell();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "커밋 그래프",
      "스태시",
      "Actions",
    ]);
  });

  it("replaces the panels with the repository list while it is open", () => {
    useUIStore.setState({ repoListOpen: true });
    renderShell();
    expect(screen.getByText("repo-list")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close repository list" }));
    expect(useUIStore.getState().repoListOpen).toBe(false);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});

describe("MainColumn — workspace scope (W4-T1)", () => {
  it("mounts no repository-only screen while a workspace is picked, and back again", async () => {
    const { useWorkspaceStore } = await import("@/stores/workspace");
    useWorkspaceStore.setState({
      // 원격도 계정도 없는 저장소는 사이드바에서 "Local" 아래에 있다. 워크스페이스도 그 계정 안에 둔다.
      workspaces: [{ id: "w1", name: "xames", accountKey: "local", repoPaths: [repo.path] }],
      activeWorkspaceId: null,
    });
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace("w1");
    });
    expect(useRepositoryStore.getState().activeRepoPath).toBeNull();

    renderShell();
    // 워크스페이스 리뷰 화면(W4-T3): 제목과 「저장소 N개 중 M개 표시」. main에 있고 새 커밋·변경이
    // 없는 저장소는 숨긴다(질문 2).
    expect(screen.getByRole("heading", { name: "xames" })).toBeTruthy();
    expect(screen.getByText("Workspace · Local · showing 0 of 1 repository")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all (1 hidden)" })).toBeTruthy();
    // 모두 숨겼을 때는 「커밋 없음」이 아니라 숨긴 저장소가 있다고 알린다.
    expect(screen.getByText(/1 quiet repository is hidden/)).toBeTruthy();
    // 워크스페이스 화면에도 커밋 그래프 탭이 있지만, 저장소 전용 탭(스태시)은 없다.
    expect(screen.queryByRole("tab", { name: "Stash" })).toBeNull();
    expect(screen.queryByText("changes-view")).toBeNull();
    expect(screen.queryByText("No repository selected")).toBeNull();

    act(() => useRepositoryStore.getState().setActiveRepo(repo.path));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(screen.getByRole("tab", { name: "Stash" })).toBeTruthy();
  });
});
