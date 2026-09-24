// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useReviewSeenStore } from "@/stores/review-seen";
import { useFollowStore } from "@/stores/follow";
import { repoLaneColor } from "@/components/graph/repo-lanes";
import type {
  ActivityEvent,
  CommitInfo,
  NewCommitIds,
  RepoInfo,
  RepoReviewStatus,
  StatusEntry,
  WorkspaceRepoHistory,
} from "@/types";

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

const baseHistories = (): Record<string, WorkspaceRepoHistory> => ({
  [APP]: history(APP, "feat/noti", [commit("app2", 300), commit("app1", 100)]),
  [API]: history(API, "feat/noti", [commit("api1", 200)]),
  // main에 있고 새 커밋도 WIP도 없음 → 숨김
  [DESIGN]: history(DESIGN, "main", []),
});
const baseCounted = (): Record<string, NewCommitIds> => ({
  [APP]: { path: APP, headOid: "app2", newCount: 1, basis: "oid", ids: ["app2"] },
});
const baseReviewRepos = (): RepoReviewStatus[] => [
  { repoPath: APP, worktrees: [{ path: APP, branch: "feat/noti", headOid: "app2", isMain: true }] },
  {
    repoPath: API,
    worktrees: [
      { path: API, branch: "feat/noti", headOid: "api1", isMain: true },
      { path: API_WT, branch: "feat/api-wt", headOid: "x", isMain: false },
    ],
  },
  { repoPath: DESIGN, worktrees: [{ path: DESIGN, branch: "main", headOid: "base", isMain: true }] },
];
let reviewRepos = baseReviewRepos();
let histories = baseHistories();
let counted = baseCounted();
let recent: Record<string, CommitInfo[]> = {};
const statuses: Record<string, StatusEntry[]> = {
  [API_WT]: [{ path: "src/settings.ts", status: "modified", staged: false } as StatusEntry],
};

