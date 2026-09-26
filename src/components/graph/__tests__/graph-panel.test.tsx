// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "zustand";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useFollowStore } from "@/stores/follow";
import { useBranchRangeStore } from "@/components/branch/branch-range";
import { useHistoryViewStore } from "@/stores/history-view";
import { useUnpushedRangeViewStore } from "../unpushed-range-view";
import { syncStatusPaths } from "@/components/sidebar/tree-model";
import { worktreeColor } from "../worktree-history";
import { useGraphWorktreesStore } from "../graph-worktrees";
import { UNPUSHED_ROW_CLASS } from "../GraphRow";
import type {
  CommitInfo,
  GitOperation,
  RepoInfo,
  RepoReviewStatus,
  StatusEntry,
  WorktreeInfo,
} from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/components/stash/StashView", () => ({ StashView: () => <div>stash-list</div> }));
vi.mock("@/components/actions/ActionsView", () => ({ ActionsView: () => <div>actions-list</div> }));

const switchTo = async (path: string) => {
  useRepositoryStore.setState({ activeRepoPath: path });
};
const openWorktree = vi.fn(switchTo);
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => openWorktree }));

const REPO = "/work/app";
const FEAT = "/work/app-feat";

/**
 * 「보는 중」 띠(GitStatusLine). 같은 화면에 「WIP 안내」(Notice)도 `role="status"`를 쓰므로
 * 텍스트로 가려낸다.
 */
function viewingStrip(): HTMLElement {
  const strip = screen.getAllByRole("status").find((el) => el.textContent?.includes("Viewing"));
  if (!strip) throw new Error("viewing strip not found");
  return strip;
}

function commit(id: string, parentIds: string[], extra: Partial<CommitInfo> = {}): CommitInfo {
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
    ...extra,
  };
}

const history = {
  pages: [
    [
      commit("c1", ["c2"], {
        isAgentAuthored: true,
        coAuthors: [{ name: "Claude", email: "noreply@anthropic.com" }],
        refs: [{ name: "main", kind: "localBranch", isHead: true }],
      }),
      commit("c2", ["c3"]),
      commit("c3", ["c4"]),
      commit("c4", []),
    ],
  ],
};

const scan: RepoReviewStatus[] = [
  {
    repoPath: REPO,
    worktrees: [
      { path: REPO, branch: "main", headOid: "c1", isMain: true },
      { path: FEAT, branch: "feat/x", headOid: "f1", isMain: false },
    ],
  },
];

const statusEntries = [{ path: "a.ts", status: "modified", staged: false }] as StatusEntry[];
const syncByPath = { [FEAT]: { path: FEAT, dirtyCount: 4, dirtyLatestMtime: Date.now() - 5 * 60_000 } };

/** `useWorktrees` 응답과 다른 워크트리의 HEAD 이력(칩 줄, D5). 기본은 비어 있다. */
const worktreeState = {
  list: [] as WorktreeInfo[],
  histories: {} as Record<string, CommitInfo[]>,
};

/**
 * `useMergeState` 응답. react-query 대신 zustand로 흉내 낸다 — 실제 흐름처럼 값을 바꾸면
 * (activeTab 값이 그대로여도) 그 자체로 다시 그려야 하기 때문이다.
 */
const mergeMockStore = create<{ value: GitOperation | null }>()(() => ({ value: null }));

/** `useRepoSyncStatuses`에 넘긴 경로 목록. */
const syncCalls: string[][] = [];

/** 그래프가 커밋 목록을 읽은 시작점(`useCommitHistoryInfinite`의 둘째 인자). */
const historyTargets: unknown[] = [];

/** `useBranches` 응답. 기본은 비어 있다. */
const branchList: { name: string; isHead: boolean; isRemote: boolean }[] = [];

/** main과 갈라진 지점(기본 브랜치 머리). 테스트마다 채운다. */
const changesVsDefaultByPath: Record<string, unknown> = {};

const unpushedState = vi.hoisted(() => ({ value: undefined as unknown }));
const stashPush = vi.hoisted(() => vi.fn(async (_message?: string) => "stash-oid" as string | null));
vi.mock("@/api/queries", () => ({
  useDivergencePoint: (path: string | null) => ({ data: path ? changesVsDefaultByPath[path] : undefined }),
  useStatusMany: () => ({}),
  useStatus: (path: string | null) => ({ data: path ? statusEntries : undefined }),
  useStashList: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: [] }),
  useMergeState: () => ({ data: mergeMockStore((s) => s.value) }),
  useCommitHistoryInfinite: (_path: string | null, target?: unknown) => {
    historyTargets.push(target);
    return {
    data: history,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    };
  },
  useBranches: () => ({ data: branchList }),
  useBranchComparison: () => ({ data: undefined, isLoading: true, error: null }),
  useRemoteTags: () => ({ data: undefined }),
  useCommitAvatars: () => ({ data: {} }),
  useWorktrees: () => ({ data: worktreeState.list }),
  useWorktreeHeadHistories: (heads: { path: string; head: string }[]) =>
    heads.map((h) => ({ data: worktreeState.histories[h.path], dataUpdatedAt: 1 })),
  useRepoSyncStatuses: (paths: string[]) => {
    syncCalls.push(paths);
    return { data: syncByPath };
  },
  useReviewStatusQuery: () => ({ data: scan, isLoading: false }),
  useUnpushedCommits: () => ({ data: unpushedState.value }),
  useStashMutations: () => ({ push: { mutateAsync: stashPush } }),
}));

