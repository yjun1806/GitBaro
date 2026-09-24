// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import "@/i18n/config";
import { buildRepoTree, type PathSignals, type Workspace } from "@/lib/repo-tree";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { BranchInfo, RepoInfo, RepoSyncStatus, WorktreeInfo } from "@/types";

vi.mock("@/api/commands", () => ({
  getWorktrees: vi.fn(),
  getBranches: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), ask: vi.fn() }));

import { getBranches, getWorktrees } from "@/api/commands";
import { useHistoryViewStore } from "@/stores/history-view";
import { RepoTree } from "../RepoTree";
import { SIDEBAR_WATCH_KEY, type SidebarTreeData } from "../useSidebarTreeData";

const NOW = 2_000_000_000_000;

const API = "/r/api";
const WEB = "/r/web";
const SOLO = "/r/solo";
const QUIET = "/r/quiet";
const WT = "/r/api/.worktrees/feat";
const QUIET_WT = "/r/quiet/.worktrees/spike";

function repo(path: string): RepoInfo {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    currentBranch: "main",
    isDirty: false,
    remotes: [{ name: "origin", url: `https://github.com/acme/${name}.git` }],
    accountId: null,
  };
}

const repos = [repo(API), repo(WEB), repo(SOLO), repo(QUIET)];
const workspaces: Workspace[] = [
  { id: "w1", name: "product", accountKey: "acme", repoPaths: [API, WEB] },
];

function makeData(
  signals: Record<string, PathSignals>,
  opts: {
    lastChangedAt?: Record<string, number>;
    watched?: string[];
    overflow?: string[];
    quietWorktree?: boolean;
  } = {},
): SidebarTreeData {
  const worktreesByRepo = {
    [API]: [{ path: WT, branch: "feat/login" }],
    ...(opts.quietWorktree ? { [QUIET]: [{ path: QUIET_WT, branch: "spike" }] } : {}),
  };
  const syncByPath: Record<string, RepoSyncStatus> = {};
  const branches: Record<string, string> = { [API]: "main", [WEB]: "fix/nav", [WT]: "feat/login", [SOLO]: "dev" };
  return {
    tree: buildRepoTree({
      repos,
      accounts: [],
      workspaces,
      orderByParent: {},
      sortModeByAccount: {},
      signals,
      worktreesByRepo,
      now: NOW,
    }),
    signals,
    syncByPath,
    reviewByPath: {},
    reviewRepos: [],
    worktreesByRepo,
    lastChangedAt: opts.lastChangedAt ?? {},
    watched: opts.watched ?? [],
    overflow: opts.overflow ?? [],
    now: NOW,
    branchOf: (p) => branches[p] ?? null,
  };
}

const worktreeInfos: WorktreeInfo[] = [
  {
    path: WT,
    head: "b",
    branch: "feat/login",
    isMain: false,
    isBare: false,
    isLocked: false,
    lockReason: null,
    isDirty: true,
    isPrunable: false,
    base: { name: "main", source: "recorded", aheadOfBase: 2, behindBase: 0 },
  },
];

function renderTree(data: SidebarTreeData, onSelectRepo = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RepoTree
        data={data}
        fetchingPath={null}
        onSelectRepo={onSelectRepo}
        onRepoContextMenu={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onSelectRepo, client };
}

const item = (name: string | RegExp) => screen.getByRole("treeitem", { name });
const PRIMARY_MAIN = "main · Primary folder";
const signal = (row: HTMLElement, kind: "dirty" | "ahead") => row.querySelector(`[data-signal="${kind}"]`);
const hoverCard = () => screen.queryByTestId("sidebar-hover-card");

function branch(name: string, over: Partial<BranchInfo> = {}): BranchInfo {
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
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(getWorktrees).mockReset();
  vi.mocked(getWorktrees).mockResolvedValue(worktreeInfos);
  vi.mocked(getBranches).mockReset();
  vi.mocked(getBranches).mockResolvedValue([branch("main", { isDefault: true }), branch("dev")]);
  useHistoryViewStore.setState({ repoPath: null, target: null });
  useRepositoryStore.setState({
    repos,
    activeRepoPath: null,
    activeRepo: null,
    activeWorktrees: {},
    favoriteRepos: [],
  });
  useActivityTargetsStore.setState({ extraByKey: {} });
  useWorkspaceStore.setState({ workspaces, collapsed: [], orderByParent: {}, sortModeByAccount: {} });
});

afterEach(cleanup);

// SOLO에만 신호를 주고 QUIET은 모두 0이라 조용한 저장소로 접힌다.
const baseSignals: Record<string, PathSignals> = {
  [API]: { dirtyCount: 2, newCommits: 1, ahead: 3, behind: 0 },
  [WT]: { dirtyCount: 1, newCommits: 4, ahead: 6 },
  [WEB]: { dirtyCount: 0, newCommits: 0 },
  [SOLO]: { dirtyCount: 0, newCommits: 0, ahead: 0, behind: 2 },
  [QUIET]: { dirtyCount: 0, newCommits: 0 },
};

