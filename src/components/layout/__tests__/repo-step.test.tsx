// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useFollowStore } from "@/stores/follow";
import { useScopeStore } from "@/components/scope/scope-store";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import type { CommitInfo, RepoInfo, RepoReviewStatus, StatusEntry, WorkspaceRepoHistory } from "@/types";

vi.mock("@tanstack/react-virtual", async () => (await import("@/test/virtual-all")).virtualAllModule);
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/components/toolbar", () => ({ ToolbarRoot: () => <div>toolbar</div> }));
vi.mock("@/components/stash/StashView", () => ({ StashView: () => <div>stash-list</div> }));
vi.mock("@/components/actions/ActionsView", () => ({ ActionsView: () => <div>actions-list</div> }));
vi.mock("@/components/commit/ChangesView", () => ({ ChangesView: () => <div>changes-view</div> }));
vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));
vi.mock("@/components/history/CommitDetail", () => ({
  CommitDetail: ({ commit: c, repoPath, switcher }: { commit: CommitInfo; repoPath: string; switcher?: ReactNode }) => (
    <div>
      {switcher}
      <div>{`commit-detail ${repoPath} ${c.id}`}</div>
    </div>
  ),
}));
const openWorktree = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => openWorktree }));

const REPO = "/work/app";
const FEAT = "/work/app-feat";
const IDLE = "/work/app-idle";

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
    unpushedOids: [],
    error: null,
  };
}

const scan: RepoReviewStatus[] = [
  {
    repoPath: REPO,
    worktrees: [
      { path: REPO, branch: "main", headOid: "m1", isMain: true },
      { path: FEAT, branch: "feat/x", headOid: "f2", isMain: false },
      { path: IDLE, branch: "main", headOid: "m1", isMain: false },
    ],
  },
];
// main has its own tip commit, which must NOT be drawn: the lanes stop at the fork point.
const histories: Record<string, WorkspaceRepoHistory> = {
  [REPO]: history(REPO, "main", []),
  [FEAT]: history(FEAT, "feat/x", [commit("f2", 300), commit("f1", 200)]),
  [IDLE]: history(IDLE, "main", []),
};
const statuses: Record<string, StatusEntry[]> = {
  [FEAT]: [
    { path: "a.ts", status: "modified", staged: false },
    { path: "b.ts", status: "modified", staged: false },
  ] as StatusEntry[],
};
const historyCalls: string[][] = [];

vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
  useMergeState: () => ({ data: null }),
  useStatus: () => ({ data: [] }),
  useCommitHistoryInfinite: () => ({
    data: { pages: [[]] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useBranches: () => ({ data: branchList }),
  useRemoteTags: () => ({ data: undefined }),
  useWorktrees: () => ({
    data: [
      { path: REPO, head: "m1", branch: "main", isMain: true, base: null },
      { path: FEAT, head: "f2", branch: "feat/x", isMain: false, base: { name: "main", source: "recorded", aheadOfBase: 2, behindBase: 0 } },
    ],
  }),
  useRepoSyncStatuses: () => ({ data: {} }),
  useCachedRepoSyncStatus: () => undefined,
  useUnpushedCommits: () => ({ data: undefined }),
  useReviewStatusQuery: () => ({ data: scan, isLoading: false }),
  useDefaultBranches: () => ({ data: { [REPO]: { name: "main" } } }),
  useWorkingBranches: () => [undefined],
  useStashList: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: [] }),
  useFileDiff: () => ({ data: null, isLoading: false, isError: false }),
  useCommitDetail: (_path: string, oid: string) => ({
    data: { commit: commit(oid, 1), changedFiles: [] },
    isLoading: false,
    isError: false,
  }),
  useCommitFileDiff: () => ({ data: null }),
  useCommitAvatars: () => ({ data: {} }),
  useCommitStats: () => new Map(),
  useCommitStatsAcrossRepos: () => new Map(),
  commitStatsAcrossReposKey: (path: string, oid: string) => `${path}\u0000${oid}`,
  useWorkspaceHistories: (repos: { path: string }[]) => {
    historyCalls.push(repos.map((r) => r.path));
    return repos.map((r) => histories[r.path]);
  },
  useStatusMany: (paths: string[]) =>
    Object.fromEntries(paths.filter((p) => statuses[p]).map((p) => [p, statuses[p]])),
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
  useStashMutations: () => ({ push: { mutateAsync: vi.fn() } }),
  useUnpushedFileTouches: (targets: { path: string }[]) => {
    fileTouchTargets.push(targets);
    return targets.map(({ path }) => ({
      status: "success",
      data: { path, error: null, truncated: false, rangeBase: null, head: null, merges: 0, files: [] },
    }));
  },
  unpushedFileTouchesKey: (repoPath: string, path: string) => ["unpushedFileTouches", repoPath, path],
  useRangeFileDiff: () => ({ data: null, isLoading: false, isError: false }),
  useWipFilesMany: () => [],
  useSiblingFileDiffs: (sides: unknown[]) => sides.map(() => ({ data: undefined })),
}));

