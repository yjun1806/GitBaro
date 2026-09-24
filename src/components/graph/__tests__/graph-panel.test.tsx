// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "zustand";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useFilesViewStore } from "@/components/review/files-view";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useReviewSeenStore } from "@/stores/review-seen";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useFollowStore } from "@/stores/follow";
import { useBranchRangeStore } from "@/components/branch/branch-range";
import { useHistoryViewStore } from "@/stores/history-view";
import { syncStatusPaths } from "@/components/sidebar/tree-model";
import { worktreeColor } from "../worktree-history";
import type {
  CommitInfo,
  GitOperation,
  NewCommitIds,
  RepoInfo,
  RepoReviewStatus,
  SeenRecordInput,
  StatusEntry,
  WorktreeInfo,
} from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/components/stash/StashView", () => ({ StashView: () => <div>stash-list</div> }));
vi.mock("@/components/actions/ActionsView", () => ({ ActionsView: () => <div>actions-list</div> }));
vi.mock("@/components/history/HistoryView", () => ({ HistoryView: () => <div>compare-view</div> }));

const switchTo = async (path: string) => {
  useRepositoryStore.setState({ activeRepoPath: path });
};
const openWorktree = vi.fn(switchTo);
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => openWorktree }));

const REPO = "/work/app";
const FEAT = "/work/app-feat";
const HEADS: Record<string, string> = { [REPO]: "c1", [FEAT]: "f1" };

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

/** 가짜 백엔드: 기준선이 지금 HEAD면 0개, 아니면 HEAD 쪽 2개. */
function fakeIds(entry: SeenRecordInput): NewCommitIds {
  const headOid = HEADS[entry.path];
  const fresh = entry.oid === headOid;
  return {
    path: entry.path,
    headOid,
    newCount: fresh ? 0 : 2,
    basis: "oid",
    ids: fresh ? [] : ["c1", "c2"],
  };
}

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

/** true면 `list_new_commit_ids` 응답을 붙잡아 둔다(백엔드가 아직 세는 중인 상태). */
const backend = { hold: false, pending: [] as (() => void)[] };
vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  listNewCommitIds: vi.fn(
    (entry: SeenRecordInput) =>
      new Promise<NewCommitIds>((resolve) => {
        const answer = () => resolve(fakeIds(entry));
        if (backend.hold) backend.pending.push(answer);
        else answer();
      }),
  ),
}));

/** 그래프가 커밋 목록을 읽은 시작점(`useCommitHistoryInfinite`의 둘째 인자). */
const historyTargets: unknown[] = [];

/** `useBranches` 응답. 기본은 비어 있다. */
const branchList: { name: string; isHead: boolean; isRemote: boolean }[] = [];

/** main 대비 변경(탭 배지·갈라진 지점 행). 테스트마다 채운다. */
const changesVsDefaultByPath: Record<string, unknown> = {};