vi.mock("@/api/queries", () => ({
  useReviewStatusQuery: () => ({ data: reviewRepos, isLoading: false }),
  useNewCommitCountsQuery: () => ({ data: undefined, isLoading: false }),
  useWorkspaceHistories: (repos: { path: string }[]) => repos.map((r) => histories[r.path]),
  useStatusMany: (paths: string[]) =>
    Object.fromEntries(paths.filter((p) => statuses[p]).map((p) => [p, statuses[p]])),
  useNewCommitIdsMany: () => counted,
  useWorkspaceRecentCommits: (repos: { path: string }[]) =>
    Object.fromEntries(repos.filter((r) => recent[r.path]).map((r) => [r.path, recent[r.path]])),
  useCommitDetail: (_path: string, oid: string) => ({
    data: { commit: commit(oid, 1), changedFiles: [] },
    isLoading: false,
    isError: false,
  }),
  useCommitFileDiff: () => ({ data: null }),
  useFileDiff: () => ({ data: null, isLoading: false, isError: false }),
  // W6-T1 따라가기: WIP 행을 고르면 그 워크트리의 파일을 수정 시각 순으로 읽는다.
  useWipFiles: (path: string) => ({
    data: (statuses[path] ?? []).map((e) => ({
      path: e.path,
      origPath: null,
      status: e.status,
      staged: e.staged,
      unstaged: !e.staged,
      modifiedAt: 1,
      insertions: 1,
      deletions: 0,
    })),
    isLoading: false,
    isError: false,
  }),
  fetchFileDiff: () => new Promise(() => {}),
  useWorktrees: () => ({ data: [] }),
  // W6-T2 워크트리 칩·겹침 경고
  useWorktreeHeadHistories: () => [],
  useWipFilesMany: () => [],
  useSiblingFileDiffs: (sides: unknown[]) => sides.map(() => ({ data: undefined })),
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

vi.mock("../FilesByRepo", () => ({
  FilesByRepo: ({ repos }: { repos: { name: string }[] }) => (
    <div>files-by-repo {repos.map((r) => r.name).join(",")}</div>
  ),
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
  histories = baseHistories();
  counted = baseCounted();
  recent = {};
  reviewRepos = baseReviewRepos();
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
    expect(screen.getByText("Where each repository branched off its default branch")).toBeTruthy();
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

  it("switches the graph panel to changes by file for the shown repositories and back", () => {
    renderReview();
    fireEvent.click(screen.getByRole("tab", { name: "Changes by file" }));
    // xames-backend는 워크트리가 둘이라(main + xames-backend-feat) 그래프의 WIP 행과 같은 목록이 나온다(W7 review).
    expect(
      screen.getByText("files-by-repo xames-app,xames-backend,xames-backend · xames-backend-feat"),
    ).toBeTruthy();
    expect(screen.queryByText("Where each repository branched off its default branch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all (1 hidden)" }));
    expect(
      screen.getByText(
        "files-by-repo xames-app,xames-backend,xames-backend · xames-backend-feat,xames-design",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Commit graph" }));
    expect(screen.getByText("Where each repository branched off its default branch")).toBeTruthy();
  });

  it("lists every worktree of a repository in the files tab, not just its main working tree (W7 review)", () => {
    renderReview();
    fireEvent.click(screen.getByRole("tab", { name: "Changes by file" }));
    const filesByRepo = screen.getByText(/^files-by-repo /);
    const names = filesByRepo.textContent!.replace("files-by-repo ", "").split(",");
    expect(names).toEqual(["xames-app", "xames-backend", "xames-backend · xames-backend-feat"]);
  });

  it("opens the commit detail of the picked repository", () => {
    const { container } = renderReview();
    fireEvent.click(container.querySelector('[data-commit-id="api1"]') as HTMLElement);
    expect(screen.getByText(`commit-detail ${API} api1`)).toBeTruthy();
  });

  it("follows the worktree of a picked WIP row and lists its uncommitted files", () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes in xames-backend (1 file)" }));
    expect(useFollowStore.getState().target).toBe(API_WT);
    expect(screen.getByText("settings.ts")).toBeTruthy();
    expect(screen.getByText("diff-viewer")).toBeTruthy();
    // 「따라가는 중」은 고른 WIP 행과 파일 목록 머리에 붙는다.
    expect(screen.getAllByTestId("follow-badge").map((b) => b.textContent)).toEqual(["Following", "Following"]);
  });

  it("invalidates only the changed worktree's queries on repo:activity", async () => {
    renderReview();
    await act(async () => {});
    expect(handlers).toHaveLength(1);
    const spy = vi.spyOn(client, "invalidateQueries");
    act(() => handlers[0]({ payload: { path: API_WT, at: Date.now() } }));
    const keys = spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([
      ["status", API_WT],
      ["fileDiff", API_WT],
    ]);
    expect(keys.flat()).not.toContain(APP);
    expect(keys.flat()).not.toContain(API);
    spy.mockClear();
    act(() => handlers[0]({ payload: { path: "/somewhere/else", at: Date.now() } }));
    expect(spy).not.toHaveBeenCalled();
  });
  it("draws new commits pulled into a repository on main, even though they are not past the merge base", () => {
    // main이 origin/main과 같아 갈라진 지점이 HEAD다 → 타임라인이 비었다.
    histories[DESIGN] = { ...history(DESIGN, "main", []), headOid: "d3", mergeBaseOid: "d3", mergeBaseCommit: commit("d3", 90) };
    counted[DESIGN] = { path: DESIGN, headOid: "d3", newCount: 2, basis: "oid", ids: ["d3", "d2"] };
    recent[DESIGN] = [commit("d3", 90), commit("d2", 80), commit("d1", 70)];
    const { container } = renderReview();
    expect(screen.getByText("Workspace · Local · showing 3 of 3 repositories")).toBeTruthy();
    expect(container.querySelector('[data-commit-id="d3"]')).toBeTruthy();
    expect(container.querySelector('[data-commit-id="d2"]')).toBeTruthy();
    // 이미 확인한 커밋은 더하지 않는다.
    expect(container.querySelector('[data-commit-id="d1"]')).toBeNull();
    // 센 수와 그린 수가 같다(app 1 + design 2).
    expect(screen.getByRole("button", { name: "Mark 3 new commits as seen" })).toBeTruthy();
  });

  it("keeps a repository visible when only another worktree has new commits", () => {
    const DESIGN_WT = "/w/xames-design-agent";
    reviewRepos[2] = {
      repoPath: DESIGN,
      worktrees: [
        { path: DESIGN, branch: "main", headOid: "base", isMain: true },
        { path: DESIGN_WT, branch: "feat/x", headOid: "w3", isMain: false },
      ],
    };
    counted[DESIGN_WT] = { path: DESIGN_WT, headOid: "w3", newCount: 3, basis: "mergeBase", ids: ["w3", "w2", "w1"] };
    renderReview();
    expect(screen.getByText("Workspace · Local · showing 3 of 3 repositories")).toBeTruthy();
    const legend = screen.getByTestId("repo-legend");
    expect(within(legend).getByText("xames-design")).toBeTruthy();
    expect(within(legend).getByLabelText("3 new commits in other worktrees. Open the repository to review them.")).toBeTruthy();
    // 이 화면의 레인에 그리지 않는 커밋은 「확인함으로 표시」 수에 넣지 않는다.
    expect(screen.getByRole("button", { name: "Mark 1 new commit as seen" })).toBeTruthy();
  });

  it("says the repositories are hidden, not that there are no commits, when every one is quiet", () => {
    histories = {
      [APP]: history(APP, "main", []),
      [API]: history(API, "main", []),
      [DESIGN]: history(DESIGN, "main", []),
    };
    counted = {};
    reviewRepos[0] = { repoPath: APP, worktrees: [{ path: APP, branch: "main", headOid: "base", isMain: true }] };
    reviewRepos[1] = { repoPath: API, worktrees: [{ path: API, branch: "main", headOid: "base", isMain: true }] };
    renderReview();
    expect(screen.getByText("Workspace · Local · showing 0 of 3 repositories")).toBeTruthy();
    expect(screen.getByText(/All 3 repositories are quiet and hidden/)).toBeTruthy();
    expect(screen.queryByText(/No commits since/)).toBeNull();
  });

  it("redraws ref labels when a refetch brings new refs for the same commits", () => {
    const { container, rerender } = renderReview();
    const row = () => container.querySelector('[data-commit-id="api1"]') as HTMLElement;
    expect(within(row()).queryByText("origin/feat/noti")).toBeNull();
    histories[API] = history(API, "feat/noti", [
      { ...commit("api1", 200), refs: [{ name: "origin/feat/noti", kind: "remoteBranch", isHead: false }] },
    ]);
    rerender(
      <QueryClientProvider client={client}>
        <WorkspaceReview workspaceId="w1" paths={[APP, API, DESIGN]} />
      </QueryClientProvider>,
    );
    expect(within(row()).getByText("origin/feat/noti")).toBeTruthy();
  });

  it("puts the title in the toolbar's title slot when there is one", () => {
    const slot = document.createElement("div");
    slot.setAttribute("data-toolbar-title-slot", "");
    document.body.appendChild(slot);
    try {
      renderReview();
      expect(within(slot).getByRole("heading", { name: "xames" })).toBeTruthy();
    } finally {
      cleanup();
      slot.remove();
    }
  });
});
