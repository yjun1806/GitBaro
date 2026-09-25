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
import { useGraphWorktreesStore } from "../graph-worktrees";
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

const unpushedState = vi.hoisted(() => ({ value: undefined as unknown }));
const stashPush = vi.hoisted(() => vi.fn(async (_message?: string) => "stash-oid" as string | null));
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

/** 스크롤 영역 안의 행(버튼·구분선)을 화면 순서대로. */
function rowLabels(): string[] {
  const rows = document.querySelectorAll(
    "[role=tabpanel] button:not([data-working-changes]), [role=tabpanel] [role=separator]",
  );
  // 「여기까지 확인함」은 확인한 첫 커밋 레인의 눈금이다. 그 행 앞에 "--seen--"을 끼워 순서를 본다.
  return [...rows].flatMap((el) =>
    el.getAttribute("role") === "separator"
      ? ["--seen--"]
      : [
          ...(el.querySelector("[data-testid=seen-tick]") ? ["--seen--"] : []),
          el.getAttribute("data-commit-id") ?? el.getAttribute("aria-label") ?? "",
        ],
  );
}

Element.prototype.scrollIntoView = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("en");
  // 기존 시나리오는 다른 워크트리도 함께 보는 상태다. 기본(지금 워크트리만)은 따로 본다.
  useGraphWorktreesStore.setState({ shownByRepo: { [REPO]: [FEAT] } });
  openWorktree.mockReset();
  openWorktree.mockImplementation(switchTo);
  backend.hold = false;
  backend.pending = [];
  worktreeState.list = [];
  worktreeState.histories = {};
  mergeMockStore.setState({ value: null });
  useBranchRangeStore.getState().clear();
  // 이 파일의 기존 시나리오는 「확인하지 않은 커밋」 기준(확인함 표시)이다. 기본 기준은 따로 본다.
  useUIStore.setState({ activeTab: "history", repoListOpen: false, reviewBasis: "unseen" });
  unpushedState.value = undefined;
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
    await screen.findByTestId("seen-tick");
    expect(rowLabels()).toEqual([
      "Uncommitted changes · feat/x branch · app-feat · 4 files",
      "Uncommitted changes · main branch · primary folder · 1 file",
      "c1",
      "c2",
      "--seen--",
      "c3",
      "c4",
    ]);
    expect(screen.getByTestId("seen-tick").getAttribute("aria-label")).toContain("Seen up to here · today ");
    // The two new commits carry the new-commit dot, older ones do not.
    expect(screen.getAllByTitle("New commit")).toHaveLength(2);
    // Rows below the divider are drawn faded, as in the mockup.
    const seen = [...document.querySelectorAll("[data-seen]")].map((el) => el.getAttribute("data-commit-id"));
    expect(seen).toEqual(["c3", "c4"]);
  });

  it("hides every seen marker by default and badges the graph tab with commits not on any remote", async () => {
    useUIStore.setState({ reviewBasis: "unpushed" });
    unpushedState.value = { count: 3, hasUpstream: false, hasRemote: true, commits: [] };
    renderPanel();
    await screen.findByText("c1");
    expect(screen.queryByTestId("seen-tick")).toBeNull();
    expect(screen.queryByRole("button", { name: /new commits? as seen/ })).toBeNull();
    expect(screen.queryAllByTitle("New commit")).toHaveLength(0);
    expect(document.querySelectorAll("[data-seen]")).toHaveLength(0);
    const graphTab = screen.getByRole("tab", { name: /Commit graph/ });
    expect(graphTab.textContent).toContain("3");
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
    expect(screen.queryByTestId("seen-tick")).toBeNull();
    expect(screen.queryAllByTitle("New commit")).toHaveLength(0);
    // The recount answers N = 0 and nothing comes back.
    backend.pending.forEach((answer) => answer());
    await waitFor(() => expect(backend.pending.length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /new commits? as seen/ })).toBeNull();
    expect(screen.queryByTestId("seen-tick")).toBeNull();
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
    expect(within(row).getByTestId("follow-badge").textContent).toBe("Following");
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
    expect(screen.getByTestId("seen-tick").getAttribute("aria-label")).toContain("여기까지 확인함 · 오늘 ");
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
    await screen.findByTestId("seen-tick");
    expect(rowLabels()).toEqual([
      "Uncommitted changes · feat/x branch · app-feat · 4 files",
      "Uncommitted changes · main branch · primary folder · 1 file",
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
    const chips = screen.getByRole("group", { name: "Worktrees to show together in the graph" });
    const feat = within(chips).getByRole("button", { name: /feat\/x/ });
    fireEvent.click(feat);
    expect(feat.getAttribute("aria-pressed")).toBe("false");
    await screen.findByTestId("seen-tick");
    expect(rowLabels()).toEqual(["Uncommitted changes · main branch · primary folder · 1 file", "c1", "c2", "--seen--", "c3", "c4"]);
    expect(within(chips).getByRole("button", { name: "1 more worktree · show together" })).toBeTruthy();

    fireEvent.click(feat);
    expect(rowLabels()).toContain("f1");
    expect(rowLabels()).toContain("Uncommitted changes · feat/x branch · app-feat · 4 files");
  });

  it("draws each worktree's WIP row in its own lane down to its commits, in the chip's color", async () => {
    renderPanel();
    await screen.findByTestId("seen-tick");
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
    await screen.findByTestId("seen-tick");
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
      expect(c1.querySelector("[data-lane-label]")?.textContent).toBe("main");
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

  it("offers Working changes N on the open worktree's row and in the status line, which open the staging list", () => {
    useUIStore.setState({ activeTab: "history" });
    useSelectionStore.getState().selectCommit("c2");
    renderPanel();
    const buttons = screen.getAllByRole("button", { name: "Working changes 1" });
    // 행에 하나, 상태 줄에 하나. 커밋하는 버튼처럼 보이는 이름은 없다.
    expect(buttons).toHaveLength(2);
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

  it("views another branch without checking it out: no WIP rows, no new-commit marks, a strip with actions", async () => {
    branchList.push({ name: "main", isHead: true, isRemote: false }, { name: "feat/x", isHead: false, isRemote: false });
    renderPanel();
    await screen.findByTestId("seen-tick");
    expect(screen.getAllByTestId("wip-row")).toHaveLength(2);

    act(() => useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false }));
    // 커밋 목록은 그 브랜치에서 읽는다.
    expect(historyTargets[historyTargets.length - 1]).toEqual({ kind: "ref", name: "feat/x" });
    // 체크아웃한 작업 트리의 것(WIP 행, 새 커밋 점·확인함 선·버튼, 작업 중인 변경 버튼)은 감추고 안내를 둔다.
    expect(screen.queryAllByTestId("wip-row")).toHaveLength(0);
    expect(screen.getByText(i18n.t("historyView.wipHidden"))).toBeTruthy();
    expect(screen.queryByTestId("seen-tick")).toBeNull();
    expect(screen.queryAllByTitle("New commit")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /new commits? as seen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Working changes/ })).toBeNull();
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

describe("GraphPanel commits not on any remote", () => {
  const remoteRepo = { ...repo, remotes: [{ name: "origin", url: "https://github.com/o/app.git" }] } as RepoInfo;

  beforeEach(() => {
    useUIStore.setState({ reviewBasis: "unpushed" });
    useRepositoryStore.setState({ repos: [remoteRepo], activeRepo: remoteRepo, activeRepoPath: REPO });
    const [c1, c2, c3, c4] = history.pages[0];
    history.pages[0] = [
      { ...c1, isUnpushed: true },
      { ...c2, isUnpushed: true },
      { ...c3, isUnpushed: false },
      { ...c4, isUnpushed: false },
    ];
  });

  afterEach(() => {
    history.pages[0] = history.pages[0].map(({ isUnpushed: _drop, ...c }) => c);
  });

  it("draws unpushed commits solid and pushed ones hollow, with a boundary at the first pushed commit", () => {
    renderPanel();
    const dot = (id: string) =>
      document.querySelector(`[data-commit-id="${id}"] circle[data-dot]`)?.getAttribute("data-dot");
    expect(["c1", "c2", "c3", "c4"].map(dot)).toEqual(["unpushed", "unpushed", "pushed", "pushed"]);
    const boundary = document.querySelectorAll("[data-remote-boundary]");
    expect([...boundary].map((el) => el.getAttribute("data-commit-id"))).toEqual(["c3"]);
    expect(screen.getByTestId("remote-boundary").getAttribute("title")).toBe("On a remote from here down");
  });

  it("keeps plain dots in the seen-marker mode", () => {
    useUIStore.setState({ reviewBasis: "unseen" });
    renderPanel();
    expect(document.querySelector('[data-commit-id="c1"] circle[data-dot]')?.getAttribute("data-dot")).toBe("plain");
    expect(document.querySelector("[data-remote-boundary]")).toBeNull();
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