vi.mock("@/api/queries", async (importOriginal) => ({
  useChangesVsDefaultOnHead: (entries: readonly { path: string }[]) =>
    entries.map((e) => ({ data: changesVsDefaultByPath[e.path] })),
  useStatusMany: () => ({}),
  // 새 커밋 조회는 실제 훅을 쓴다(키·이전 값 유지 방식까지 확인하려고). 명령만 가짜다.
  useNewCommitIdsQuery: (await importOriginal<typeof import("@/api/queries")>()).useNewCommitIdsQuery,
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
  useNewCommitCountsQuery: () => ({ data: [], isLoading: false }),
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

/** 스크롤 영역 안의 행(버튼·구분선)을 화면 순서대로. */
function rowLabels(): string[] {
  const rows = document.querySelectorAll(
    "[role=tabpanel] button:not([data-commit-now]), [role=tabpanel] [role=separator]",
  );
  return [...rows].map((el) =>
    el.getAttribute("role") === "separator"
      ? "--seen--"
      : (el.getAttribute("data-commit-id") ?? el.getAttribute("aria-label") ?? ""),
  );
}

Element.prototype.scrollIntoView = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("en");
  openWorktree.mockReset();
  openWorktree.mockImplementation(switchTo);
  backend.hold = false;
  backend.pending = [];
  worktreeState.list = [];
  worktreeState.histories = {};
  mergeMockStore.setState({ value: null });
  useBranchRangeStore.getState().clear();
  useUIStore.setState({ activeTab: "history", compareBranch: null, repoListOpen: false });
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  useFollowStore.getState().stop();
  useHistoryViewStore.getState().reset();
  historyTargets.length = 0;
  branchList.length = 0;
  useReviewSeenStore.setState({
    entries: {
      [REPO]: { branch: "main", oid: "c3", seenAt: Date.now() - 60_000 },
      [FEAT]: { branch: "feat/x", oid: "f1", seenAt: Date.now() - 60_000 },
    },
    initialScanDone: true,
    scannedRepos: [REPO],
    worktreesByRepo: { [REPO]: [REPO, FEAT] },
  });
});

afterEach(cleanup);

describe("GraphPanel commit graph", () => {
  it("puts a WIP row per worktree on top and the seen divider under the new commits", async () => {
    renderPanel();
    await screen.findByRole("separator");
    expect(rowLabels()).toEqual([
      "Uncommitted changes · feat/x branch · app-feat · 4 files",
      "Uncommitted changes · main branch · main working tree · 1 file",
      "c1",
      "c2",
      "--seen--",
      "c3",
      "c4",
    ]);
    expect(screen.getByRole("separator").textContent).toContain("Seen up to here · today ");
    // The two new commits carry the new-commit dot, older ones do not.
    expect(screen.getAllByTitle("New commit")).toHaveLength(2);
    // Rows below the divider are drawn faded, as in the mockup.
    const seen = [...document.querySelectorAll("[data-seen]")].map((el) => el.getAttribute("data-commit-id"));
    expect(seen).toEqual(["c3", "c4"]);
  });

  it("clears the button, dots and divider at once when marked seen, before the recount returns", async () => {
    renderPanel();
    const button = await screen.findByRole("button", { name: "Mark 2 new commits as seen" });
    backend.hold = true;
    fireEvent.click(button);
    expect(useReviewSeenStore.getState().entries[REPO].oid).toBe("c1");
    // The recount is still pending, yet nothing from the old count is left on screen.
    expect(backend.pending.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /new commits? as seen/ })).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryAllByTitle("New commit")).toHaveLength(0);
    // The recount answers N = 0 and nothing comes back.
    backend.pending.forEach((answer) => answer());
    await waitFor(() => expect(backend.pending.length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /new commits? as seen/ })).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("opens the staging list for the open worktree's WIP row", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: "Uncommitted changes · main branch · main working tree · 1 file" });
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
    expect(screen.getByRole("button", { name: "Uncommitted changes · main branch · main working tree · 1 file" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(row).getByTestId("follow-badge").textContent).toBe("Following");
  });

  it("stops following when a commit is picked or another repository is opened", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes · main branch · main working tree · 1 file" }));
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

  it("keeps the commit context menu items on graph rows", () => {
    renderPanel();
    const row = document.querySelector('[data-commit-id="c2"]') as HTMLElement;
    fireEvent.contextMenu(row);
    expect(useSelectionStore.getState().selectedCommitId).toBe("c2");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      i18n.t("history.contextMenu.createBranch"),
      i18n.t("history.contextMenu.checkout"),
      i18n.t("history.contextMenu.reset"),
      i18n.t("history.contextMenu.revert"),
      i18n.t("history.contextMenu.cherryPick"),
      i18n.t("history.contextMenu.copyHash"),
      i18n.t("history.contextMenu.copyMessage"),
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

  it("keeps the WIP rows above the compare view while a branch is compared", () => {
    useUIStore.setState({ compareBranch: "feat/x" });
    renderPanel();
    expect(screen.getByText("compare-view")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes · main branch · main working tree · 1 file" }));
    expect(useUIStore.getState().activeTab).toBe("changes");
  });

  it("opens changes by file as header-only view state and closes it when another tab is picked", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /^Changes vs / }));
    expect(useFilesViewStore.getState().repoTabOpen).toBe(true);
    expect(screen.getByRole("tab", { name: /^Changes vs / }).getAttribute("aria-selected")).toBe("true");
    // 목록과 diff는 아래 칸(MainColumn)이 그린다. 카드에는 탭 머리와 「저장소별 · 폴더별」만 남는다.
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Group files" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Stash" }));
    expect(useFilesViewStore.getState().repoTabOpen).toBe(false);
    expect(screen.getByText("stash-list")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /^Changes vs / }));
    // 툴바·merge 흐름이 저장된 탭을 바꾸면 닫힌다.
    act(() => useUIStore.getState().setActiveTab("changes"));
    expect(useFilesViewStore.getState().repoTabOpen).toBe(false);
  });

  it("closes changes by file when a pull/merge stops on a conflict, even while already on the changes tab", () => {
    // activeTab이 이미 "changes"라 setActiveTab("changes")가 값을 바꾸지 않는 경우(W7 버그).
    useUIStore.setState({ activeTab: "changes" });
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /^Changes vs / }));
    expect(useFilesViewStore.getState().repoTabOpen).toBe(true);
    // 충돌로 멈춘 pull·merge가 하는 일: mergeState 갱신(react-query 재조회) + setActiveTab("changes")(같은 값이라 그 자체로는 아무것도 안 바꾼다).
    act(() => {
      mergeMockStore.setState({ value: "merge" });
      useUIStore.getState().setActiveTab("changes");
    });
    expect(useFilesViewStore.getState().repoTabOpen).toBe(false);
  });

  it("closes changes by file when a branch compare starts, even while already on the history tab", () => {
    useUIStore.setState({ activeTab: "history" });
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /^Changes vs / }));
    expect(useFilesViewStore.getState().repoTabOpen).toBe(true);
    // BranchZone.handleCompare가 하는 일: range 설정 + setActiveTab("history")(이미 그 값).
    act(() => {
      useBranchRangeStore.getState().setRange({ repoPath: REPO, base: "main", target: "feat/x", head: "main" });
      useUIStore.getState().setActiveTab("history");
    });
    expect(useFilesViewStore.getState().repoTabOpen).toBe(false);
  });

  it("uses Korean labels for the divider and the button", async () => {
    await i18n.changeLanguage("ko");
    renderPanel();
    expect(await screen.findByRole("button", { name: "새 커밋 2개 확인함으로 표시" })).toBeTruthy();
    expect(screen.getByRole("separator").textContent).toContain("여기까지 확인함 · 오늘 ");
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
    const chips = screen.getByRole("group", { name: "Worktrees shown in the graph" });
    const buttons = within(chips).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["mainmain tree1", "feat/xfrom main4"]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(within(chips).getByText("Showing 2 worktrees together in the graph")).toBeTruthy();
    await screen.findByRole("separator");
    expect(rowLabels()).toEqual([
      "Uncommitted changes · feat/x branch · app-feat · 4 files",
      "Uncommitted changes · main branch · main working tree · 1 file",
      "f1",
      "c1",
      "c2",
      "--seen--",
      "c3",
      "c4",
    ]);
  });

  it("hides a worktree's WIP row and commits when its chip is turned off, and brings them back", async () => {
    renderPanel();
    const chips = screen.getByRole("group", { name: "Worktrees shown in the graph" });
    const feat = within(chips).getByRole("button", { name: /feat\/x/ });
    fireEvent.click(feat);
    expect(feat.getAttribute("aria-pressed")).toBe("false");
    await screen.findByRole("separator");
    expect(rowLabels()).toEqual(["Uncommitted changes · main branch · main working tree · 1 file", "c1", "c2", "--seen--", "c3", "c4"]);
    expect(within(chips).getByText("Showing 1 worktree in the graph")).toBeTruthy();

    fireEvent.click(feat);
    expect(rowLabels()).toContain("f1");
    expect(rowLabels()).toContain("Uncommitted changes · feat/x branch · app-feat · 4 files");
  });

  it("draws each worktree's WIP row in its own lane down to its commits, in the chip's color", async () => {
    renderPanel();
    await screen.findByRole("separator");
    const featColor = worktreeColor(FEAT);
    const chips = screen.getByRole("group", { name: "Worktrees shown in the graph" });
    const chipIcon = within(chips).getByRole("button", { name: /feat\/x/ }).querySelector("svg") as SVGElement;
    // jsdom writes inline colors as rgb(); convert the same way before comparing.
    const probe = document.createElement("span");
    probe.style.color = featColor;
    expect((chipIcon as unknown as HTMLElement).style.color).toBe(probe.style.color);
    const wip = screen.getByRole("button", { name: "Uncommitted changes · feat/x branch · app-feat · 4 files" });
    expect(wip.querySelector("circle")?.getAttribute("stroke")).toBe(featColor);
    // The line leaving the WIP row reaches f1, which is drawn in the same color.
    const f1 = document.querySelector('[data-commit-id="f1"]') as HTMLElement;
    expect(f1.querySelector("circle")?.getAttribute("fill")).toBe(featColor);
    expect([...f1.querySelectorAll("path")].some((p) => p.getAttribute("stroke") === featColor)).toBe(true);
  });

  it("does not offer reset or revert on another worktree's commit", async () => {
    renderPanel();
    await screen.findByRole("separator");
    const disabledOf = (id: string) => {
      fireEvent.contextMenu(document.querySelector(`[data-commit-id="${id}"]`) as HTMLElement);
      const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
      const out = items.filter((m) => (m as HTMLButtonElement).disabled).map((m) => m.textContent);
      fireEvent.keyDown(document, { key: "Escape" });
      return out;
    };
    expect(disabledOf("f1")).toEqual([i18n.t("history.contextMenu.reset"), i18n.t("history.contextMenu.revert")]);
    expect(disabledOf("c1")).toEqual([]);
  });

  it("hides the chips while the graph shows a branch comparison", () => {
    useUIStore.setState({ compareBranch: "feat/x" });
    renderPanel();
    expect(screen.getByText("compare-view")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Worktrees shown in the graph" })).toBeNull();
  });

  it("keeps the open worktree on: its chip cannot be turned off", () => {
    renderPanel();
    const chips = screen.getByRole("group", { name: "Worktrees shown in the graph" });
    const main = within(chips).getByRole("button", { name: /^main/ });
    fireEvent.click(main);
    expect(main.getAttribute("aria-pressed")).toBe("true");
    expect(rowLabels()).toContain("Uncommitted changes · main branch · main working tree · 1 file");
  });
});

