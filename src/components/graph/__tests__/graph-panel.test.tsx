// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useReviewSeenStore } from "@/stores/review-seen";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { syncStatusPaths } from "@/components/sidebar/tree-model";
import type { CommitInfo, NewCommitIds, RepoInfo, RepoReviewStatus, SeenRecordInput, StatusEntry } from "@/types";

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

vi.mock("@/api/queries", async (importOriginal) => ({
  // 새 커밋 조회는 실제 훅을 쓴다(키·이전 값 유지 방식까지 확인하려고). 명령만 가짜다.
  useNewCommitIdsQuery: (await importOriginal<typeof import("@/api/queries")>()).useNewCommitIdsQuery,
  useStatus: (path: string | null) => ({ data: path ? statusEntries : undefined }),
  useStashList: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: [] }),
  useCommitHistoryInfinite: () => ({
    data: history,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useBranches: () => ({ data: [] }),
  useRemoteTags: () => ({ data: undefined }),
  useCommitAvatars: () => ({ data: {} }),
  useWorktrees: () => ({ data: [] }),
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
  const rows = document.querySelectorAll("[role=tabpanel] button, [role=tabpanel] [role=separator]");
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
  useUIStore.setState({ activeTab: "history", compareBranch: null, repoListOpen: false });
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
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
      "Uncommitted changes in feat/x (4)",
      "Uncommitted changes (1)",
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
    const row = screen.getByRole("button", { name: "Uncommitted changes (1)" });
    fireEvent.click(row);
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(openWorktree).not.toHaveBeenCalled();
  });

  it("opens another worktree and its staging list from that worktree's WIP row", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes in feat/x (4)" }));
    await waitFor(() => expect(useUIStore.getState().activeTab).toBe("changes"));
    expect(openWorktree).toHaveBeenCalledWith(FEAT);
    expect(useRepositoryStore.getState().activeRepoPath).toBe(FEAT);
  });

  it("stays put when the other worktree could not be opened", async () => {
    // useOpenWorktree restores the previous path and shows a toast on failure.
    openWorktree.mockImplementation(async () => {});
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes in feat/x (4)" }));
    await waitFor(() => expect(openWorktree).toHaveBeenCalledWith(FEAT));
    await new Promise((r) => setTimeout(r, 0));
    expect(useUIStore.getState().activeTab).toBe("history");
  });

  it("keeps a commit picked while another worktree is still opening", async () => {
    // Like useOpenWorktree: the path switches at once, the branch/status load takes a while.
    let finish = () => {};
    openWorktree.mockImplementation((path: string) => {
      useRepositoryStore.setState({ activeRepoPath: path });
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes in feat/x (4)" }));
    await waitFor(() => expect(useRepositoryStore.getState().activeRepoPath).toBe(FEAT));
    fireEvent.click(document.querySelector('[data-commit-id="c2"]') as HTMLElement);
    finish();
    await waitFor(() => expect(openWorktree).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(useUIStore.getState().activeTab).toBe("history");
    expect(useSelectionStore.getState().selectedCommitId).toBe("c2");
  });

  it("shows when another worktree's files last changed", () => {
    renderPanel();
    const row = screen.getByRole("button", { name: "Uncommitted changes in feat/x (4)" });
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
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes (1)" }));
    expect(useUIStore.getState().activeTab).toBe("changes");
  });

  it("uses Korean labels for the divider and the button", async () => {
    await i18n.changeLanguage("ko");
    renderPanel();
    expect(await screen.findByRole("button", { name: "새 커밋 2개 확인함으로 표시" })).toBeTruthy();
    expect(screen.getByRole("separator").textContent).toContain("여기까지 확인함 · 오늘 ");
  });
});
