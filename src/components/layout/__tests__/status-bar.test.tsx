// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useHistoryViewStore } from "@/stores/history-view";
import { useScopeStore } from "@/components/scope/scope-store";
import { useUIStore } from "@/stores/ui";
import type { CommitInfo, RepoInfo, StatusEntry, WorktreeInfo } from "@/types";

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

/** `GitStatusLine`·`RepoScopeStatusLine`(저장소 화면)이 읽는 값. 테스트마다 채운다. */
let branchList: { name: string; isHead: boolean; isRemote: boolean }[] = [];
let statusEntries: StatusEntry[] = [];
let worktreeList: WorktreeInfo[] = [];

vi.mock("@/api/queries", () => ({
  useBranches: () => ({ data: branchList }),
  useStatus: (path: string | null) => ({ data: path ? statusEntries : undefined }),
  useMergeState: () => ({ data: null }),
  useWorktrees: () => ({ data: worktreeList }),
  useCommitHistoryInfinite: () => ({
    data: { pages: [[commit("c1")]] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useUnpushedCommits: () => ({ data: undefined }),
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
  worktreeList = [];
  useHistoryViewStore.getState().reset();
  useRepositoryStore.setState({ repos: [], activeRepo: null, activeRepoPath: null, activeWorktrees: {} });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  useScopeStore.getState().viewRepoAggregate(null);
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

  it("workspace scope: names the workspace and says the basis is each repository's own checkout (5.3)", () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: "w1", name: "xames", accountKey: "local", repoPaths: [APP, API] }],
      activeWorkspaceId: "w1",
    });
    useRepositoryStore.setState({ repos: [repo(APP), repo(API)], activeRepo: null, activeRepoPath: null });
    renderBar();
    const bar = screen.getByRole("status");
    expect(bar.dataset.tone).toBe("normal");
    expect(bar.textContent).toBe("Workspace xames · based on each repository's checked-out branch");
  });

  it("repository scope (every worktree): names the repository, its primary branch, and that lanes are worktrees (5.3)", () => {
    branchList = [{ name: "main", isHead: true, isRemote: false }];
    useRepositoryStore.setState({ repos: [repo(REPO)], activeRepo: repo(REPO), activeRepoPath: REPO });
    useScopeStore.getState().viewRepoAggregate(REPO);
    worktreeList = [
      { path: REPO, isMain: true } as WorktreeInfo,
      { path: "/work/app-feat", isMain: false } as WorktreeInfo,
    ];
    renderBar();
    const bar = screen.getByRole("status");
    expect(bar.dataset.tone).toBe("normal");
    expect(bar.textContent).toBe("app · Primary folder ⎇ main · Lanes are worktrees");
  });

  it("repository scope, no linked worktrees: says so instead of 'lanes are worktrees' (5.3)", () => {
    branchList = [{ name: "main", isHead: true, isRemote: false }];
    useRepositoryStore.setState({ repos: [repo(REPO)], activeRepo: repo(REPO), activeRepoPath: REPO });
    useScopeStore.getState().viewRepoAggregate(REPO);
    worktreeList = [{ path: REPO, isMain: true } as WorktreeInfo];
    renderBar();
    expect(screen.getByRole("status").textContent).toBe("app · Primary folder ⎇ main · No linked worktrees");
  });

  it("no repository or workspace chosen: the bar stays, with only the activity log reachable", () => {
    renderBar();
    const bar = screen.getByRole("status");
    expect(bar.dataset.tone).toBe("normal");
    expect(within(bar).getByRole("button", { name: i18n.t("activity.title") })).toBeTruthy();
  });
});