describe("GraphPanel UI feedback (tab badges, fork point, WIP row, commit entry, compare chip)", () => {
  afterEach(() => {
    for (const key of Object.keys(changesVsDefaultByPath)) delete changesVsDefaultByPath[key];
    branchList.splice(0, branchList.length);
    statusEntries.splice(0, statusEntries.length, { path: "a.ts", status: "modified", staged: false } as StatusEntry);
    useUIStore.setState({ commitFocusAt: null, isDiffMaximized: false });
  });

  it("puts counts on the tabs: new commits and files changed since main", async () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "feat/y",
      defaultBranch: "main",
      committed: [{ path: "x.ts" }, { path: "a.ts" }],
    };
    renderPanel();
    await screen.findByRole("button", { name: "Mark 2 new commits as seen" });
    expect(screen.getByRole("tab", { name: /^Commit graph/ }).textContent).toBe("Commit graph2");
    // x.ts·a.ts(커밋함) + a.ts(커밋 안 함) → 파일 2개.
    expect(screen.getByRole("tab", { name: /^Changes vs / }).textContent).toBe("Changes vs main2");
    // 스태시·Actions가 0이면 배지가 없다.
    expect(screen.getByRole("tab", { name: "Stash" }).textContent).toBe("Stash");
  });

  it("draws the fork-point row right above the merge-base commit", async () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "feat/y",
      defaultBranch: "main",
      committed: [],
    };
    renderPanel();
    const fork = await screen.findByTestId("fork-point-row");
    expect(fork.textContent).toContain("Branched off main here");
    const order = [...document.querySelectorAll("[data-commit-id], [data-testid=fork-point-row]")].map(
      (el) => el.getAttribute("data-commit-id") ?? "fork",
    );
    expect(order).toEqual(["c1", "c2", "fork", "c3", "c4"]);
  });

  it("has no fork-point row on the default branch itself", () => {
    changesVsDefaultByPath[REPO] = {
      baseStatus: "found",
      mergeBaseOid: "c3",
      branch: "main",
      defaultBranch: "main",
      committed: [],
    };
    renderPanel();
    expect(screen.queryByTestId("fork-point-row")).toBeNull();
  });

  it("hides the open worktree's WIP row when nothing is uncommitted, and shows it again", () => {
    statusEntries.splice(0, statusEntries.length);
    const { rerender } = renderPanel();
    expect(screen.queryByRole("button", { name: /· main working tree ·/ })).toBeNull();
    // 다른 워크트리(파일 4개)의 행은 남는다.
    expect(screen.getByRole("button", { name: /feat\/x branch · app-feat · 4 files/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Commit \(/ })).toBeNull();

    statusEntries.push({ path: "b.ts", status: "added", staged: false } as StatusEntry);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <GraphPanel />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /main branch · main working tree · 1 file/ })).toBeTruthy();
  });

  it("names the branch and worktree on every WIP row", () => {
    renderPanel();
    const rows = screen.getAllByTestId("wip-row").map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("feat/x branch");
    expect(rows[0]).toContain("app-feat");
    expect(rows[1]).toContain("main branch");
    expect(rows[1]).toContain("main working tree");
  });

  it("offers Commit (N) on the open worktree's row and in the header, which open the composer", () => {
    useUIStore.setState({ activeTab: "history" });
    renderPanel();
    const buttons = screen.getAllByRole("button", { name: "Commit (1)" });
    // 행에 하나, 패널 머리에 하나.
    expect(buttons).toHaveLength(2);
    // 다른 워크트리 행에는 없다(그 워크트리를 열어야 커밋할 수 있다).
    const featRow = screen.getAllByTestId("wip-row")[0];
    expect(within(featRow).queryByRole("button", { name: /^Commit \(/ })).toBeNull();

    useFollowStore.getState().start(FEAT);
    fireEvent.click(buttons[0]);
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(useFollowStore.getState().target).toBeNull();
    expect(useUIStore.getState().commitFocusAt).not.toBeNull();
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

  it("views another branch without checking it out: no WIP rows, no new-commit marks, a strip with actions", async () => {
    branchList.push({ name: "main", isHead: true, isRemote: false }, { name: "feat/x", isHead: false, isRemote: false });
    renderPanel();
    await screen.findByRole("separator");
    expect(screen.getAllByTestId("wip-row")).toHaveLength(2);

    act(() => useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false }));
    // 커밋 목록은 그 브랜치에서 읽는다.
    expect(historyTargets[historyTargets.length - 1]).toEqual({ kind: "ref", name: "feat/x" });
    // 체크아웃한 작업 트리의 것(WIP 행, 새 커밋 점·확인함 선·버튼, 커밋하기)은 감추고 안내를 둔다.
    expect(screen.queryAllByTestId("wip-row")).toHaveLength(0);
    expect(screen.getByText(i18n.t("historyView.wipHidden"))).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryAllByTitle("New commit")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /new commits? as seen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Commit \(/ })).toBeNull();
    // 커밋 행은 그대로 눌러 상세를 연다.
    fireEvent.click(document.querySelector<HTMLElement>('[data-commit-id="c2"]')!);
    expect(useSelectionStore.getState().selectedCommitId).toBe("c2");

    const strip = screen.getByRole("status");
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
    expect(within(screen.getByRole("status")).queryByRole("button", { name: "Check out this branch" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Viewing\s*All branches/ }));
    fireEvent.click(screen.getByRole("option", { name: /Current checkout/ }));
    expect(useHistoryViewStore.getState().target).toBeNull();
  });

  it("ends viewing when another repository is opened", () => {
    useHistoryViewStore.getState().view(REPO, { kind: "all" });
    renderPanel();
    expect(screen.getByRole("status").textContent).toContain("Viewing All branches");
    act(() => useRepositoryStore.setState({ activeRepoPath: FEAT }));
    expect(useHistoryViewStore.getState().target).toBeNull();
  });
});