const { GraphPanel } = await import("@/components/graph/GraphPanel");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GraphPanel />
    </QueryClientProvider>,
  );
}

/** 스크롤 영역 안의 행(버튼)을 화면 순서대로. */
function rowLabels(): string[] {
  const rows = document.querySelectorAll(
    "[role=tabpanel] button:not([data-working-changes]):not([data-follow-button])",
  );
  return [...rows].map((el) => el.getAttribute("data-commit-id") ?? el.getAttribute("aria-label") ?? "");
}

Element.prototype.scrollIntoView = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("en");
  // 기존 시나리오는 다른 워크트리도 함께 보는 상태다. 기본(지금 워크트리만)은 따로 본다.
  useGraphWorktreesStore.setState({ shownByRepo: { [REPO]: [FEAT] } });
  openWorktree.mockReset();
  openWorktree.mockImplementation(switchTo);
  worktreeState.list = [];
  worktreeState.histories = {};
  mergeMockStore.setState({ value: null });
  useBranchRangeStore.getState().clear();
  useUIStore.setState({ activeTab: "history", repoListOpen: false });
  unpushedState.value = undefined;
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  useFollowStore.getState().stop();
  useHistoryViewStore.getState().reset();
  useUnpushedRangeViewStore.getState().close();
  historyTargets.length = 0;
  branchList.length = 0;
});

afterEach(cleanup);

describe("GraphPanel commit graph", () => {
  it("puts a WIP row per worktree on top of the commits", () => {
    renderPanel();
    expect(rowLabels()).toEqual([
      "Uncommitted changes · feat/x branch · app-feat · 4 files",
      "Uncommitted changes · main branch · primary folder · 1 file",
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  it("does not repeat the unpushed commit count on the graph tab (the sidebar and Push show it)", () => {
    unpushedState.value = { count: 3, hasUpstream: false, hasRemote: true, commits: [] };
    renderPanel();
    expect(screen.getByRole("tab", { name: /Commit graph/ }).textContent).toBe("Commit graph");
  });

  it("opens the staging list for the open worktree's WIP row", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: "Uncommitted changes · main branch · primary folder · 1 file" });
    fireEvent.click(row);
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(openWorktree).not.toHaveBeenCalled();
  });

  it("follows another worktree in place from its WIP row, without opening it", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: "Uncommitted changes · feat/x branch · app-feat · 4 files" });
    fireEvent.click(row);
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(useFollowStore.getState()).toMatchObject({ target: FEAT, mode: "following" });
    expect(openWorktree).not.toHaveBeenCalled();
    expect(useRepositoryStore.getState().activeRepoPath).toBe(REPO);
    // Only the followed row is picked, and it carries the "following" pill.
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Uncommitted changes · main branch · primary folder · 1 file" }).getAttribute("aria-pressed")).toBe("false");
    const container = row.closest('[data-testid="wip-row"]') as HTMLElement;
    expect(within(container).getByRole("button", { name: "Following · stop" })).toBeTruthy();
  });

  it("stops following when a commit is picked or another repository is opened", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes · main branch · primary folder · 1 file" }));
    expect(useFollowStore.getState().target).toBe(REPO);
    fireEvent.click(document.querySelector('[data-commit-id="c2"]') as HTMLElement);
    expect(useUIStore.getState().activeTab).toBe("history");
    expect(useFollowStore.getState().target).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes · feat/x branch · app-feat · 4 files" }));
    expect(useFollowStore.getState().target).toBe(FEAT);
    useRepositoryStore.setState({ activeRepoPath: FEAT });
    expect(useFollowStore.getState().target).toBeNull();
  });

  it("shows when another worktree's files last changed", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: "Uncommitted changes · feat/x branch · app-feat · 4 files" });
    expect(row.textContent).toContain("modified 5 minutes ago");
  });

  it("hides the 'changed just now' pill on a followed worktree once its files are gone (#7)", () => {
    // 배경에서 다른 워크트리를 따라가는 중(paused)에 그 워크트리의 변경이 모두 사라져도(커밋됨 등)
    // mtime은 최근으로 남을 수 있다 — 파일이 0개면 「방금 바뀜」 안내를 보이면 안 된다.
    useUIStore.setState({ activeTab: "changes" });
    useFollowStore.setState({ target: FEAT, mode: "paused", file: "some.ts" });
    const original = syncByPath[FEAT];
    syncByPath[FEAT] = { path: FEAT, dirtyCount: 0, dirtyLatestMtime: Date.now() - 1_000 };
    try {
      renderPanel();
      const rows = screen.getAllByTestId("wip-row");
      const featRow = rows.find((r) => r.textContent?.includes("feat/x"));
      expect(featRow).toBeTruthy();
      expect(within(featRow!).queryByText(/^Changed/)).toBeNull();
    } finally {
      syncByPath[FEAT] = original;
    }
  });

  it("keeps the commit context menu items on graph rows", () => {
    renderPanel();
    const row = document.querySelector('[data-commit-id="c2"]') as HTMLElement;
    fireEvent.contextMenu(row);
    expect(useSelectionStore.getState().selectedCommitId).toBe("c2");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      i18n.t("history.contextMenu.createBranch"),
      i18n.t("history.contextMenu.checkout"),
      i18n.t("history.contextMenu.cherryPick"),
      i18n.t("history.contextMenu.revert"),
      i18n.t("history.contextMenu.copyHash"),
      i18n.t("menu.copyShortSha"),
      i18n.t("history.contextMenu.copyMessage"),
      i18n.t("menu.viewOnGitHub"),
      // 되돌릴 수 없는 reset은 맨 아래에 따로 둔다.
      i18n.t("history.contextMenu.reset"),
    ]);
  });

  it("marks agent commits as a guess and keeps the existing ref labels", () => {
    renderPanel();
    const row = document.querySelector('[data-commit-id="c1"]') as HTMLElement;
    expect(within(row).getByLabelText(/Probably written with Claude/)).toBeTruthy();
    expect(within(row).getByText("main")).toBeTruthy();
  });

  it("asks for sync status with the sidebar's path list so both share one poll", () => {
    syncCalls.length = 0;
    renderPanel();
    // The sidebar asks for every registered repo plus their linked worktrees (syncStatusPaths).
    expect(syncCalls[syncCalls.length - 1]).toEqual(syncStatusPaths([REPO], scan));
    expect(syncCalls[syncCalls.length - 1]).toEqual([REPO, FEAT]);
  });

  it("adds the graph's worktrees to the activity watch and removes them on unmount", () => {
    const { unmount } = renderPanel();
    expect(useActivityTargetsStore.getState().extraByKey.graph).toEqual([REPO, FEAT]);
    unmount();
    expect(useActivityTargetsStore.getState().extraByKey.graph).toBeUndefined();
  });
});

