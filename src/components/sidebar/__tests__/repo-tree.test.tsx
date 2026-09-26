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
  removeWorktree: vi.fn(async () => {}),
  getStatus: vi.fn(async () => []),
  switchBranch: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), ask: vi.fn() }));

import { getBranches, getWorktrees } from "@/api/commands";
import { useHistoryViewStore } from "@/stores/history-view";
import { RepoTree } from "../RepoTree";
import type { WorkingBranchRow } from "../tree-model";
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
    /** 저장소 경로별 작업 중인 브랜치 줄(`workingBranchRowsOf`가 그대로 돌려준다). */
    workingBranches?: Record<string, WorkingBranchRow[]>;
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
    workingBranchRowsOf: (p) => opts.workingBranches?.[p] ?? [],
  };
}

/** 사이드바 작업 중인 브랜치 줄 하나(테스트 재료). 기본은 「원격에 없는 커밋」 이유다. */
function wbRow(name: string, over: Partial<WorkingBranchRow> = {}): WorkingBranchRow {
  return {
    branch: {
      name,
      isDefault: false,
      worktreePath: null,
      upstream: null,
      behind: 0,
      unpushed: 1,
      lastCommitTime: 0,
      mergedIntoDefault: false,
    },
    reasons: ["unpushed"],
    prNumber: null,
    ...over,
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
const signal = (row: HTMLElement, kind: "dirty" | "ahead" | "behind") => row.querySelector(`[data-signal="${kind}"]`);
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
    repoPrefs: {},
  });
  useActivityTargetsStore.setState({ extraByKey: {} });
  useWorkspaceStore.setState({ workspaces, collapsed: [], orderByParent: {}, sortModeByAccount: {} });
});

afterEach(cleanup);

