// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useFollowStore } from "@/stores/follow";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import type {
  ActivityEvent,
  CommitInfo,
  RepoInfo,
  RepoReviewStatus,
  StatusEntry,
  WorkspaceRepoHistory,
} from "@/types";

const APP = "/w/xames-app";
const API = "/w/xames-backend";
const DESIGN = "/w/xames-design";
const API_WT = "/w/xames-backend-feat";

function commit(id: string, timestamp: number): CommitInfo {
  return {
    id,
    shortId: id,
    message: `subject ${id}`,
    summary: `subject ${id}`,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp,
    parentIds: [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

function history(path: string, branch: string, commits: CommitInfo[]): WorkspaceRepoHistory {
  return {
    path,
    branch,
    headOid: commits[0]?.id ?? "base",
    defaultBranch: "main",
    baseRef: "origin/main",
    baseStatus: "found",
    mergeBaseOid: "base",
    mergeBaseCommit: commit("base", 1),
    commits,
    truncated: false,
    error: null,
  };
}

const baseHistories = (): Record<string, WorkspaceRepoHistory> => ({
  [APP]: history(APP, "feat/noti", [commit("app2", 300), commit("app1", 100)]),
  [API]: history(API, "feat/noti", [commit("api1", 200)]),
  // main에 있고 원격에 없는 커밋도 WIP도 없음 → 숨김
  [DESIGN]: history(DESIGN, "main", []),
});
const baseReviewRepos = (): RepoReviewStatus[] => [
  { repoPath: APP, worktrees: [{ path: APP, branch: "feat/noti", headOid: "app2", isMain: true }] },
  {
    repoPath: API,
    worktrees: [
      { path: API, branch: "feat/noti", headOid: "api1", isMain: true },
      { path: API_WT, branch: "feat/api-wt", headOid: "x", isMain: false },
    ],
  },
  { repoPath: DESIGN, worktrees: [{ path: DESIGN, branch: "main", headOid: "base", isMain: true }] },
];
let reviewRepos = baseReviewRepos();
let histories = baseHistories();
const statuses: Record<string, StatusEntry[]> = {
  [API_WT]: [{ path: "src/settings.ts", status: "modified", staged: false } as StatusEntry],
};


const syncState = vi.hoisted(() => ({ byPath: {} as Record<string, { unpushed: number }> }));
vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
  useReviewStatusQuery: () => ({ data: reviewRepos, isLoading: false }),
  useWorkspaceHistories: (repos: { path: string }[]) => repos.map((r) => histories[r.path]),
  useStatusMany: (paths: string[]) =>
    Object.fromEntries(paths.filter((p) => statuses[p]).map((p) => [p, statuses[p]])),
  useRepoSyncStatuses: () => ({ data: syncState.byPath }),
  useCommitDetail: (_path: string, oid: string) => ({
    data: { commit: commit(oid, 1), changedFiles: [] },
    isLoading: false,
    isError: false,
  }),
  useCommitFileDiff: () => ({ data: null }),
  useFileDiff: () => ({ data: null, isLoading: false, isError: false }),
  // W6-T1 따라가기: WIP 행을 고르면 그 워크트리의 파일을 수정 시각 순으로 읽는다.
  useWipFiles: (path: string) => ({
    data: (statuses[path] ?? []).map((e) => ({
      path: e.path,
      origPath: null,
      status: e.status,
      staged: e.staged,
      unstaged: !e.staged,
      modifiedAt: 1,
      insertions: 1,
      deletions: 0,
    })),
    isLoading: false,
    isError: false,
  }),
  fetchFileDiff: () => new Promise(() => {}),
  useWorktrees: () => ({ data: [] }),
  // W6-T2 워크트리 칩·겹침 경고
  useWorktreeHeadHistories: () => [],
  useWipFilesMany: () => [],
  useSiblingFileDiffs: (sides: unknown[]) => sides.map(() => ({ data: undefined })),
}));

vi.mock("@/components/history/CommitDetail", () => ({
  CommitDetail: ({ commit: c, repoPath, switcher }: { commit: CommitInfo; repoPath: string; switcher?: ReactNode }) => (
    <div>
      {switcher}
      <div>{`commit-detail ${repoPath} ${c.id}`}</div>
    </div>
  ),
}));
vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));

type Handler = (event: { payload: ActivityEvent }) => void;
const handlers: Handler[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: Handler) => {
    handlers.push(handler);
    return () => {
      const i = handlers.indexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    };
  }),
}));

const { WorkspaceReview } = await import("../WorkspaceReview");

const repo = (path: string): RepoInfo =>
  ({
    path,
    name: path.split("/").pop(),
    currentBranch: "main",
    isDirty: false,
    remotes: [],
    accountId: null,
  }) as unknown as RepoInfo;

Element.prototype.scrollIntoView = vi.fn();