describe("GraphPanel worktree chips (D5)", () => {
  const worktree = (path: string, head: string, extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
    path,
    head,
    branch: null,
    isMain: false,
    isBare: false,
    isLocked: false,
    lockReason: null,
    isDirty: false,
    isPrunable: false,
    base: null,
    ...extra,
  });

  beforeEach(() => {
    worktreeState.list = [
      worktree(REPO, "c1", { branch: "main", isMain: true }),
      worktree(FEAT, "f1", {
        branch: "feat/x",
        base: { name: "main", source: "recorded", aheadOfBase: 1, behindBase: 0 },
      }),
    ];
    // feat/x has one commit of its own on top of c2, newer than main's HEAD.
    worktreeState.histories = {
      [FEAT]: [commit("f1", ["c2"], { timestamp: 1_700_000_100 }), commit("c2", ["c3"]), commit("c3", ["c4"])],
    };
  });

  it("shows a chip per worktree and draws the other worktree's commits in the same graph", async () => {
    renderPanel();
    const chips = screen.getByRole("group", { name: "Worktrees to show together in the graph" });
    const buttons = within(chips).getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
    expect(buttons.map((b) => b.textContent)).toEqual(["mainprimary folder1", "feat/xfrom main4"]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(within(chips).getByText("Worktrees shown together")).toBeTruthy();
    expect(rowLabels()).toEqual([
      "Uncommitted changes · feat/x branch · app-feat · 4 files",
      "Uncommitted changes · main branch · primary folder · 1 file",
      "f1",
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  it("hides a worktree's WIP row and commits when its chip is turned off, and brings them back", async () => {
    renderPanel();
    const chips = screen.getByRole("group", { name: "Worktrees to show together in the graph" });
    const feat = within(chips).getByRole("button", { name: /feat\/x/ });
    fireEvent.click(feat);
    expect(feat.getAttribute("aria-pressed")).toBe("false");
    expect(rowLabels()).toEqual(["Uncommitted changes · main branch · primary folder · 1 file", "c1", "c2", "c3", "c4"]);
    expect(within(chips).getByRole("button", { name: "1 more worktree · show together" })).toBeTruthy();

    fireEvent.click(feat);
    expect(rowLabels()).toContain("f1");
    expect(rowLabels()).toContain("Uncommitted changes · feat/x branch · app-feat · 4 files");
  });

  it("draws each worktree's WIP row in its own lane down to its commits, in the chip's color", async () => {
    renderPanel();
    const featColor = worktreeColor(FEAT);
    const chips = screen.getByRole("group", { name: "Worktrees to show together in the graph" });
    const swatch = within(within(chips).getByRole("button", { name: /feat\/x/ })).getByTestId("chip-swatch");
    // jsdom writes inline colors as rgb(); convert the same way before comparing.
    const probe = document.createElement("span");
    probe.style.background = featColor;
    expect(swatch.style.background).toBe(probe.style.background);
    const wip = screen.getByRole("button", { name: "Uncommitted changes · feat/x branch · app-feat · 4 files" });
    expect(wip.querySelector("circle")?.getAttribute("stroke")).toBe(featColor);
    // The line leaving the WIP row reaches f1, which is drawn in the same color.
    const f1 = document.querySelector('[data-commit-id="f1"]') as HTMLElement;
    expect(f1.querySelector("circle")?.getAttribute("fill")).toBe(featColor);
    expect([...f1.querySelectorAll("path")].some((p) => p.getAttribute("stroke") === featColor)).toBe(true);
  });

  it("does not offer reset or revert on another worktree's commit", async () => {
    renderPanel();
    const disabledOf = (id: string) => {
      fireEvent.contextMenu(document.querySelector(`[data-commit-id="${id}"]`) as HTMLElement);
      const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
      // 이 저장소에는 GitHub 원격이 없어 「GitHub에서 보기」는 늘 막혀 있다. 여기서는 reset·revert만 본다.
      const out = items
        .filter((m) => (m as HTMLButtonElement).disabled && m.textContent !== i18n.t("menu.viewOnGitHub"))
        .map((m) => m.textContent);
      fireEvent.keyDown(document, { key: "Escape" });
      return out;
    };
    expect(disabledOf("f1")).toEqual([i18n.t("history.contextMenu.revert"), i18n.t("history.contextMenu.reset")]);
    expect(disabledOf("c1")).toEqual([]);
  });

  it("hides the chips while the graph shows a branch comparison", () => {
    branchList.push({ name: "main", isHead: true, isRemote: false }, { name: "feat/x", isHead: false, isRemote: false });
    useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" });
    renderPanel();
    expect(screen.queryByRole("group", { name: "Worktrees to show together in the graph" })).toBeNull();
  });

  it("shows only the open worktree at first, and the others with one click", async () => {
    useGraphWorktreesStore.setState({ shownByRepo: {} });
    renderPanel();
    const chips = screen.getByRole("group", { name: "Worktrees to show together in the graph" });
    expect(within(chips).getByRole("button", { name: /feat\/x/ }).getAttribute("aria-pressed")).toBe("false");
    expect(rowLabels()).not.toContain("f1");
    expect(rowLabels()).not.toContain("Uncommitted changes · feat/x branch · app-feat · 4 files");
    fireEvent.click(within(chips).getByRole("button", { name: "1 more worktree · show together" }));
    expect(rowLabels()).toContain("f1");
    expect(rowLabels()).toContain("Uncommitted changes · feat/x branch · app-feat · 4 files");
    // 다시 지금 워크트리만 보는 버튼이 생긴다. 켠 상태는 저장소마다 기억한다.
    expect(useGraphWorktreesStore.getState().shownByRepo[REPO]).toEqual([FEAT]);
    fireEvent.click(within(chips).getByRole("button", { name: "Only this worktree" }));
    expect(rowLabels()).not.toContain("f1");
  });

  it("paints the lanes of worktrees that are not shown gray and names them on hover", async () => {
    useGraphWorktreesStore.setState({ shownByRepo: {} });
    const extra = [commit("f1", ["c2"], { timestamp: 1_700_000_100, refs: [{ name: "feat/x", kind: "localBranch", isHead: false }] })];
    worktreeState.histories = {};
    history.pages.push(extra);
    try {
      renderPanel();
      const f1 = document.querySelector('[data-commit-id="f1"]') as HTMLElement;
      expect(f1.querySelector("circle")?.getAttribute("fill")).toBe("var(--ln)");
      expect(f1.querySelector("circle title")?.textContent).toBe("feat/x");
      // 지금 연 워크트리(main)의 줄기와 main 이름표는 칩 견본 색이다.
      const c1 = document.querySelector('[data-commit-id="c1"]') as HTMLElement;
      expect(c1.querySelector("circle")?.getAttribute("fill")).toBe(worktreeColor(REPO));
      expect(c1.querySelector('[style*="--lane-bg"]')?.textContent).toBe("main");
    } finally {
      history.pages.pop();
    }
  });

  it("keeps the open worktree on: its chip cannot be turned off", () => {
    renderPanel();
    const chips = screen.getByRole("group", { name: "Worktrees to show together in the graph" });
    const main = within(chips).getByRole("button", { name: /^main/ });
    fireEvent.click(main);
    expect(main.getAttribute("aria-pressed")).toBe("true");
    expect(rowLabels()).toContain("Uncommitted changes · main branch · primary folder · 1 file");
  });
});

describe("GraphPanel UI feedback (tab badges, fork point, WIP row, commit entry, compare chip)", () => {
  afterEach(() => {
    for (const key of Object.keys(changesVsDefaultByPath)) delete changesVsDefaultByPath[key];
    branchList.splice(0, branchList.length);
    statusEntries.splice(0, statusEntries.length, { path: "a.ts", status: "modified", staged: false } as StatusEntry);
    useUIStore.setState({ workingFocusAt: null, isDiffMaximized: false });
  });

  it("puts counts on the tabs and has no changes-vs-main tab", () => {
    renderPanel();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Commit graph", "Stash", "Actions"]);
    // 스태시·Actions가 0이면 배지가 없다.
    expect(screen.getByRole("tab", { name: "Stash" }).textContent).toBe("Stash");
  });

  it("draws the base branch header right above the merge-base commit", async () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "feat/y",
      defaultBranch: "main",
      committed: [],
    };
    renderPanel();
    const base = await screen.findByTestId("base-header-row");
    expect(base.textContent).toContain("main");
    expect(base.textContent).toContain("Diverged");
    const order = [...document.querySelectorAll("[data-commit-id], [data-testid=base-header-row]")].map(
      (el) => el.getAttribute("data-commit-id") ?? "base",
    );
    expect(order).toEqual(["c1", "c2", "base", "c3", "c4"]);
  });

  it("has no base branch header on the default branch itself", () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "main",
      defaultBranch: "main",
      committed: [],
    };
    renderPanel();
    expect(screen.queryByTestId("base-header-row")).toBeNull();
  });

  it("hides the open worktree's WIP row when nothing is uncommitted, and shows it again", () => {
    statusEntries.splice(0, statusEntries.length);
    const { rerender } = renderPanel();
    expect(screen.queryByRole("button", { name: /· primary folder ·/ })).toBeNull();
    // 다른 워크트리(파일 4개)의 행은 남는다.
    expect(screen.getByRole("button", { name: /feat\/x branch · app-feat · 4 files/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Working changes/ })).toBeNull();

    statusEntries.push({ path: "b.ts", status: "added", staged: false } as StatusEntry);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <GraphPanel />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /main branch · primary folder · 1 file/ })).toBeTruthy();
  });

  it("names the branch and worktree on every WIP row", () => {
    renderPanel();
    const rows = screen.getAllByTestId("wip-row").map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("feat/x branch");
    expect(rows[0]).toContain("app-feat");
    expect(rows[1]).toContain("main branch");
    expect(rows[1]).toContain("primary folder");
  });

  it("offers Working changes on the open worktree's row only, which opens the staging list", () => {
    useUIStore.setState({ activeTab: "history" });
    useSelectionStore.getState().selectCommit("c2");
    renderPanel();
    // 파일 수는 같은 행이 말하므로 버튼에는 수가 없다. 상태 줄에도 두지 않는다.
    const buttons = screen.getAllByRole("button", { name: "Working changes" });
    expect(buttons).toHaveLength(1);
    expect(within(screen.getByRole("status")).queryByRole("button", { name: /^Working changes/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Commit/ })).toBeNull();
    // 다른 워크트리 행에는 없다(그 워크트리를 열어야 스테이징할 수 있다).
    const featRow = screen.getAllByTestId("wip-row")[0];
    expect(within(featRow).queryByRole("button", { name: /^Working changes/ })).toBeNull();

    useFollowStore.getState().start(FEAT);
    fireEvent.click(buttons[0]);
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(useFollowStore.getState().target).toBeNull();
    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
    expect(useUIStore.getState().workingFocusAt).not.toBeNull();
  });

  it("shows the active comparison as a chip that ends it", () => {
    branchList.push({ name: "main", isHead: true, isRemote: false }, { name: "feat/x", isHead: false, isRemote: false });
    useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" });
    renderPanel();
    const chip = screen.getByTestId("compare-chip");
    expect(chip.textContent).toContain("Comparing main..feat/x");
    fireEvent.click(within(chip).getByRole("button", { name: "End comparison" }));
    expect(useBranchRangeStore.getState().range).toBeNull();
    expect(screen.queryByTestId("compare-chip")).toBeNull();
  });

  it("no longer shows the old branch-picker bar above the graph", () => {
    renderPanel();
    expect(screen.queryByText("Select a branch to compare")).toBeNull();
    expect(screen.queryByTestId("compare-chip")).toBeNull();
  });

  it("views another branch without checking it out: no WIP rows, a strip with actions", () => {
    branchList.push({ name: "main", isHead: true, isRemote: false }, { name: "feat/x", isHead: false, isRemote: false });
    renderPanel();
    expect(screen.getAllByTestId("wip-row")).toHaveLength(2);

    act(() => useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false }));
    // 커밋 목록은 그 브랜치에서 읽는다.
    expect(historyTargets[historyTargets.length - 1]).toEqual({ kind: "ref", name: "feat/x" });
    // 체크아웃한 작업 트리의 것(WIP 행, 작업 중인 변경 버튼)은 감추고 안내를 둔다.
    expect(screen.queryAllByTestId("wip-row")).toHaveLength(0);
    expect(screen.getByText(i18n.t("historyView.wipHidden"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Working changes/ })).toBeNull();
    // 커밋 행은 그대로 눌러 상세를 연다.
    fireEvent.click(document.querySelector<HTMLElement>('[data-commit-id="c2"]')!);
    expect(useSelectionStore.getState().selectedCommitId).toBe("c2");

    const strip = viewingStrip();
    expect(strip.textContent).toContain("Viewing feat/x · not checked out");
    expect(within(strip).getByRole("button", { name: "Check out this branch" })).toBeTruthy();
    fireEvent.click(within(strip).getByRole("button", { name: "Back to current branch" }));
    expect(useHistoryViewStore.getState().target).toBeNull();
    expect(screen.getAllByTestId("wip-row")).toHaveLength(2);
    expect(historyTargets[historyTargets.length - 1]).toEqual({ kind: "head" });
  });

  it("picks what to view from the graph header: a branch, all branches, or the current checkout", () => {
    branchList.push(
      { name: "main", isHead: true, isRemote: false },
      { name: "feat/x", isHead: false, isRemote: false },
      { name: "origin/feat/y", isHead: false, isRemote: true },
      { name: "origin/HEAD", isHead: false, isRemote: true },
    );
    renderPanel();
    const picker = screen.getByRole("button", { name: /Viewing\s*Current checkout/ });
    fireEvent.click(picker);
    expect(screen.queryByRole("option", { name: /origin\/HEAD/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /origin\/feat\/y/ }));
    expect(useHistoryViewStore.getState().target).toEqual({ kind: "ref", name: "origin/feat/y", isRemote: true });

    fireEvent.click(screen.getByRole("button", { name: /Viewing\s*origin\/feat\/y/ }));
    fireEvent.click(screen.getByRole("option", { name: "All branches" }));
    expect(useHistoryViewStore.getState().target).toEqual({ kind: "all" });
    expect(historyTargets[historyTargets.length - 1]).toEqual({ kind: "all" });
    // 모든 브랜치는 체크아웃할 수 없다.
    expect(within(viewingStrip()).queryByRole("button", { name: "Check out this branch" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Viewing\s*All branches/ }));
    fireEvent.click(screen.getByRole("option", { name: /Current checkout/ }));
    expect(useHistoryViewStore.getState().target).toBeNull();
  });

  it("ends viewing when another repository is opened", () => {
    useHistoryViewStore.getState().view(REPO, { kind: "all" });
    renderPanel();
    expect(viewingStrip().textContent).toContain("Viewing All branches");
    act(() => useRepositoryStore.setState({ activeRepoPath: FEAT }));
    expect(useHistoryViewStore.getState().target).toBeNull();
  });
});