describe("RepoTree — cards and levels", () => {
  it("puts each loose repository and each workspace in its own card under a plain account line", () => {
    renderTree(makeData(baseSignals));

    expect(item("acme")).toHaveAttribute("aria-level", "1");
    expect(item("product")).toHaveAttribute("aria-level", "2");
    expect(item("api")).toHaveAttribute("aria-level", "3");
    expect(item("web")).toHaveAttribute("aria-level", "3");
    expect(item("solo")).toHaveAttribute("aria-level", "2");
    // 계정 줄은 카드 밖, 저장소·워크스페이스 머리 줄은 흰 카드 안이다.
    expect(item("acme").closest(".bg-card")).toBeNull();
    expect(item("solo").closest(".bg-card")).not.toBeNull();
    expect(item("product").closest(".bg-card")).toBe(item("api").closest(".bg-card"));
    expect(item("solo").closest(".bg-card")).not.toBe(item("product").closest(".bg-card"));
  });

  it("lists one line per working folder by branch name, then the default branch as view only", async () => {
    renderTree(makeData(baseSignals));
    // 저장소 카드는 기본으로 펼쳐져 기본 폴더 줄이 보인다(폴더 이름이 아니라 브랜치 이름).
    expect(item("dev · Primary folder")).toHaveAttribute("aria-level", "3");
    // 어느 폴더도 main을 체크아웃하지 않았으므로 보기만 하는 main 줄이 뒤에 붙는다.
    const viewRow = await screen.findByRole("treeitem", { name: "View main (no checkout)" });
    expect(viewRow.querySelector(".font-mono")).toHaveTextContent("main");
    expect(
      item("dev · Primary folder").compareDocumentPosition(viewRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens a workspace repository's working folders inside the workspace card, one indent step in", async () => {
    const { onSelectRepo } = renderTree(makeData(baseSignals));
    expect(screen.queryByRole("treeitem", { name: "feat/login" })).toBeNull();
    fireEvent.click(item("api"));
    expect(onSelectRepo).toHaveBeenCalledWith(API);
    expect(item("api")).toHaveAttribute("aria-expanded", "true");
    expect(item(PRIMARY_MAIN)).toHaveAttribute("aria-level", "4");
    expect(item("feat/login")).toHaveAttribute("aria-level", "4");
    expect(item("feat/login").style.paddingLeft).toBe("16px");
    expect(item("api").style.paddingLeft).toBe("8px");
    // main은 기본 폴더가 체크아웃하고 있어 보기 줄이 따로 없다.
    await waitFor(() => expect(getBranches).toHaveBeenCalledWith(API));
    expect(screen.queryByRole("treeitem", { name: "View main (no checkout)" })).toBeNull();
    expect(item("feat/login").closest(".bg-card")).toBe(item("product").closest(".bg-card"));
  });

  it("keeps every row on one 28px line with equal left and right padding", () => {
    renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    for (const row of screen.getAllByRole("treeitem")) {
      expect(row.className).toContain("h-[var(--row)]");
      expect(row.style.paddingRight).toBe("8px");
    }
    expect(item("solo").style.paddingLeft).toBe("8px");
  });

  it("hides children when a node is folded and shows the fold state", () => {
    renderTree(makeData(baseSignals));
    expect(item("solo")).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(item("solo"), { key: "ArrowLeft" });
    expect(item("solo")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "dev · Primary folder" })).toBeNull();

    // 워크스페이스 머리 줄을 누르면 고르고(W4-T1), 접기는 ← 키나 ▾ 표시로 한다.
    fireEvent.keyDown(item("product"), { key: "ArrowLeft" });
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();
    expect(useWorkspaceStore.getState().collapsed).toEqual([`repo:${SOLO}`, "ws:w1"]);
  });

  it("selects the workspace when its header is clicked, without folding it", () => {
    renderTree(makeData(baseSignals));
    expect(item("product")).toHaveAttribute("aria-selected", "false");
    fireEvent.click(item("product"));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("w1");
    expect(item("product")).toHaveAttribute("aria-selected", "true");
    expect(item("product")).toHaveAttribute("aria-expanded", "true");
  });

  it("folds quiet repositories into one line and shows them as cards when opened", () => {
    renderTree(makeData(baseSignals));
    expect(screen.queryByRole("treeitem", { name: "quiet" })).toBeNull();
    fireEvent.click(item(/quiet repositor/));
    expect(item("quiet")).toHaveAttribute("aria-level", "2");
    expect(item("quiet").closest(".bg-card")).not.toBeNull();
  });
});