let client: QueryClient;

function renderReview() {
  client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceReview workspaceId="w1" paths={[APP, API, DESIGN]} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  syncState.byPath = {};
  handlers.length = 0;
  histories = baseHistories();
  reviewRepos = baseReviewRepos();
  useRepositoryStore.setState({ repos: [repo(APP), repo(API), repo(DESIGN)], activeRepo: null, activeRepoPath: null });
  useWorkspaceStore.setState({
    workspaces: [{ id: "w1", name: "xames", accountKey: "local", repoPaths: [APP, API, DESIGN] }],
    activeWorkspaceId: "w1",
  });
});

afterEach(cleanup);

const laneFill = (container: HTMLElement, commitId: string) =>
  container.querySelector(`[data-commit-id="${commitId}"] circle`)?.getAttribute("fill");

describe("WorkspaceReview", () => {
  it("titles the screen with workspace, account and how many repositories are shown", () => {
    renderReview();
    expect(screen.getByRole("heading", { name: "xames" })).toBeTruthy();
    expect(screen.getByText("Workspace · Local · showing 2 of 3 repositories")).toBeTruthy();
  });

  it("hides a quiet repository on main and shows it again with show all", () => {
    renderReview();
    const legend = screen.getByTestId("repo-legend");
    expect(within(legend).queryByText("xames-design")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all (1 hidden)" }));
    expect(within(legend).getByText("xames-design")).toBeTruthy();
    expect(screen.getByText("Workspace · Local · showing 3 of 3 repositories")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide quiet repositories" }));
    expect(within(legend).queryByText("xames-design")).toBeNull();
  });

  it("draws WIP rows and the base row", () => {
    renderReview();
    expect(screen.getByRole("button", { name: /^xames-backend · Uncommitted changes · .* branch · .* · 1 file$/ })).toBeTruthy();
    expect(screen.getByText("Where each repository branched off its default branch")).toBeTruthy();
  });

  it("does not repeat the unpushed commit count on the graph tab (the sidebar and Push show it)", () => {
    syncState.byPath = { [APP]: { unpushed: 2 }, [API]: { unpushed: 1 }, [API_WT]: { unpushed: 4 } };
    renderReview();
    expect(screen.getByText("Commit graph").textContent).toBe("Commit graph");
  });

  it("keeps each repository's lane colour when another repository is hidden or shown", () => {
    const { container } = renderReview();
    const before = { app: laneFill(container, "app1"), api: laneFill(container, "api1") };
    expect(before.app).toBe(repoLaneColor(APP));
    expect(before.api).toBe(repoLaneColor(API));
    fireEvent.click(screen.getByRole("button", { name: "Show all (1 hidden)" }));
    expect(laneFill(container, "app1")).toBe(before.app);
    expect(laneFill(container, "api1")).toBe(before.api);
  });

  it("has only the graph, as a plain title (one tab is no tab bar): no changes-vs-main tab", () => {
    renderReview();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("Commit graph").textContent).toBe("Commit graph");
    expect(screen.getByText("Where each repository branched off its default branch")).toBeTruthy();
  });

  it("shows a linked worktree once when it is also registered as a repository", () => {
    reviewRepos = [
      ...baseReviewRepos(),
      { repoPath: API_WT, worktrees: baseReviewRepos()[1].worktrees },
    ];
    histories = { ...baseHistories(), [API_WT]: history(API_WT, "feat/api-wt", [commit("api1", 200)]) };
    useRepositoryStore.setState({ repos: [repo(APP), repo(API), repo(DESIGN), repo(API_WT)] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceReview workspaceId="w1" paths={[APP, API, DESIGN, API_WT]} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("button", { name: /Uncommitted changes · .* · 1 file$/ })).toHaveLength(1);
  });

  it("reaches the activity log from the workspace header", async () => {
    const { useUIStore } = await import("@/stores/ui");
    useUIStore.setState({ isActivityLogOpen: false });
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("activity.title") }));
    expect(useUIStore.getState().isActivityLogOpen).toBe(true);
  });

  it("opens the commit detail of the picked repository", () => {
    const { container } = renderReview();
    fireEvent.click(container.querySelector('[data-commit-id="api1"]') as HTMLElement);
    expect(screen.getByText(`commit-detail ${API} api1`)).toBeTruthy();
  });

  it("follows the worktree of a picked WIP row and lists its uncommitted files", () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: /^xames-backend · Uncommitted changes · .* branch · .* · 1 file$/ }));
    expect(useFollowStore.getState().target).toBe(API_WT);
    expect(screen.getByText("settings.ts")).toBeTruthy();
    expect(screen.getByText("diff-viewer")).toBeTruthy();
    // 「따라가는 중」은 파일 목록 머리(FollowBadge)와 WIP 행의 따라가기 버튼에 각각 붙는다.
    expect(screen.getByTestId("follow-badge").textContent).toBe("Following");
    expect(screen.getByRole("button", { name: "Following · stop" })).toBeTruthy();
  });

  it("switches between a repository's working changes and its picked commit, keeping the mode visible", () => {
    const { container } = renderReview();
    fireEvent.click(container.querySelector('[data-commit-id="api1"]') as HTMLElement);
    const switcher = screen.getByTestId("work-switcher");
    expect(switcher.dataset.mode).toBe("commit");
    const commitSegment = within(switcher).getByRole("button", { name: /^Commit api1/ });
    expect(commitSegment.getAttribute("aria-pressed")).toBe("true");

    // 첫 칸: 그 저장소의 WIP 행(여기서는 워크트리 하나)으로 간다.
    fireEvent.click(within(switcher).getByRole("button", { name: "Working changes 1" }));
    expect(useFollowStore.getState().target).toBe(API_WT);
    expect(screen.getByTestId("work-switcher").dataset.mode).toBe("working");
    expect(screen.queryByText(`commit-detail ${API} api1`)).toBeNull();

    // 둘째 칸: 그 저장소에서 마지막으로 고른 커밋으로 돌아온다.
    fireEvent.click(within(screen.getByTestId("work-switcher")).getByRole("button", { name: /^Commit api1/ }));
    expect(screen.getByText(`commit-detail ${API} api1`)).toBeTruthy();
  });

  it("invalidates only the changed worktree's queries on repo:activity", async () => {
    renderReview();
    await act(async () => {});
    expect(handlers).toHaveLength(1);
    const spy = vi.spyOn(client, "invalidateQueries");
    act(() => handlers[0]({ payload: { path: API_WT, at: Date.now() } }));
    const keys = spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([
      ["status", API_WT],
      ["fileDiff", API_WT],
    ]);
    expect(keys.flat()).not.toContain(APP);
    expect(keys.flat()).not.toContain(API);
    spy.mockClear();
    act(() => handlers[0]({ payload: { path: "/somewhere/else", at: Date.now() } }));
    expect(spy).not.toHaveBeenCalled();
  });
  it("keeps a repository on main visible when only another worktree has commits no remote has", () => {
    const DESIGN_WT = "/w/xames-design-agent";
    reviewRepos[2] = {
      repoPath: DESIGN,
      worktrees: [
        { path: DESIGN, branch: "main", headOid: "base", isMain: true },
        { path: DESIGN_WT, branch: "feat/x", headOid: "w3", isMain: false },
      ],
    };
    syncState.byPath = { [DESIGN_WT]: { unpushed: 3 } };
    renderReview();
    expect(screen.getByText("Workspace · Local · showing 3 of 3 repositories")).toBeTruthy();
    expect(within(screen.getByTestId("repo-legend")).getByText("xames-design")).toBeTruthy();
  });

  it("says the repositories are hidden, not that there are no commits, when every one is quiet", () => {
    histories = {
      [APP]: history(APP, "main", []),
      [API]: history(API, "main", []),
      [DESIGN]: history(DESIGN, "main", []),
    };
    reviewRepos[0] = { repoPath: APP, worktrees: [{ path: APP, branch: "main", headOid: "base", isMain: true }] };
    reviewRepos[1] = { repoPath: API, worktrees: [{ path: API, branch: "main", headOid: "base", isMain: true }] };
    renderReview();
    expect(screen.getByText("Workspace · Local · showing 0 of 3 repositories")).toBeTruthy();
    expect(screen.getByText(/All 3 repositories are quiet and hidden/)).toBeTruthy();
    expect(screen.queryByText(/No commits since/)).toBeNull();
  });

  it("redraws ref labels when a refetch brings new refs for the same commits", () => {
    const { container, rerender } = renderReview();
    const row = () => container.querySelector('[data-commit-id="api1"]') as HTMLElement;
    expect(within(row()).queryByText("origin/feat/noti")).toBeNull();
    histories[API] = history(API, "feat/noti", [
      { ...commit("api1", 200), refs: [{ name: "origin/feat/noti", kind: "remoteBranch", isHead: false }] },
    ]);
    rerender(
      <QueryClientProvider client={client}>
        <WorkspaceReview workspaceId="w1" paths={[APP, API, DESIGN]} />
      </QueryClientProvider>,
    );
    expect(within(row()).getByText("origin/feat/noti")).toBeTruthy();
  });

  it("puts the title in the toolbar's title slot when there is one", () => {
    const slot = document.createElement("div");
    slot.setAttribute("data-toolbar-title-slot", "");
    document.body.appendChild(slot);
    try {
      renderReview();
      expect(within(slot).getByRole("heading", { name: "xames" })).toBeTruthy();
    } finally {
      cleanup();
      slot.remove();
    }
  });
});
