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
import type { CommitInfo, RepoInfo, RepoReviewStatus, SeenRecordInput, StatusEntry } from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/components/stash/StashView", () => ({ StashView: () => <div>stash-list</div> }));
vi.mock("@/components/actions/ActionsView", () => ({ ActionsView: () => <div>actions-list</div> }));
vi.mock("@/components/history/HistoryView", () => ({ HistoryView: () => <div>compare-view</div> }));

const openWorktree = vi.fn(async (path: string) => {
  useRepositoryStore.setState({ activeRepoPath: path });
});
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
const syncByPath = { [FEAT]: { path: FEAT, dirtyCount: 4 } };

/** 가짜 백엔드: 기준선이 지금 HEAD면 0개, 아니면 2개. */
function fakeCounts(inputs: SeenRecordInput[] | null) {
  return (inputs ?? []).map((i) => ({
    path: i.path,
    headOid: HEADS[i.path],
    newCount: i.oid === HEADS[i.path] ? 0 : 2,
    basis: "oid" as const,
  }));
}

vi.mock("@/api/queries", () => ({
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
  useRepoSyncStatuses: () => ({ data: syncByPath }),
  useReviewStatusQuery: () => ({ data: scan, isLoading: false }),
  useNewCommitCountsQuery: (inputs: SeenRecordInput[] | null) => ({
    data: fakeCounts(inputs),
    isLoading: false,
  }),
}));

const { GraphPanel } = await import("@/components/graph/GraphPanel");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
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
  openWorktree.mockClear();
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
  it("puts a WIP row per worktree on top and the seen divider under the new commits", () => {
    renderPanel();
    expect(rowLabels()).toEqual([
      "Uncommitted changes in feat/x (4)",
      "Uncommitted changes (1)",
      "c1",
      "c2",
      "--seen--",
      "c3",
      "c4",
    ]);
    expect(screen.getByRole("separator").textContent).toContain("Seen up to here");
    // The two new commits carry the new-commit dot, older ones do not.
    expect(screen.getAllByTitle("New commit")).toHaveLength(2);
  });

  it("clears the new commits when the mark-seen button is pressed (N = 0)", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Mark 2 new commits as seen" }));
    expect(useReviewSeenStore.getState().entries[REPO].oid).toBe("c1");
    await waitFor(() => expect(screen.queryByRole("separator")).toBeNull());
    expect(screen.queryByRole("button", { name: /new commits? as seen/ })).toBeNull();
    expect(screen.queryAllByTitle("New commit")).toHaveLength(0);
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

  it("adds the graph's worktrees to the activity watch and removes them on unmount", () => {
    const { unmount } = renderPanel();
    expect(useActivityTargetsStore.getState().extraByKey.graph).toEqual([REPO, FEAT]);
    unmount();
    expect(useActivityTargetsStore.getState().extraByKey.graph).toBeUndefined();
  });

  it("switches to the existing compare view while a branch is compared", () => {
    useUIStore.setState({ compareBranch: "feat/x" });
    renderPanel();
    expect(screen.getByText("compare-view")).toBeTruthy();
  });

  it("uses Korean labels for the divider and the button", async () => {
    await i18n.changeLanguage("ko");
    renderPanel();
    expect(screen.getByRole("button", { name: "새 커밋 2개 확인함으로 표시" })).toBeTruthy();
    expect(screen.getByRole("separator").textContent).toContain("여기까지 확인함");
  });
});