describe("RepoTree — signals", () => {
  it("shows at most an orange dot and a gray ↑N per row, with totals on a folded header", () => {
    renderTree(makeData(baseSignals));
    // 접힌 저장소 줄(api)은 작업 폴더 전체의 합계를 보인다.
    expect(signal(item("api"), "dirty")).toHaveAttribute("aria-label", "3 uncommitted files");
    expect(signal(item("api"), "ahead")).toHaveTextContent("↑9");

    fireEvent.click(item("api"));
    // 펴면 머리 줄의 합계는 사라지고 폴더 줄마다 자기 값을 보인다.
    expect(signal(item("api"), "dirty")).toBeNull();
    expect(signal(item(PRIMARY_MAIN), "dirty")).toHaveAttribute("aria-label", "2 uncommitted files");
    expect(signal(item(PRIMARY_MAIN), "ahead")).toHaveTextContent("↑3");
    expect(signal(item("feat/login"), "ahead")).toHaveTextContent("↑6");

    // 깨끗한 저장소는 아무 표시도 없다. 두 번째 줄 글(「수정 N · 새 커밋 N」)은 없다.
    expect(item("web").querySelectorAll("[data-signal]")).toHaveLength(0);
    expect(document.querySelector("[data-testid=row-meta]")).toBeNull();
  });

  it("rings the dot of recently changed rows, faded when the path is not watched live", () => {
    renderTree(
      makeData(baseSignals, {
        lastChangedAt: { [WEB]: NOW - 5_000, [SOLO]: NOW - 30_000 },
        watched: [API, WEB, WT, QUIET],
        overflow: [SOLO],
      }),
    );
    const webDot = within(item("web")).getByRole("img", { name: "Files changing now · 5s ago" });
    expect(webDot).toHaveAttribute("data-live", "true");
    expect(webDot).toHaveAttribute("data-watched", "true");
    const soloDot = within(item("dev · Primary folder")).getByRole("img", { name: /not watched live/ });
    expect(soloDot.className).toContain("opacity-40");
    expect(within(item("api")).queryByRole("img", { name: /changing now|not watched/ })).toBeNull();
  });

  it("does not mark changes older than 10 minutes as live", () => {
    renderTree(makeData(baseSignals, { lastChangedAt: { [WEB]: NOW - 11 * 60_000 } }));
    expect(within(item("web")).queryAllByRole("img")).toHaveLength(0);
  });
});

describe("RepoTree — hover card", () => {
  it("shows the details that no longer fit after a short delay, without taking clicks, and hides on leave", async () => {
    renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    fireEvent.mouseEnter(item(PRIMARY_MAIN));
    expect(hoverCard()).toBeNull();
    const card = await screen.findByTestId("sidebar-hover-card");
    expect(card.className).toContain("pointer-events-none");
    expect(card).toHaveTextContent("Primary folder");
    expect(card).toHaveTextContent(API);
    expect(card).toHaveTextContent("2 uncommitted files");
    expect(card).toHaveTextContent("3 commits to push");
    fireEvent.mouseLeave(item(PRIMARY_MAIN));
    expect(hoverCard()).toBeNull();
  });

  it("tells where a linked worktree branched from, reading bases once instead of on every worktree refresh", async () => {
    const { client } = renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    fireEvent.focus(item("feat/login"));
    const card = await screen.findByTestId("sidebar-hover-card");
    await waitFor(() => expect(card).toHaveTextContent("Branched from main"));
    expect(card).not.toHaveTextContent("Primary folder");
    const calls = vi.mocked(getWorktrees).mock.calls.length;
    expect(vi.mocked(getWorktrees).mock.calls.every(([p]) => p === API)).toBe(true);
    // useRepoWatcher가 git 폴더 변경마다 부르는 무효화
    await client.invalidateQueries({ queryKey: ["worktrees"] });
    expect(vi.mocked(getWorktrees).mock.calls.length).toBe(calls);
  });

  it("says a branch without upstream is not published yet and how much there is to pull", async () => {
    const data = makeData(baseSignals);
    data.syncByPath[SOLO] = {
      path: SOLO,
      branch: "dev",
      ahead: 0,
      behind: 2,
      hasUpstream: false,
      isDirty: false,
      dirtyCount: 0,
      dirtyLatestMtime: null,
    };
    renderTree(data);
    fireEvent.mouseEnter(item("dev · Primary folder"));
    const card = await screen.findByTestId("sidebar-hover-card");
    expect(card).toHaveTextContent("Not published yet");
    expect(card).toHaveTextContent("2 commits to pull");
  });
});

