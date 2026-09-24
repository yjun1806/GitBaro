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
import type { RepoInfo, RepoSyncStatus, WorktreeInfo } from "@/types";

vi.mock("@/api/commands", () => ({
  getWorktrees: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), ask: vi.fn() }));

import { getWorktrees } from "@/api/commands";
import { LIVE_SECTION_KEY, RepoTree } from "../RepoTree";
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
  const branches: Record<string, string> = { [API]: "main", [WEB]: "fix/nav", [WT]: "feat/login" };
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

const item = (name: string) => screen.getByRole("treeitem", { name });
/** 행 글 칸(이름 + 둘째 줄)에 걸린 툴팁 */
const rowTooltip = (name: string) => item(name).querySelector("[title]:has([data-testid=row-meta])")?.getAttribute("title") ?? "";
const worktreeTooltip = () => rowTooltip("feat/login");
const metaText = (name: string) => item(name).querySelector("[data-testid=row-meta]")?.textContent ?? "";

beforeEach(() => {
  vi.mocked(getWorktrees).mockReset();
  vi.mocked(getWorktrees).mockResolvedValue(worktreeInfos);
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

describe("RepoTree — indentation levels", () => {
  it("nests account → workspace → repository → worktree, loose repositories directly under the account", async () => {
    renderTree(makeData(baseSignals));

    expect(item("acme")).toHaveAttribute("aria-level", "1");
    expect(item("product")).toHaveAttribute("aria-level", "2");
    expect(item("api")).toHaveAttribute("aria-level", "3");
    expect(item("web")).toHaveAttribute("aria-level", "3");
    expect(item("feat/login")).toHaveAttribute("aria-level", "4");
    expect(item("solo")).toHaveAttribute("aria-level", "2");

    // 워크트리 행은 기반 브랜치를 둘째 줄이 아니라 툴팁에 둔다(폭을 아끼려고).
    await waitFor(() => expect(worktreeTooltip()).toMatch(/behind main/));
  });

  it("indents each visual depth by one INDENT_PX step, so the hierarchy doesn't look flat", async () => {
    renderTree(makeData(baseSignals));
    await waitFor(() => expect(worktreeTooltip()).toMatch(/behind main/));

    // paddingLeft = 8 + depth * 14 (TreeRowFrame). account:0, workspace:1,
    // repo directly under the account:1, repo inside a workspace:2, worktree = its repo's depth + 1.
    const paddingLeft = (name: string) => Number(item(name).style.paddingLeft.replace("px", ""));

    expect(paddingLeft("acme")).toBe(8);
    expect(paddingLeft("product")).toBe(22); // workspace, depth 1
    expect(paddingLeft("solo")).toBe(22); // repo directly under the account, depth 1
    expect(paddingLeft("api")).toBe(36); // repo inside "product", depth 2
    expect(paddingLeft("web")).toBe(36);
    expect(paddingLeft("feat/login")).toBe(50); // worktree of "api" (depth 2 + 1)

    // A workspace member repo must sit strictly deeper than a loose repo at the
    // account level, and the worktree strictly deeper than its own repo — this
    // is the actual "flat hierarchy" bug: it isn't enough that they differ, the
    // parent/child nesting has to increase monotonically.
    expect(paddingLeft("api")).toBeGreaterThan(paddingLeft("solo"));
    expect(paddingLeft("feat/login")).toBeGreaterThan(paddingLeft("api"));
  });

  it("reads worktree bases once per expanded repository, not on every toolbar worktree refresh", async () => {
    const { client } = renderTree(makeData(baseSignals));
    await waitFor(() => expect(worktreeTooltip()).toMatch(/behind main/));
    const calls = vi.mocked(getWorktrees).mock.calls.length;
    expect(vi.mocked(getWorktrees).mock.calls.every(([p]) => p === API)).toBe(true);

    // useRepoWatcher가 git 폴더 변경마다 부르는 무효화
    await client.invalidateQueries({ queryKey: ["worktrees"] });
    expect(vi.mocked(getWorktrees).mock.calls.length).toBe(calls);
  });

  it("hides children when a node is folded and shows the fold state", () => {
    renderTree(makeData(baseSignals));
    expect(item("api")).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(item("api"), { key: "ArrowLeft" });
    expect(item("api")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "feat/login" })).toBeNull();

    // 워크스페이스 행을 누르면 고르고(W4-T1), 접기는 ← 키나 ▾ 표시로 한다.
    fireEvent.keyDown(item("product"), { key: "ArrowLeft" });
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();
    expect(useWorkspaceStore.getState().collapsed).toEqual(["repo:/r/api", "ws:w1"]);
  });

  it("selects the workspace when its row is clicked, without folding it", () => {
    renderTree(makeData(baseSignals));
    expect(item("product")).toHaveAttribute("aria-selected", "false");
    fireEvent.click(item("product"));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("w1");
    expect(item("product")).toHaveAttribute("aria-selected", "true");
    expect(item("product")).toHaveAttribute("aria-expanded", "true");
  });

  it("folds quiet repositories into one row", () => {
    renderTree(makeData(baseSignals));
    expect(screen.queryByRole("treeitem", { name: "quiet" })).toBeNull();
    const quietRow = screen.getByRole("treeitem", { name: /quiet repositor/ });
    fireEvent.click(quietRow);
    expect(item("quiet")).toHaveAttribute("aria-level", "3");
  });
});