describe("GraphPanel commits not on any remote", () => {
  const remoteRepo = { ...repo, remotes: [{ name: "origin", url: "https://github.com/o/app.git" }] } as RepoInfo;

  beforeEach(() => {
    useRepositoryStore.setState({ repos: [remoteRepo], activeRepo: remoteRepo, activeRepoPath: REPO });
    const [c1, c2, c3, c4] = history.pages[0];
    history.pages[0] = [
      { ...c1, isUnpushed: true },
      { ...c2, isUnpushed: true },
      { ...c3, isUnpushed: false },
      { ...c4, isUnpushed: false },
    ];
    // 원격 추적 브랜치가 있다 = fetch한 적 있음(이 describe의 기본값). 「한 번도 fetch하지 않은
    // 저장소」 테스트만 이 목록을 비워 반대 상황을 만든다.
    branchList.push({ name: "origin/main", isHead: false, isRemote: true });
  });

  afterEach(() => {
    history.pages[0] = history.pages[0].map(({ isUnpushed: _drop, ...c }) => c);
    for (const key of Object.keys(changesVsDefaultByPath)) delete changesVsDefaultByPath[key];
  });

  const dot = (id: string) =>
    document.querySelector(`[data-commit-id="${id}"] circle[data-dot]`)?.getAttribute("data-dot");
  const tinted = (id: string) =>
    document.querySelector(`[data-commit-id="${id}"]`)?.className.includes(UNPUSHED_ROW_CLASS);
  /** 커밋 행과 머리 행을 화면 순서대로. */
  const rowOrder = () =>
    [...document.querySelectorAll("[data-commit-id], [data-testid$='-header-row']")].map(
      (el) => el.getAttribute("data-commit-id") ?? el.getAttribute("data-testid"),
    );

  it("tints unpushed commits and puts an 'unpushed work' header above them, an 'on the remote' header above the first pushed one", () => {
    renderPanel();
    expect(["c1", "c2", "c3", "c4"].map(dot)).toEqual(["unpushed", "unpushed", "pushed", "pushed"]);
    expect(["c1", "c2", "c3", "c4"].map(tinted)).toEqual([true, true, false, false]);
    expect(rowOrder()).toEqual(["unpushed-header-row", "c1", "c2", "remote-header-row", "c3", "c4"]);
    // 개수는 사이드바와 Push 버튼이 맡으므로 머리에는 넣지 않는다.
    const unpushedHeader = screen.getByTestId("unpushed-header-row");
    expect(unpushedHeader.textContent).toContain("Not pushed yet");
    expect(unpushedHeader.textContent).toContain("Pushing sends these to the remote");
    expect(within(unpushedHeader).getByRole("button", { name: "See everything to push" })).toBeTruthy();
    const remoteHeader = screen.getByTestId("remote-header-row");
    expect(remoteHeader.textContent).toBe("On origin");
  });

  it("opens the combined diff of the unpushed range from the header, closing it toggles back", () => {
    renderPanel();
    const openBtn = screen.getByRole("button", { name: "See everything to push" });
    fireEvent.click(openBtn);
    expect(openBtn.getAttribute("aria-pressed")).toBe("true");
    // base = 경계가 앉은 커밋(원격에 있는 첫 커밋 c3), head = 열린 워크트리의 HEAD(c1).
    expect(useUnpushedRangeViewStore.getState().range).toEqual({
      repoPath: REPO,
      historyTarget: { kind: "head" },
      baseOid: "c3",
      headOid: "c1",
    });
    fireEvent.click(screen.getByRole("button", { name: "See everything to push" }));
    expect(useUnpushedRangeViewStore.getState().range).toBeNull();
  });

  it("exposes the 'see everything to push' button outside a presentational separator (#5)", () => {
    renderPanel();
    const header = screen.getByTestId("unpushed-header-row");
    // `role="separator"`는 자식을 장식으로 감춰 버튼이 보조기술에 드러나지 않는다 — 이름 붙은
    // 묶음(`group`)으로 바꿔 버튼을 그대로 노출한다.
    expect(header.getAttribute("role")).toBe("group");
    expect(within(header).getByRole("button", { name: "See everything to push" })).toBeTruthy();
  });

  it("closes the open range when another repository or worktree opens (#1)", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "See everything to push" }));
    expect(useUnpushedRangeViewStore.getState().range).not.toBeNull();
    act(() => useRepositoryStore.setState({ activeRepoPath: FEAT }));
    expect(useUnpushedRangeViewStore.getState().range).toBeNull();
  });

  it("closes the open range when the viewed branch changes (#1)", () => {
    branchList.push({ name: "feat/x", isHead: false, isRemote: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "See everything to push" }));
    expect(useUnpushedRangeViewStore.getState().range).not.toBeNull();
    act(() => useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false }));
    expect(useUnpushedRangeViewStore.getState().range).toBeNull();
  });

  // 「열려 있는 동안 head·경계를 따라간다」(#2)는 `unpushed-range-follow.test.tsx`에서 다룬다 — 이 파일의
  // `useCommitHistoryInfinite` mock은 `historyData` 참조를 고정해 두므로(`rerender`가 recompute를
  // 강제하지 않는다) 그 조건에 맞는 별도 mock으로 검증한다.

  it("shows the remote branch actually on the boundary commit, not the checked-out branch (#6)", () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "feat/y",
      defaultBranch: "main",
      committed: [],
    };
    // c3(경계 커밋)에 origin/main 이름표가 실제로 달려 있다 — 체크아웃한 브랜치(feat/y)는 원격에 없다.
    const original = history.pages[0];
    history.pages[0] = original.map((c) =>
      c.id === "c3" ? { ...c, refs: [{ name: "origin/main", kind: "remoteBranch" as const, isHead: false }] } : c,
    );
    try {
      renderPanel();
      const header = screen.getByTestId("remote-header-row");
      expect(header.textContent).toContain("On origin");
      expect(header.textContent).toContain("origin/main");
      expect(header.textContent).not.toContain("feat/y");
      expect(header.getAttribute("aria-label")).toBe("On origin · origin/main");
    } finally {
      history.pages[0] = original;
    }
  });

  it("omits the branch part when the boundary commit carries no remote ref (#6)", () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "feat/y",
      defaultBranch: "main",
      committed: [],
    };
    renderPanel();
    const header = screen.getByTestId("remote-header-row");
    // 체크아웃한 브랜치 이름(feat/y)이 원격에 없는데도 나오면 안 된다.
    expect(header.textContent).toBe("On origin");
    expect(header.textContent).not.toContain("feat/y");
  });

  it("puts the remote header above the base header when both sit on the same commit", async () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "feat/y",
      defaultBranch: "main",
      committed: [],
    };
    renderPanel();
    await screen.findByTestId("base-header-row");
    expect(rowOrder()).toEqual([
      "unpushed-header-row",
      "c1",
      "c2",
      "remote-header-row",
      "base-header-row",
      "c3",
      "c4",
    ]);
  });

  it("names no remote on the header when the repository has several", () => {
    const twoRemotes = {
      ...remoteRepo,
      remotes: [...remoteRepo.remotes, { name: "upstream", url: "https://github.com/u/app.git" }],
    } as RepoInfo;
    useRepositoryStore.setState({ repos: [twoRemotes], activeRepo: twoRemotes, activeRepoPath: REPO });
    renderPanel();
    const header = screen.getByTestId("remote-header-row");
    expect(header.textContent).not.toContain("origin");
    expect(header.textContent).toMatch(/^On remote/);
  });

  it("draws no band, header or hollow dots without a remote", () => {
    useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
    renderPanel();
    expect(screen.queryByTestId("unpushed-header-row")).toBeNull();
    expect(screen.queryByTestId("remote-header-row")).toBeNull();
    expect(["c1", "c3"].map(dot)).toEqual(["plain", "plain"]);
    expect(["c1", "c3"].map(tinted)).toEqual([false, false]);
  });

  it("draws no tint or headers in a repository that has a remote but has never been fetched", () => {
    // 원격은 있지만(remoteRepo) 원격 추적 브랜치가 하나도 없다 — `git fetch`를 한 번도 하지 않은 저장소.
    // 판정(모두 isUnpushed=true)은 맞아도 전체가 칠해지면 강조 효과가 사라지므로 tint·머리를 끈다.
    branchList.length = 0;
    renderPanel();
    expect(screen.queryByTestId("unpushed-header-row")).toBeNull();
    expect(screen.queryByTestId("remote-header-row")).toBeNull();
    expect(["c1", "c2", "c3", "c4"].map(dot)).toEqual(["plain", "plain", "plain", "plain"]);
    expect(["c1", "c2", "c3", "c4"].map(tinted)).toEqual([false, false, false, false]);
  });
});