// SOLO에만 신호를 주고 QUIET은 모두 0이라 조용한 저장소로 접힌다.
const baseSignals: Record<string, PathSignals> = {
  [API]: { dirtyCount: 2, ahead: 3, behind: 0 },
  [WT]: { dirtyCount: 1, ahead: 6 },
  [WEB]: { dirtyCount: 0 },
  [SOLO]: { dirtyCount: 0, ahead: 0, behind: 2 },
  [QUIET]: { dirtyCount: 0 },
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

  it("lists one line per working folder by branch name, with no row for the default branch", () => {
    renderTree(makeData(baseSignals));
    // 저장소 카드는 기본으로 펼쳐져 기본 폴더 줄이 보인다(폴더 이름이 아니라 브랜치 이름).
    expect(item("dev · Primary folder")).toHaveAttribute("aria-level", "3");
    // 어느 폴더도 main을 체크아웃하지 않아도, main(기본 브랜치)은 줄을 따로 갖지 않는다(저장소 줄이 대신한다).
    expect(screen.queryByRole("treeitem", { name: "main" })).toBeNull();
  });

  it("lists a working-branch row after the folder rows for a branch nothing has checked out", async () => {
    renderTree(makeData(baseSignals, { workingBranches: { [SOLO]: [wbRow("feat/spike")] } }));
    const row = await screen.findByRole("treeitem", { name: "feat/spike" });
    expect(row.querySelector(".font-mono")).toHaveTextContent("feat/spike");
    expect(
      item("dev · Primary folder").compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("indents a workspace's repositories one step and their working folders two steps", async () => {
    const { onSelectRepo } = renderTree(makeData(baseSignals));
    expect(screen.queryByRole("treeitem", { name: "feat/login" })).toBeNull();
    fireEvent.click(item("api"));
    expect(onSelectRepo).toHaveBeenCalledWith(API);
    expect(item("api")).toHaveAttribute("aria-expanded", "true");
    expect(item(PRIMARY_MAIN)).toHaveAttribute("aria-level", "4");
    expect(item("feat/login")).toHaveAttribute("aria-level", "4");
    expect(item("feat/login").style.paddingLeft).toBe("32px");
    expect(item("api").style.paddingLeft).toBe("20px");
    expect(item("product").style.paddingLeft).toBe("8px");
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

describe("RepoTree — working branches", () => {
  it("mutes the name and shows its own ↓↑ counts, regardless of the reason", async () => {
    renderTree(
      makeData(baseSignals, {
        workingBranches: {
          [SOLO]: [
            wbRow("feat/spike", {
              branch: {
                name: "feat/spike",
                isDefault: false,
                worktreePath: null,
                upstream: null,
                behind: 3,
                unpushed: 2,
                lastCommitTime: 0,
                mergedIntoDefault: false,
              },
            }),
          ],
        },
      }),
    );
    const row = await screen.findByRole("treeitem", { name: "feat/spike" });
    expect(row.querySelector(".font-mono")).toHaveClass("text-muted-foreground");
    expect(row.querySelector("svg.lucide-git-branch")).toBeTruthy();
    expect(row.querySelector("svg.lucide-git-pull-request")).toBeFalsy();
    expect(signal(row, "behind")).toHaveTextContent("↓3");
    expect(signal(row, "ahead")).toHaveTextContent("↑2");
    // 이 줄에는 워크트리가 없어 커밋 안 한 파일 점은 없다.
    expect(signal(row, "dirty")).toBeNull();
  });

  it("swaps the branch icon for the PR icon when the row has an open PR", async () => {
    renderTree(makeData(baseSignals, { workingBranches: { [SOLO]: [wbRow("feat/pr", { reasons: ["openPr"], prNumber: 58 })] } }));
    const row = await screen.findByRole("treeitem", { name: "feat/pr" });
    expect(row.querySelector("svg.lucide-git-pull-request")).toBeTruthy();
    expect(row.querySelector("svg.lucide-git-branch")).toBeFalsy();
  });

  it("shows a working-branch row for one repository while another with no data shows none", async () => {
    renderTree(makeData(baseSignals, { workingBranches: { [SOLO]: [wbRow("feat/spike")] } }));
    expect(await screen.findByRole("treeitem", { name: "feat/spike" })).toBeInTheDocument();
    // API에는 자료를 주지 않았다 — 그 저장소 카드를 펴도 작업 폴더 줄(feat/login)만 있고 다른 줄은 없다.
    fireEvent.click(item("api"));
    expect(item("feat/login")).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem", { name: "feat/spike" })).toHaveLength(1);
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

  it("closes the card when its row goes away, and does not open it for a row that is already gone", async () => {
    renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    fireEvent.mouseEnter(item(PRIMARY_MAIN));
    await screen.findByTestId("sidebar-hover-card");
    // Folding the card unmounts the row without a mouseleave.
    fireEvent.keyDown(item("api"), { key: "ArrowLeft" });
    await waitFor(() => expect(hoverCard()).toBeNull());

    fireEvent.keyDown(item("api"), { key: "ArrowRight" });
    fireEvent.mouseEnter(item(PRIMARY_MAIN));
    fireEvent.keyDown(item("api"), { key: "ArrowLeft" });
    await new Promise((r) => setTimeout(r, 450));
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
      unpushed: 0,
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

  it("views a working branch without checking it out from its row", async () => {
    useRepositoryStore.setState({ activeRepoPath: SOLO, activeRepo: repos[2] });
    renderTree(makeData(baseSignals, { workingBranches: { [SOLO]: [wbRow("feat/spike")] } }));
    expect(item("dev · Primary folder")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(await screen.findByRole("treeitem", { name: "feat/spike" }));
    await waitFor(() =>
      expect(useHistoryViewStore.getState()).toMatchObject({
        repoPath: SOLO,
        target: { kind: "ref", name: "feat/spike", isRemote: false },
      }),
    );
    // 보는 동안 선택 표시는 그 줄로 옮겨 간다.
    expect(item("feat/spike")).toHaveAttribute("aria-selected", "true");
    expect(item("dev · Primary folder")).toHaveAttribute("aria-selected", "false");
  });

  it("filters by repository or branch name", () => {
    renderTree(makeData(baseSignals));
    fireEvent.change(screen.getByRole("textbox", { name: "Find repository or branch" }), {
      target: { value: "nav" },
    });
    expect(item("web")).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "solo" })).toBeNull();
  });

  it("shows a repository's display name instead of its folder name, and finds it by either", async () => {
    useRepositoryStore.setState({ repoPrefs: { [SOLO]: { alias: "Solo App" } } });
    renderTree(makeData(baseSignals));
    expect(item("Solo App")).toHaveAttribute("aria-level", "2");
    expect(screen.queryByRole("treeitem", { name: "solo" })).toBeNull();

    // 머리 줄에 올리면 표시 이름과 함께 실제 폴더 이름을 보인다.
    fireEvent.mouseEnter(item("Solo App"));
    const card = await screen.findByTestId("sidebar-hover-card");
    expect(card).toHaveTextContent("Solo App");
    expect(card).toHaveTextContent("Folder name: solo");
    fireEvent.mouseLeave(item("Solo App"));

    const search = screen.getByRole("textbox", { name: "Find repository or branch" });
    fireEvent.change(search, { target: { value: "solo app" } });
    expect(item("Solo App")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "solo" } });
    expect(item("Solo App")).toBeInTheDocument();
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
    // 선택 표시는 막대가 아니라 채움과 브랜치 이름 글자 강조로 낸다.
    expect(item("feat/login").querySelector(".font-mono")?.className).toContain("text-foreground");
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
    fireEvent.change(screen.getByRole("textbox", { name: "Find repository or branch" }), {
      target: { value: "login" },
    });
    expect(sidebarPaths()).toEqual([WT]);
  });
});

describe("RepoTree — right-click menus", () => {
  const menuLabels = () => within(screen.getByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent);
  const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });

  it("forgets a removed worktree as the place to reopen its repository", async () => {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(ask).mockResolvedValue(true);
    useRepositoryStore.setState({ activeWorktrees: { [API]: WT } });
    renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    // 클릭이 저장소를 열며 기억된 워크트리로 가지 않게, 다른 곳을 연 상태로 둔다.
    useRepositoryStore.setState({ activeRepoPath: SOLO, activeRepo: repos[2], activeWorktrees: { [API]: WT } });
    fireEvent.contextMenu(item("feat/login"));
    fireEvent.click(menuItem("Remove worktree…"));
    await waitFor(() => expect(useRepositoryStore.getState().activeWorktrees[API]).toBeUndefined());
  });

  it("offers open, view, folder actions, copy and removal (last) on a worktree line", async () => {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(ask).mockResolvedValue(false);
    renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    fireEvent.contextMenu(item("feat/login"));
    expect(menuLabels()).toEqual([
      "Open this worktree",
      "View this branch in the primary folder",
      "Reveal in Finder",
      "Open in Terminal",
      "Open in editor",
      "Copy path",
      "Copy branch name",
      "Remove worktree…",
    ]);
    // 제거는 확인 창을 거치고, 거절하면 아무것도 지우지 않는다.
    fireEvent.click(menuItem("Remove worktree…"));
    await waitFor(() => expect(ask).toHaveBeenCalled());
  });

  it("views a worktree's branch in the primary folder from its menu", async () => {
    renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    useRepositoryStore.setState({ activeRepoPath: API, activeRepo: repos[0] });
    fireEvent.contextMenu(item("feat/login"));
    fireEvent.click(menuItem("View this branch in the primary folder"));
    await waitFor(() =>
      expect(useHistoryViewStore.getState()).toMatchObject({
        repoPath: API,
        target: { kind: "ref", name: "feat/login", isRemote: false },
      }),
    );
  });

  it("has no removal on the primary folder and cannot reopen the folder already open", () => {
    useRepositoryStore.setState({ activeRepoPath: SOLO, activeRepo: repos[2] });
    renderTree(makeData(baseSignals));
    fireEvent.contextMenu(item("dev · Primary folder"));
    expect(menuLabels()).not.toContain("Remove worktree…");
    expect((menuItem("Open primary folder") as HTMLButtonElement).disabled).toBe(true);
  });

  it("checks out a working branch only when that repository is open", async () => {
    renderTree(makeData(baseSignals, { workingBranches: { [SOLO]: [wbRow("feat/spike")] } }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "feat/spike" }));
    expect(menuLabels()).toEqual(["View without checkout", "Check out here", "Copy branch name"]);
    expect((menuItem("Check out here") as HTMLButtonElement).disabled).toBe(true);
  });

  it("checks out a working branch in the open repository once its lists are loaded", async () => {
    const { switchBranch } = await import("@/api/commands");
    useRepositoryStore.setState({ activeRepoPath: SOLO, activeRepo: repos[2] });
    renderTree(makeData(baseSignals, { workingBranches: { [SOLO]: [wbRow("feat/spike")] } }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "feat/spike" }));
    fireEvent.click(menuItem("Check out here"));
    await waitFor(() => expect(switchBranch).toHaveBeenCalledWith(SOLO, "feat/spike"));
  });

  it("sorts, creates a workspace and folds everything from the account line", () => {
    renderTree(makeData(baseSignals));
    fireEvent.contextMenu(item("acme"));
    expect(menuLabels()).toEqual([
      "Custom order (drag)",
      "By name",
      "Recent activity",
      "Needs attention first",
      "New workspace",
      "Collapse all in this account",
    ]);
    fireEvent.click(menuItem("By name"));
    expect(useWorkspaceStore.getState().sortModeByAccount.acme).toBe("name");
    fireEvent.contextMenu(item("acme"));
    fireEvent.click(menuItem("Collapse all in this account"));
    // 계정 줄은 펼친 채로 두고 그 안 카드만 접는다.
    expect(item("acme")).toHaveAttribute("aria-expanded", "true");
    expect(item("product")).toHaveAttribute("aria-expanded", "false");
    expect(item("solo")).toHaveAttribute("aria-expanded", "false");
  });
});