describe("RepoTree — badges", () => {
  it("writes the state in words on the second line, omitting zero values", () => {
    renderTree(makeData(baseSignals));

    // 저장소 행은 워크트리까지 더한 합계, ↑↓는 메인 작업 트리 값
    expect(metaText("api")).toBe(" · 3 modified · 5 new commits · ↑3");
    expect(rowTooltip("api")).toContain("3 modified · 5 new commits · ↑3");

    // 워크트리 행은 시안대로 ↑↓를 그리지 않는다.
    expect(metaText("feat/login")).toBe(" · 1 modified · 4 new commits");

    // 모두 0이면 「clean」, 오른쪽에 숫자 배지는 없다.
    expect(metaText("web")).toBe(" · clean");
    expect(within(item("web")).queryAllByRole("img")).toHaveLength(0);

    // ↓만 있는 저장소
    expect(metaText("solo")).toBe("↓2"); // 브랜치를 모르는 저장소라 앞에 「·」가 없다

    // 워크스페이스는 저장소 수와 안에 든 저장소의 합계
    expect(metaText("product")).toBe("2 repos · 3 modified · 5 new commits");
  });

  it("marks recently changed rows with a live dot, faded when the path is not watched live", () => {
    renderTree(
      makeData(baseSignals, {
        lastChangedAt: { [WEB]: NOW - 5_000, [SOLO]: NOW - 30_000 },
        watched: [API, WEB, WT, QUIET],
        overflow: [SOLO],
      }),
    );
    const webDot = within(item("web")).getByRole("img", { name: "Files changing now · 5s ago" });
    expect(webDot).toHaveAttribute("data-watched", "true");
    const soloDot = within(item("solo")).getByRole("img", { name: /not watched live/ });
    expect(soloDot).toHaveAttribute("data-watched", "false");
    expect(soloDot.className).toContain("opacity-40");
    expect(within(item("api")).queryByRole("img", { name: /changing now|not watched/ })).toBeNull();
  });

  it("fades the dot of a path that is no longer watched, such as a folded repository's worktree", () => {
    // 「지금 바뀌는 곳」 카드는 기본이 접힘이라(W-Top-T4), collapsed 목록에 그 키를 두면 거꾸로 펼쳐진다.
    useWorkspaceStore.setState({ collapsed: [`repo:${API}`, LIVE_SECTION_KEY] });
    renderTree(
      makeData(baseSignals, {
        lastChangedAt: { [WT]: NOW - 5_000 },
        watched: [API, WEB, SOLO, QUIET],
        overflow: [],
      }),
    );
    const section = screen.getByRole("region", { name: "Files changing now" });
    expect(within(section).getByRole("img", { name: /not watched live/ })).toHaveAttribute(
      "data-watched",
      "false",
    );
    expect(within(item("api")).getByRole("img", { name: /not watched live/ })).toBeInTheDocument();
  });

  it("does not mark changes older than 10 minutes as live", () => {
    renderTree(makeData(baseSignals, { lastChangedAt: { [WEB]: NOW - 11 * 60_000 } }));
    expect(within(item("web")).queryAllByRole("img")).toHaveLength(0);
  });
});