describe("GraphPanel right-click menus", () => {
  const menuItems = () => within(screen.getByRole("menu")).getAllByRole("menuitem");
  const item = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });

  it("opens another worktree from its WIP row, and offers staging and stash only on the open one", () => {
    renderPanel();
    const other = screen.getByRole("button", { name: "Uncommitted changes · feat/x branch · app-feat · 4 files" });
    fireEvent.contextMenu(other);
    expect(menuItems().map((m) => m.textContent)).toEqual([
      "Show changes",
      "Open this worktree",
      "Reveal in Finder",
      "Open in Terminal",
      "Open in editor",
      "Copy path",
      "Copy branch name",
    ]);
    fireEvent.keyDown(document, { key: "Escape" });

    const own = screen.getByRole("button", { name: "Uncommitted changes · main branch · primary folder · 1 file" });
    fireEvent.contextMenu(own);
    expect(menuItems().map((m) => m.textContent).slice(0, 3)).toEqual([
      "Show changes",
      "Stage and commit…",
      "Stash Changes",
    ]);
    fireEvent.click(item("Stage and commit…"));
    expect(useUIStore.getState().activeTab).toBe("changes");

    fireEvent.contextMenu(other);
    fireEvent.click(item("Open this worktree"));
    expect(openWorktree).toHaveBeenCalledWith(FEAT);
  });

  it("follows the worktree from “Show changes”, like a click on the row", () => {
    renderPanel();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Uncommitted changes · feat/x branch · app-feat · 4 files" }));
    fireEvent.click(item("Show changes"));
    expect(useFollowStore.getState().target).toBe(FEAT);
  });

  it("gives branch labels their own menu: view, checkout, compare, copy, and delete last", () => {
    branchList.push(
      { name: "main", isHead: true, isRemote: false },
      { name: "feat/y", isHead: false, isRemote: false },
    );
    history.pages[0][1] = commit("c2", ["c3"], { refs: [{ name: "feat/y", kind: "localBranch", isHead: false }] });
    try {
      renderPanel();
      const label = document.querySelector('[data-ref-label="feat/y"]') as HTMLElement;
      fireEvent.contextMenu(label);
      // 이름표 메뉴는 커밋 메뉴 대신 열린다.
      expect(screen.getAllByRole("menu")).toHaveLength(1);
      expect(menuItems().map((m) => m.textContent)).toEqual([
        "View without checkout",
        i18n.t("branch.contextMenu.checkout"),
        i18n.t("branch.contextMenu.compare"),
        i18n.t("branch.contextMenu.copyName"),
        "View on GitHub",
        "Delete branch…",
      ]);
      fireEvent.click(item("Delete branch…"));
      // 삭제는 확인 창을 거친다.
      expect(screen.getByRole("dialog")).toBeTruthy();

      fireEvent.contextMenu(document.querySelector('[data-ref-label="main"]') as HTMLElement);
      // 지금 브랜치는 보기·체크아웃·비교·삭제를 막는다.
      const disabled = menuItems()
        .filter((m) => (m as HTMLButtonElement).disabled)
        .map((m) => m.textContent);
      expect(disabled).toEqual([
        "View without checkout",
        i18n.t("branch.contextMenu.checkout"),
        i18n.t("branch.contextMenu.compare"),
        "View on GitHub",
        "Delete branch…",
      ]);
    } finally {
      history.pages[0][1] = commit("c2", ["c3"]);
    }
  });

  it("starts a range compare from a branch label", () => {
    branchList.push(
      { name: "main", isHead: true, isRemote: false },
      { name: "feat/y", isHead: false, isRemote: false },
    );
    history.pages[0][1] = commit("c2", ["c3"], { refs: [{ name: "feat/y", kind: "localBranch", isHead: false }] });
    try {
      renderPanel();
      fireEvent.contextMenu(document.querySelector('[data-ref-label="feat/y"]') as HTMLElement);
      fireEvent.click(item(i18n.t("branch.contextMenu.compare")));
      expect(useBranchRangeStore.getState().range).toMatchObject({ repoPath: REPO, base: "main", target: "feat/y" });
    } finally {
      history.pages[0][1] = commit("c2", ["c3"]);
    }
  });

  it("shows only one other worktree from its chip's menu", () => {
    worktreeState.list = [
      { path: REPO, head: "c1", branch: "main", isMain: true, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
      { path: FEAT, head: "f1", branch: "feat/x", isMain: false, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
    ];
    useGraphWorktreesStore.setState({ shownByRepo: { [REPO]: [] } });
    renderPanel();
    const chips = screen.getByRole("group", { name: "Worktrees to show together in the graph" });
    const featChip = within(chips).getAllByRole("button").find((b) => b.textContent?.startsWith("feat/x"))!;
    fireEvent.contextMenu(featChip);
    fireEvent.click(item("Show only this one"));
    expect(useGraphWorktreesStore.getState().shownByRepo[REPO]).toEqual([FEAT]);
    // 지금 연 워크트리 칩은 늘 보이므로 켜고 끄는 항목을 막는다.
    const mainChip = within(chips).getAllByRole("button").find((b) => b.textContent?.startsWith("main"))!;
    fireEvent.contextMenu(mainChip);
    expect((item("Show only this one") as HTMLButtonElement).disabled).toBe(true);
    expect((item("Open this worktree") as HTMLButtonElement).disabled).toBe(true);
  });
});
