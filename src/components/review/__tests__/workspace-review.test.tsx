// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useReviewSeenStore } from "@/stores/review-seen";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import type { ActivityEvent, CommitInfo, NewCommitIds, RepoInfo, StatusEntry, WorkspaceRepoHistory } from "@/types";

const APP = "/w/xames-app";
const API = "/w/xames-backend";
const DESIGN = "/w/xames-design";
const API_WT = "/w/xames-backend-feat";

function commit(id: string, timestamp: number): CommitInfo {
  return {
    id,
    shortId: id,
    message: `subject ${id}`,
    summary: `subject ${id}`,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp,
    parentIds: [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

function history(path: string, branch: string, commits: CommitInfo[]): WorkspaceRepoHistory {
  return {
    path,
    branch,
    headOid: commits[0]?.id ?? "base",
    defaultBranch: "main",
    baseRef: "origin/main",
    baseStatus: "found",
    mergeBaseOid: "base",
    mergeBaseCommit: commit("base", 1),
    commits,
    truncated: false,
    error: null,
  };
}

const histories: Record<string, WorkspaceRepoHistory> = {
  [APP]: history(APP, "feat/noti", [commit("app2", 300), commit("app1", 100)]),
  [API]: history(API, "feat/noti", [commit("api1", 200)]),
  // main에 있고 새 커밋도 WIP도 없음 → 숨김
  [DESIGN]: history(DESIGN, "main", []),
};
const statuses: Record<string, StatusEntry[]> = {
  [API_WT]: [{ path: "src/settings.ts", status: "modified", staged: false } as StatusEntry],
};
const counted: Record<string, NewCommitIds> = {
  [APP]: { path: APP, headOid: "app2", newCount: 1, basis: "oid", ids: ["app2"] },
};

vi.mock("@/api/queries", () => ({
  useReviewStatusQuery: () => ({
    data: [
      { repoPath: APP, worktrees: [{ path: APP, branch: "feat/noti", headOid: "app2", isMain: true }] },
      {
        repoPath: API,
        worktrees: [
          { path: API, branch: "feat/noti", headOid: "api1", isMain: true },
          { path: API_WT, branch: "feat/api-wt", headOid: "x", isMain: false },
        ],
      },
      { repoPath: DESIGN, worktrees: [{ path: DESIGN, branch: "main", headOid: "base", isMain: true }] },
    ],
    isLoading: false,
  }),
  useNewCommitCountsQuery: () => ({ data: undefined, isLoading: false }),
  useWorkspaceHistories: (repos: { path: string }[]) => repos.map((r) => histories[r.path]),
  useStatusMany: (paths: string[]) =>
    Object.fromEntries(paths.filter((p) => statuses[p]).map((p) => [p, statuses[p]])),
  useNewCommitIdsMany: () => counted,
  useCommitDetail: (_path: string, oid: string) => ({
    data: { commit: commit(oid, 1), changedFiles: [] },
    isLoading: false,
    isError: false,
  }),
  useCommitFileDiff: () => ({ data: null }),
  useFileDiff: () => ({ data: null, isLoading: false, isError: false }),
}));

vi.mock("@/components/history/CommitDetail", () => ({
  CommitDetail: ({ commit: c, repoPath }: { commit: CommitInfo; repoPath: string }) => (
    <div>{`commit-detail ${repoPath} ${c.id}`}</div>
  ),
}));
vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));

type Handler = (event: { payload: ActivityEvent }) => void;
const handlers: Handler[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: Handler) => {
    handlers.push(handler);
    return () => {
      const i = handlers.indexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    };
  }),
}));

const { WorkspaceReview } = await import("../WorkspaceReview");

const repo = (path: string): RepoInfo =>
  ({
    path,
    name: path.split("/").pop(),
    currentBranch: "main",
    isDirty: false,
    remotes: [],
    accountId: null,
  }) as unknown as RepoInfo;

Element.prototype.scrollIntoView = vi.fn();

let client: QueryClient;

function renderReview() {
  client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceReview workspaceId="w1" paths={[APP, API, DESIGN]} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  handlers.length = 0;
  useRepositoryStore.setState({ repos: [repo(APP), repo(API), repo(DESIGN)], activeRepo: null, activeRepoPath: null });
  useWorkspaceStore.setState({
    workspaces: [{ id: "w1", name: "xames", accountKey: "local", repoPaths: [APP, API, DESIGN] }],
    activeWorkspaceId: "w1",
  });
  useReviewSeenStore.setState({ initialScanDone: true, scannedRepos: [APP, API, DESIGN], entries: {} });
});

afterEach(cleanup);

const laneFill = (container: HTMLElement, commitId: string) =>
  container.querySelector(`[data-commit-id="${commitId}"] circle`)?.getAttribute("fill");

describe("WorkspaceReview", () => {
  it("titles the screen with workspace, account and how many repositories are shown", () => {
    renderReview();
    expect(screen.getByRole("heading", { name: "xames" })).toBeTruthy();
    expect(screen.getByText("Workspace · Local · showing 2 of 3 repositories")).toBeTruthy();
  });

  it("hides a quiet repository on main and shows it again with show all", () => {
    renderReview();
    const legend = screen.getByTestId("repo-legend");
    expect(within(legend).queryByText("xames-design")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all (1 hidden)" }));
    expect(within(legend).getByText("xames-design")).toBeTruthy();
    expect(screen.getByText("Workspace · Local · showing 3 of 3 repositories")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide quiet repositories" }));
    expect(within(legend).queryByText("xames-design")).toBeNull();
  });

  it("draws WIP rows, new-commit divider and the base row", () => {
    renderReview();
    expect(screen.getByRole("button", { name: "Uncommitted changes in xames-backend (1 file)" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Seen up to here" })).toBeTruthy();
    expect(screen.getByText("Where each repository branched off main")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark 1 new commit as seen" })).toBeTruthy();
  });

  it("keeps each repository's lane colour when another repository is hidden or shown", () => {
    const { container } = renderReview();
    const before = { app: laneFill(container, "app1"), api: laneFill(container, "api1") };
    expect(before.app).toBe(repoLaneColor(APP));
    expect(before.api).toBe(repoLaneColor(API));
    fireEvent.click(screen.getByRole("button", { name: "Show all (1 hidden)" }));
    expect(laneFill(container, "app1")).toBe(before.app);
    expect(laneFill(container, "api1")).toBe(before.api);
  });

  it("opens the commit detail of the picked repository", () => {
    const { container } = renderReview();
    fireEvent.click(container.querySelector('[data-commit-id="api1"]') as HTMLElement);
    expect(screen.getByText(`commit-detail ${API} api1`)).toBeTruthy();
  });

  it("lists the uncommitted files of a picked WIP row", () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes in xames-backend (1 file)" }));
    expect(screen.getByText("settings.ts")).toBeTruthy();
    expect(screen.getByText("diff-viewer")).toBeTruthy();
  });

  it("invalidates only the changed repository's queries on repo:activity", async () => {
    renderReview();
    await act(async () => {});
    expect(handlers).toHaveLength(1);
    const spy = vi.spyOn(client, "invalidateQueries");
    act(() => handlers[0]({ payload: { path: API_WT, at: Date.now() } }));
    const keys = spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([
      ["status", API],
      ["status", API_WT],
      ["fileDiff", API],
      ["fileDiff", API_WT],
      ["workspaceHistory", API],
    ]);
    expect(keys.flat()).not.toContain(APP);
    spy.mockClear();
    act(() => handlers[0]({ payload: { path: "/somewhere/else", at: Date.now() } }));
    expect(spy).not.toHaveBeenCalled();
  });
});