const branchList: { name: string; isHead: boolean; isRemote: boolean }[] = [];
const fileTouchTargets: unknown[][] = [];

const { MainColumn } = await import("@/components/layout/MainColumn");

const repo = { path: REPO, name: "app", currentBranch: "main", isDirty: false, remotes: [], accountId: null } as unknown as RepoInfo;
const CHIPS = "Worktrees to show together in the graph";

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MainColumn />
    </QueryClientProvider>,
  );
}

const commitIds = () => [...document.querySelectorAll("[data-commit-id]")].map((el) => el.getAttribute("data-commit-id"));
const paneLevel = () => screen.getByTestId("graph-pane").dataset.paneLevel;

Element.prototype.scrollIntoView = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("en");
  historyCalls.length = 0;
  fileTouchTargets.length = 0;
  branchList.length = 0;
  branchList.push({ name: "main", isHead: true, isRemote: false });
  useUIStore.setState({
    activeTab: "history",
    repoListOpen: false,
    reviewFileView: "commits",
    diffFileOpen: false,
    isDiffMaximized: false,
  });
  useSelectionStore.getState().clearAll();
  // 사이드바 저장소 줄을 누른 상태: 저장소 단계. 지금 연 워크트리는 메인 작업 트리다. 저장소를 먼저 정한다 —
  // 소유 저장소가 바뀌면 스코프 스토어가 저장소 단계 보기를 끈다.
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO, activeWorktrees: {} });
  useScopeStore.setState({ aggregateRepoPath: REPO, lastSelection: null, laneShown: {}, repoShown: {} });
  useFollowStore.getState().stop();
});

afterEach(cleanup);

