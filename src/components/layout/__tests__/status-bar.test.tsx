// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useHistoryViewStore } from "@/stores/history-view";
import { useUIStore } from "@/stores/ui";
import type { CommitInfo, RepoInfo, RepoReviewStatus, StatusEntry } from "@/types";

const REPO = "/work/app";
const APP = "/w/xames-app";
const API = "/w/xames-backend";

function commit(id: string): CommitInfo {
  return {
    id,
    shortId: id,
    message: `subject ${id}`,
    summary: `subject ${id}`,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp: 1_700_000_000,
    parentIds: [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

/** `GitStatusLine`(저장소 화면)이 읽는 값. 테스트마다 채운다. */
let branchList: { name: string; isHead: boolean; isRemote: boolean }[] = [];
let statusEntries: StatusEntry[] = [];

/** `useWorkspaceReview`(워크스페이스 화면)가 읽는 값. 테스트마다 채운다. */
let reviewRepos: RepoReviewStatus[] = [];
let statuses: Record<string, StatusEntry[]> = {};
let syncByPath: Record<string, { unpushed: number }> = {};

vi.mock("@/api/queries", () => ({
  // GitStatusLine(저장소 화면)
  useBranches: () => ({ data: branchList }),
  useStatus: (path: string | null) => ({ data: path ? statusEntries : undefined }),
  useMergeState: () => ({ data: null }),
  useWorktrees: () => ({ data: [] }),
  useCommitHistoryInfinite: () => ({
    data: { pages: [[commit("c1")]] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useUnpushedCommits: () => ({ data: undefined }),
  // WorkspaceStatusLine → useWorkspaceReview(워크스페이스 화면)
  useReviewStatusQuery: () => ({ data: reviewRepos, isLoading: false }),
  useWorkspaceHistories: (repos: { path: string }[]) => repos.map(() => undefined),
  useStatusMany: (paths: string[]) =>
    Object.fromEntries(paths.filter((p) => statuses[p]).map((p) => [p, statuses[p]])),
  useRepoSyncStatuses: () => ({ data: syncByPath }),
}));

const { StatusBar } = await import("@/components/layout/StatusBar");

const repo = (path: string): RepoInfo =>
  ({ path, name: path.split("/").pop(), remotes: [], accountId: null }) as unknown as RepoInfo;

function renderBar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StatusBar />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  branchList = [];
  statusEntries = [];
  reviewRepos = [];
  statuses = {};
  syncByPath = {};
  useHistoryViewStore.getState().reset();
  useRepositoryStore.setState({ repos: [], activeRepo: null, activeRepoPath: null, activeWorktrees: {} });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  useUIStore.setState({ isActivityLogOpen: false });
});

afterEach(cleanup);

describe("StatusBar", () => {
  it("repository scope: shows the git status sentence and reaches the activity log", () => {
    branchList = [{ name: "main", isHead: true, isRemote: false }];
    useRepositoryStore.setState({ repos: [repo(REPO)], activeRepo: repo(REPO), activeRepoPath: REPO });
    renderBar();
    const bar = screen.getByRole("status");
    expect(bar.dataset.tone).toBe("normal");
    expect(bar.textContent).toContain("Primary folder");
    expect(bar.textContent).toContain("Checked out ⎇ main");
    const activityButton = within(bar).getByRole("button", { name: i18n.t("activity.title") });
    fireEvent.click(activityButton);
    expect(useUIStore.getState().isActivityLogOpen).toBe(true);
  });

  it("repository scope, viewing another branch: the whole bar becomes the viewing strip", () => {
    branchList = [
      { name: "main", isHead: true, isRemote: false },
      { name: "feat/x", isHead: false, isRemote: false },
    ];
    useRepositoryStore.setState({ repos: [repo(REPO)], activeRepo: repo(REPO), activeRepoPath: REPO });
    act(() => useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false }));
    renderBar();
    const bar = screen.getByRole("status");
    expect(bar.dataset.tone).toBe("viewing");
    expect(bar.textContent).toContain("Viewing feat/x · not checked out");
    fireEvent.click(screen.getByRole("button", { name: "Back to current branch" }));
    expect(useHistoryViewStore.getState().target).toBeNull();
  });

  it("workspace scope: says how many repositories have changes or commits to push", () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: "w1", name: "xames", accountKey: "local", repoPaths: [APP, API] }],
      activeWorkspaceId: "w1",
    });
    useRepositoryStore.setState({ repos: [repo(APP), repo(API)], activeRepo: null, activeRepoPath: null });
    reviewRepos = [
      { repoPath: APP, worktrees: [{ path: APP, branch: "feat/x", headOid: "a1", isMain: true }] },
      { repoPath: API, worktrees: [{ path: API, branch: "main", headOid: "b1", isMain: true }] },
    ];
    statuses = { [APP]: [{ path: "a.ts", status: "modified", staged: false } as StatusEntry] };
    syncByPath = { [API]: { unpushed: 2 } };
    renderBar();
    const bar = screen.getByRole("status");
    expect(bar.dataset.tone).toBe("normal");
    expect(bar.textContent).toBe("1 repository has changes · 1 repository has commits to push");
  });

  it("workspace scope, nothing to do anywhere: says every repository is quiet", () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: "w1", name: "xames", accountKey: "local", repoPaths: [APP] }],
      activeWorkspaceId: "w1",
    });
    useRepositoryStore.setState({ repos: [repo(APP)], activeRepo: null, activeRepoPath: null });
    reviewRepos = [{ repoPath: APP, worktrees: [{ path: APP, branch: "main", headOid: "a1", isMain: true }] }];
    renderBar();
    expect(screen.getByRole("status").textContent).toBe("All repositories are quiet");
  });

  it("no repository or workspace chosen: the bar stays, with only the activity log reachable", () => {
    renderBar();
    const bar = screen.getByRole("status");
    expect(bar.dataset.tone).toBe("normal");
    expect(within(bar).getByRole("button", { name: i18n.t("activity.title") })).toBeTruthy();
  });
});