describe("RepoTree — live section, search and selection", () => {
  it("lists places changing now and opens a worktree from there", () => {
    useWorkspaceStore.setState({ collapsed: [LIVE_SECTION_KEY] }); // 카드를 펼친 상태로
    const { onSelectRepo } = renderTree(makeData(baseSignals, { lastChangedAt: { [WT]: NOW - 12_000 } }));
    const section = screen.getByRole("region", { name: "Files changing now" });
    const entry = within(section).getByRole("button", { name: /api/ });
    expect(entry).toHaveTextContent("12s");
    fireEvent.click(entry);
    expect(useRepositoryStore.getState().activeWorktrees[API]).toBe(WT);
    expect(onSelectRepo).toHaveBeenCalledWith(API);
  });

  it("reveals the entry's repository in the tree — expanding its account and workspace — when clicked", () => {
    useWorkspaceStore.setState({ collapsed: [LIVE_SECTION_KEY, "acct:acme", "ws:w1"] });
    renderTree(makeData(baseSignals, { lastChangedAt: { [WT]: NOW - 12_000 } }));
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();

    const section = screen.getByRole("region", { name: "Files changing now" });
    fireEvent.click(within(section).getByRole("button", { name: /api/ }));

    expect(item("acme")).toHaveAttribute("aria-expanded", "true");
    expect(item("product")).toHaveAttribute("aria-expanded", "true");
    expect(item("api")).toBeInTheDocument();
    // WT is a worktree, so api's own row must open too, not just its ancestors.
    expect(item("api")).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the main working tree when a repository row is clicked", () => {
    useRepositoryStore.setState({ activeWorktrees: { [API]: WT } });
    const { onSelectRepo } = renderTree(makeData(baseSignals));
    fireEvent.click(item("api"));
    expect(useRepositoryStore.getState().activeWorktrees[API]).toBeUndefined();
    expect(onSelectRepo).toHaveBeenCalledWith(API);
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
    expect(item("feat/login")).toBeInTheDocument();
  });

  it("keeps its own collapsed-by-default state, separate from the tree's collapse all/expand all", () => {
    renderTree(makeData(baseSignals, { lastChangedAt: { [WT]: NOW - 12_000 } }));
    // The live card is not a tree level, so "collapse/expand all" must not touch it.
    const liveToggle = screen.getByRole("button", { name: /changing now/i });
    expect(liveToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(liveToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(liveToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(liveToggle);
    expect(liveToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(liveToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the owning repository selected while its open worktree row is hidden", () => {
    useRepositoryStore.setState({ activeRepoPath: WT, activeRepo: repos[0], activeWorktrees: { [API]: WT } });
    renderTree(makeData(baseSignals));
    expect(item("feat/login")).toHaveAttribute("aria-selected", "true");
    expect(item("api")).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(item("api"), { key: "ArrowLeft" });
    expect(item("api")).toHaveAttribute("aria-selected", "true");
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
    expect(sidebarPaths()).toEqual([WT]);
    fireEvent.keyDown(item("api"), { key: "ArrowLeft" });
    expect(sidebarPaths()).toEqual([]);
  });

  it("adds a quiet repository's worktrees once the quiet row is opened", () => {
    renderTree(makeData({ ...baseSignals, [QUIET_WT]: { dirtyCount: 0 } }, { quietWorktree: true }));
    expect(sidebarPaths()).toEqual([WT]);
    fireEvent.click(screen.getByRole("treeitem", { name: /quiet repositor/ }));
    expect(sidebarPaths()).toEqual([WT, QUIET_WT]);
  });

  it("adds worktrees of repositories that a search forces open", () => {
    useWorkspaceStore.setState({ collapsed: [`repo:${API}`] });
    renderTree(makeData(baseSignals));
    expect(sidebarPaths()).toEqual([]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find repository or branch" }), {
      target: { value: "login" },
    });
    expect(sidebarPaths()).toEqual([WT]);
  });
});