describe("RepoTree — search and selection", () => {
  it("opens the primary folder when a repository header or its primary line is clicked", () => {
    useRepositoryStore.setState({ activeWorktrees: { [API]: WT, [SOLO]: "/r/solo/.wt" } });
    const { onSelectRepo } = renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    expect(useRepositoryStore.getState().activeWorktrees[API]).toBeUndefined();
    expect(onSelectRepo).toHaveBeenCalledWith(API);
    fireEvent.click(item("dev · Primary folder"));
    expect(useRepositoryStore.getState().activeWorktrees[SOLO]).toBeUndefined();
    expect(onSelectRepo).toHaveBeenLastCalledWith(SOLO);
  });

  it("opens a worktree from its line", () => {
    const { onSelectRepo } = renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    fireEvent.click(item("feat/login"));
    expect(useRepositoryStore.getState().activeWorktrees[API]).toBe(WT);
    expect(onSelectRepo).toHaveBeenLastCalledWith(API);
  });

  it("views the default branch without checking it out from its view-only line", async () => {
    useRepositoryStore.setState({ activeRepoPath: SOLO, activeRepo: repos[2] });
    renderTree(makeData(baseSignals));
    expect(item("dev · Primary folder")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(await screen.findByRole("treeitem", { name: "View main (no checkout)" }));
    await waitFor(() =>
      expect(useHistoryViewStore.getState()).toMatchObject({
        repoPath: SOLO,
        target: { kind: "ref", name: "main", isRemote: false },
      }),
    );
    // 보는 동안 선택 표시는 보기 줄로 옮겨 간다.
    expect(item("View main (no checkout)")).toHaveAttribute("aria-selected", "true");
    expect(item("dev · Primary folder")).toHaveAttribute("aria-selected", "false");
  });

  it("filters by repository or branch name", () => {
    renderTree(makeData(baseSignals));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find repository or branch" }), {
      target: { value: "nav" },
    });
    expect(item("web")).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "solo" })).toBeNull();
  });

  it("collapses and expands everything, including accounts", () => {
    renderTree(makeData(baseSignals));
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();
    expect(item("acme")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(item("dev · Primary folder")).toBeInTheDocument();
  });

  it("has no separate changing-now section any more", () => {
    renderTree(makeData(baseSignals, { lastChangedAt: { [WT]: NOW - 12_000 } }));
    expect(screen.queryByRole("region", { name: /changing now/i })).toBeNull();
  });

  it("keeps the owning repository selected while its open worktree line is hidden", () => {
    useRepositoryStore.setState({ activeRepoPath: WT, activeRepo: repos[0], activeWorktrees: { [API]: WT } });
    renderTree(makeData(baseSignals));
    expect(item("api")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(item("api"), { key: "ArrowRight" });
    expect(item("feat/login")).toHaveAttribute("aria-selected", "true");
    expect(item("api")).toHaveAttribute("aria-selected", "false");
    // 선택 막대는 카드 안 줄 안쪽에 그린다.
    expect(within(item("feat/login")).getByTestId("selection-bar")).toBeInTheDocument();
  });

  it("marks favorite repositories", () => {
    useRepositoryStore.setState({ favoriteRepos: [SOLO] });
    renderTree(makeData(baseSignals));
    expect(within(item("solo")).getByRole("img", { name: "Favorite" })).toBeInTheDocument();
    expect(within(item("web")).queryByRole("img", { name: "Favorite" })).toBeNull();
  });

  it("opens the add-repository choice (clone or local folder) from the add button", () => {
    renderTree(makeData(baseSignals));
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Clone a Repository")).toBeInTheDocument();
    expect(within(dialog).getByText("Add Local Repository")).toBeInTheDocument();
  });
});

describe("RepoTree — watch targets", () => {
  const sidebarPaths = () => useActivityTargetsStore.getState().extraByKey[SIDEBAR_WATCH_KEY];

  it("registers worktrees shown on screen and drops them when their repository is folded", () => {
    renderTree(makeData(baseSignals));
    expect(sidebarPaths()).toEqual([]);
    fireEvent.keyDown(item("api"), { key: "ArrowRight" });
    expect(sidebarPaths()).toEqual([WT]);
    fireEvent.keyDown(item("api"), { key: "ArrowLeft" });
    expect(sidebarPaths()).toEqual([]);
  });

  it("adds a quiet repository's worktrees once the quiet line is opened", () => {
    renderTree(makeData({ ...baseSignals, [QUIET_WT]: { dirtyCount: 0 } }, { quietWorktree: true }));
    expect(sidebarPaths()).toEqual([]);
    fireEvent.click(item(/quiet repositor/));
    expect(sidebarPaths()).toEqual([QUIET_WT]);
  });

  it("adds worktrees of repositories that a search forces open", () => {
    renderTree(makeData(baseSignals));
    expect(sidebarPaths()).toEqual([]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find repository or branch" }), {
      target: { value: "login" },
    });
    expect(sidebarPaths()).toEqual([WT]);
  });
});