describe("repository step: worktrees as lanes (5.1)", () => {
  it("draws the commits of each worktree since it forked, and stops at the base row", () => {
    renderShell();
    // Only the worktree's own commits: nothing from main's history below the fork point.
    expect(commitIds()).toEqual(["f2", "f1"]);
    expect(screen.getByTestId("repo-lane-base")).toBeTruthy();
    const rows = [...document.querySelectorAll("[data-commit-id], [data-testid='wip-row'], [data-testid='repo-lane-base']")];
    expect(rows.map((el) => el.getAttribute("data-commit-id") ?? el.getAttribute("data-testid"))).toEqual([
      "wip-row",
      "f2",
      "f1",
      "repo-lane-base",
    ]);
  });

  it("asks for each worktree's history by its own path", () => {
    renderShell();
    expect(historyCalls[historyCalls.length - 1]).toEqual([REPO, FEAT, IDLE]);
  });

  it("colours a worktree's lane by its path, like the worktree chip", () => {
    renderShell();
    const f2 = document.querySelector('[data-commit-id="f2"] circle');
    expect(f2?.getAttribute("fill")).toBe(repoLaneColor(FEAT));
  });

  it("keeps the repository step's tabs, with the graph tab as the lane viewer", () => {
    renderShell();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Commit graph", "Stash", "Actions"]);
    fireEvent.click(screen.getByRole("tab", { name: "Stash" }));
    expect(screen.getByText("stash-list")).toBeTruthy();
    expect(commitIds()).toEqual([]);
    fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    expect(screen.getByText("actions-list")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Commit graph" }));
    expect(commitIds()).toEqual(["f2", "f1"]);
  });

  it("offers the pull request tab when the repository has a remote", () => {
    const withRemote = { ...repo, remotes: [{ name: "origin", url: "git@github.com:o/app.git" }] } as unknown as RepoInfo;
    useRepositoryStore.setState({ repos: [withRemote], activeRepo: withRemote });
    renderShell();
    expect(screen.getByRole("tab", { name: "Pull requests" })).toBeTruthy();
  });

  it("starts the quiet worktree's chip off and turns a lane on and off with its chip", () => {
    renderShell();
    const chips = screen.getByRole("group", { name: CHIPS });
    const feat = within(chips).getByRole("button", { name: /feat\/x/ });
    expect(feat.getAttribute("aria-pressed")).toBe("true");
    // The idle worktree sits on main with nothing to push or commit: quiet, so off by default.
    const idle = within(chips).getAllByRole("button").filter((b) => b.textContent === "main")[1];
    expect(idle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(feat);
    expect(feat.getAttribute("aria-pressed")).toBe("false");
    expect(useScopeStore.getState().laneShown).toEqual({ [FEAT]: false });
    expect(commitIds()).toEqual([]);

    fireEvent.click(feat);
    expect(commitIds()).toEqual(["f2", "f1"]);
  });

  it("keeps the open worktree on, and shows only one other worktree from the chip menu", () => {
    useScopeStore.setState({ laneShown: { [FEAT]: false } });
    renderShell();
    const chips = screen.getByRole("group", { name: CHIPS });
    const buttons = within(chips).getAllByRole("button");
    const main = buttons.find((b) => b.textContent === "main")!;
    fireEvent.click(main);
    expect(main.getAttribute("aria-pressed")).toBe("true");

    fireEvent.contextMenu(buttons.find((b) => b.textContent === "feat/x")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Show only this one" }));
    expect(useScopeStore.getState().laneShown[FEAT]).toBe(true);
    expect(commitIds()).toEqual(["f2", "f1"]);
  });

  it("hides the chip row while there is a single worktree", () => {
    useScopeStore.setState({ laneShown: { [IDLE]: false } });
    // Only the main worktree is registered.
    scan[0] = { repoPath: REPO, worktrees: [scan[0].worktrees[0]] };
    try {
      renderShell();
      expect(screen.queryByRole("group", { name: CHIPS })).toBeNull();
      // Main alone: no commits since the fork point, only the base row.
      expect(commitIds()).toEqual([]);
      expect(screen.getByTestId("repo-lane-base")).toBeTruthy();
    } finally {
      scan[0] = {
        repoPath: REPO,
        worktrees: [
          { path: REPO, branch: "main", headOid: "m1", isMain: true },
          { path: FEAT, branch: "feat/x", headOid: "f2", isMain: false },
          { path: IDLE, branch: "main", headOid: "m1", isMain: false },
        ],
      };
    }
  });
});

describe("repository step: picking rows and the side panes (D47)", () => {
  it("opens the picked commit's detail for that worktree at level 1, without opening a diff", () => {
    renderShell();
    expect(screen.queryByTestId("pane-strip-bottom")).toBeNull();
    expect(paneLevel()).toBe("0");
    fireEvent.click(document.querySelector('[data-commit-id="f2"]') as HTMLElement);
    expect(screen.getByText(`commit-detail ${FEAT} f2`)).toBeTruthy();
    expect(paneLevel()).toBe("1");
    expect(useUIStore.getState().diffFileOpen).toBe(false);
    // The viewer owns this selection; the global one stays out of it.
    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
  });

  it("follows the worktree of a picked WIP row and lists its files at level 1", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /^feat\/x · Uncommitted changes · .* · 2 files$/ }));
    expect(useFollowStore.getState().target).toBe(FEAT);
    expect(screen.getByTestId("follow-panel")).toBeTruthy();
    expect(paneLevel()).toBe("1");
    expect(screen.queryByText("diff-viewer")).toBeNull();
  });

  it("switches between the worktree's working changes and its picked commit", () => {
    renderShell();
    fireEvent.click(document.querySelector('[data-commit-id="f2"]') as HTMLElement);
    const switcher = screen.getByTestId("work-switcher");
    fireEvent.click(within(switcher).getByRole("radio", { name: "Working changes 2" }));
    expect(useFollowStore.getState().target).toBe(FEAT);
    expect(screen.getByTestId("work-switcher").dataset.mode).toBe("working");
    fireEvent.click(within(screen.getByTestId("work-switcher")).getByRole("radio", { name: /^Commit f2/ }));
    expect(screen.getByText(`commit-detail ${FEAT} f2`)).toBeTruthy();
  });

  it("closes the side panes from the narrow list's expand button (level 0)", () => {
    renderShell();
    fireEvent.click(document.querySelector('[data-commit-id="f2"]') as HTMLElement);
    // A file is picked in the detail: the graph becomes the narrow list.
    act(() => useUIStore.getState().setDiffFileOpen(true));
    expect(paneLevel()).toBe("2");
    expect(screen.queryByRole("group", { name: CHIPS })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close and widen the graph" }));
    expect(paneLevel()).toBe("0");
    expect(screen.queryByText(`commit-detail ${FEAT} f2`)).toBeNull();
    expect(screen.getByRole("group", { name: CHIPS })).toBeTruthy();
  });

  it("leaves the per-file view without side panes and reads the shown worktrees", () => {
    useUIStore.setState({ reviewFileView: "files" });
    renderShell();
    expect(commitIds()).toEqual([]);
    expect(paneLevel()).toBe("0");
    expect(fileTouchTargets[fileTouchTargets.length - 1]).toEqual([
      { repoPath: REPO, path: REPO, worktreeLabel: null },
      { repoPath: REPO, path: FEAT, worktreeLabel: "feat/x" },
    ]);
  });

  it("opens the staging list from a WIP row's menu on the open worktree only", () => {
    useRepositoryStore.setState({ activeWorktrees: { [REPO]: FEAT }, activeRepoPath: FEAT });
    renderShell();
    fireEvent.contextMenu(screen.getByRole("button", { name: /^feat\/x · Uncommitted changes · .* · 2 files$/ }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((m) => m.textContent).slice(0, 3)).toEqual(["Show changes", "Stage and commit…", "Stash Changes"]);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Show changes" }));
    expect(useFollowStore.getState().target).toBe(FEAT);
  });
});

describe("repository step: the picked commit moves between scope steps", () => {
  it("comes in with the commit picked in the branch step selected", () => {
    useScopeStore.setState({ lastSelection: { laneId: FEAT, commitOid: "f1" } });
    renderShell();
    expect(screen.getByText(`commit-detail ${FEAT} f1`)).toBeTruthy();
    expect(paneLevel()).toBe("1");
  });

  it("does not pick anything when the remembered lane is not a worktree here", () => {
    useScopeStore.setState({ lastSelection: { laneId: "/elsewhere", commitOid: "f1" } });
    renderShell();
    expect(screen.queryByTestId("pane-strip-bottom")).toBeNull();
  });

  it("remembers the picked commit with its worktree path, and the branch step takes it over", () => {
    renderShell();
    fireEvent.click(document.querySelector('[data-commit-id="f1"]') as HTMLElement);
    expect(useScopeStore.getState().lastSelection).toEqual({ laneId: FEAT, commitOid: "f1" });

    // Clicking the worktree's folder row: the branch step for that worktree.
    act(() => {
      useScopeStore.setState({ aggregateRepoPath: null });
      useRepositoryStore.setState({ activeWorktrees: { [REPO]: FEAT }, activeRepoPath: FEAT });
    });
    expect(screen.queryByRole("group", { name: CHIPS })).toBeNull();
    expect(useSelectionStore.getState().selectedCommitId).toBe("f1");
  });

  it("keeps the commit picked in the branch step when going up to the repository step", () => {
    useScopeStore.setState({ aggregateRepoPath: null });
    useRepositoryStore.setState({ activeWorktrees: { [REPO]: FEAT }, activeRepoPath: FEAT });
    renderShell();
    act(() => useSelectionStore.getState().selectCommit("f2"));
    expect(useScopeStore.getState().lastSelection).toEqual({ laneId: FEAT, commitOid: "f2" });

    act(() => useScopeStore.setState({ aggregateRepoPath: REPO }));
    expect(screen.getByText(`commit-detail ${FEAT} f2`)).toBeTruthy();
    // The branch step's own selection is cleared so it cannot shadow the viewer's.
    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
    expect(useScopeStore.getState().lastSelection).toEqual({ laneId: FEAT, commitOid: "f2" });
  });
});
