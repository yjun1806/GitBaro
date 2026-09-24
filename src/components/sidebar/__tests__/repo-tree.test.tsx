// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import "@/i18n/config";
import { buildRepoTree, type PathSignals, type Workspace } from "@/lib/repo-tree";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { RepoInfo, RepoSyncStatus, WorktreeInfo } from "@/types";

vi.mock("@/api/commands", () => ({
  getWorktrees: vi.fn(),
}));

import { getWorktrees } from "@/api/commands";
import { RepoTree } from "../RepoTree";
import type { SidebarTreeData } from "../useSidebarTreeData";

const NOW = 2_000_000_000_000;

const API = "/r/api";
const WEB = "/r/web";
const SOLO = "/r/solo";
const QUIET = "/r/quiet";
const WT = "/r/api/.worktrees/feat";

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
  opts: { lastChangedAt?: Record<string, number>; overflow?: string[] } = {},
): SidebarTreeData {
  const worktreesByRepo = { [API]: [{ path: WT, branch: "feat/login" }] };
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
        onAddRepo={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onSelectRepo };
}

const item = (name: string) => screen.getByRole("treeitem", { name });

beforeEach(() => {
  vi.mocked(getWorktrees).mockResolvedValue(worktreeInfos);
  useRepositoryStore.setState({ repos, activeRepoPath: null, activeRepo: null, activeWorktrees: {} });
  useWorkspaceStore.setState({ workspaces, collapsed: [], orderByParent: {}, sortModeByAccount: {} });
});

afterEach(cleanup);

// SOLO에만 신호를 주고 QUIET은 모두 0이라 조용한 저장소로 접힌다.
const baseSignals: Record<string, PathSignals> = {
  [API]: { dirtyCount: 2, newCommits: 1, ahead: 3, behind: 0 },
  [WT]: { dirtyCount: 1, newCommits: 4 },
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

    // 워크트리 행은 기반 브랜치(WorktreeBaseLabel)를 보여 준다.
    await waitFor(() => expect(within(item("feat/login")).getByText(/main/)).toBeInTheDocument());
  });

  it("hides children when a node is folded and shows the fold state", () => {
    renderTree(makeData(baseSignals));
    expect(item("api")).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(item("api"), { key: "ArrowLeft" });
    expect(item("api")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "feat/login" })).toBeNull();

    fireEvent.click(item("product"));
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();
    expect(useWorkspaceStore.getState().collapsed).toEqual(["repo:/r/api", "ws:w1"]);
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
  it("shows uncommitted files, new commits and ahead/behind only when they are not zero", () => {
    renderTree(makeData(baseSignals));

    // 저장소 행은 워크트리까지 더한 합계, ↑↓는 메인 작업 트리 값
    const api = within(item("api"));
    expect(api.getByRole("img", { name: "3 uncommitted files" })).toBeInTheDocument();
    expect(api.getByRole("img", { name: "5 new commits" })).toBeInTheDocument();
    expect(api.getByRole("img", { name: "3 commits to push" })).toHaveTextContent("↑3");

    const wt = within(item("feat/login"));
    expect(wt.getByRole("img", { name: "1 uncommitted file" })).toBeInTheDocument();
    expect(wt.getByRole("img", { name: "4 new commits" })).toBeInTheDocument();

    // 모두 0이면 표시 없음
    expect(within(item("web")).queryAllByRole("img")).toHaveLength(0);

    // ↓만 있는 저장소
    const solo = within(item("solo"));
    expect(solo.getByRole("img", { name: "2 commits to pull" })).toHaveTextContent("↓2");
    expect(solo.queryByRole("img", { name: /uncommitted|new commit/ })).toBeNull();

    // 워크스페이스는 안에 든 저장소의 합계
    const product = within(item("product"));
    expect(product.getByRole("img", { name: "3 uncommitted files" })).toBeInTheDocument();
    expect(product.getByRole("img", { name: "5 new commits" })).toBeInTheDocument();
  });

  it("marks recently changed rows with a live dot, faded when the path is not watched live", () => {
    renderTree(
      makeData(baseSignals, { lastChangedAt: { [WEB]: NOW - 5_000, [SOLO]: NOW - 30_000 }, overflow: [SOLO] }),
    );
    const webDot = within(item("web")).getByRole("img", { name: /last 10 minutes/ });
    expect(webDot).toHaveAttribute("data-watched", "true");
    const soloDot = within(item("solo")).getByRole("img", { name: /not watched live/ });
    expect(soloDot).toHaveAttribute("data-watched", "false");
    expect(soloDot.className).toContain("opacity-40");
    expect(within(item("api")).queryByRole("img", { name: /last 10 minutes|not watched/ })).toBeNull();
  });

  it("does not mark changes older than 10 minutes as live", () => {
    renderTree(makeData(baseSignals, { lastChangedAt: { [WEB]: NOW - 11 * 60_000 } }));
    expect(within(item("web")).queryAllByRole("img")).toHaveLength(0);
  });
});

describe("RepoTree — live section, search and selection", () => {
  it("lists places changing now and opens a worktree from there", () => {
    const { onSelectRepo } = renderTree(makeData(baseSignals, { lastChangedAt: { [WT]: NOW - 12_000 } }));
    const section = screen.getByRole("region", { name: "Files changing now" });
    const entry = within(section).getByRole("button", { name: /api/ });
    expect(entry).toHaveTextContent("12s");
    fireEvent.click(entry);
    expect(useRepositoryStore.getState().activeWorktrees[API]).toBe(WT);
    expect(onSelectRepo).toHaveBeenCalledWith(API);
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

  it("collapses and expands everything below the accounts", () => {
    renderTree(makeData(baseSignals));
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByRole("treeitem", { name: "api" })).toBeNull();
    expect(item("acme")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(item("feat/login")).toBeInTheDocument();
  });
});
