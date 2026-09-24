// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import type { BranchInfo, CommitInfo, RepoInfo, RepoSyncStatus, WorkflowRun } from "@/types";

vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));

// Every IPC call the detail could make. The view must read what other screens
// already cached, so most tests assert these are never called.
const ipc = vi.hoisted(() => ({
  listWorkflowRuns: vi.fn(),
  getCommitHistory: vi.fn(),
  getRepoSyncStatus: vi.fn(),
  getBranches: vi.fn(),
}));
vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/commands")>()),
  ...ipc,
}));

const { CommitDetail, summarizeCi, remoteLineOf, upstreamRemoteOf } = await import(
  "@/components/history/CommitDetail"
);

const SHA = "a81c0e2f00000000000000000000000000000000";
const ACCOUNT = "acc-1";

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    id: SHA,
    shortId: SHA.slice(0, 7),
    message: "feat(api): add settings",
    summary: "feat(api): add settings",
    author: { name: "Jun", email: "jun@example.com" },
    committer: { name: "Jun", email: "jun@example.com" },
    timestamp: 1_700_000_000,
    parentIds: ["7c2f8d1000000000000000000000000000000000"],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
    ...overrides,
  } as CommitInfo;
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1,
    name: "test.yml",
    status: "completed",
    conclusion: "success",
    headBranch: "main",
    headSha: SHA,
    htmlUrl: "https://example.com/run/1",
    createdAt: "2026-09-24T10:00:00Z",
    updatedAt: "2026-09-24T10:05:00Z",
    runNumber: 1,
    ...overrides,
  };
}

function makeBranch(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "main",
    isHead: true,
    isRemote: false,
    isDefault: true,
    upstream: "origin/main",
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
    ...overrides,
  };
}

const repo: RepoInfo = {
  path: "/work/xames-backend",
  name: "xames-backend",
  currentBranch: "main",
  isDirty: false,
  remotes: [{ name: "origin", url: "https://github.com/o/xames-backend.git" }],
  accountId: ACCOUNT,
} as RepoInfo;

const sync: RepoSyncStatus = {
  path: repo.path,
  branch: "main",
  ahead: 2,
  behind: 0,
  hasUpstream: true,
  unpushed: 2,
  isDirty: false,
  dirtyCount: 0,
  dirtyLatestMtime: null,
};

/** An hour old, so any observer mounted by the view would treat it as stale and refetch. */
const OLD = { updatedAt: Date.now() - 3_600_000 };

// jsdom has no layout; the file list's keyboard nav scrolls the first row into view.
Element.prototype.scrollIntoView = vi.fn();

let client: QueryClient;

function renderDetail(commit: CommitInfo = makeCommit()) {
  return render(
    <QueryClientProvider client={client}>
      <CommitDetail commit={commit} />
    </QueryClientProvider>,
  );
}

function cacheHistory(commits: CommitInfo[], path = repo.path) {
  client.setQueryData(["commitHistory", path], { pages: [commits], pageParams: [0] }, OLD);
}

function cacheRuns(runs: WorkflowRun[], accountId: string | null = ACCOUNT) {
  client.setQueryData(["workflowRuns", repo.path, accountId], runs, OLD);
}

function expectNoFetch() {
  expect(ipc.listWorkflowRuns).not.toHaveBeenCalled();
  expect(ipc.getCommitHistory).not.toHaveBeenCalled();
  expect(ipc.getRepoSyncStatus).not.toHaveBeenCalled();
  expect(ipc.getBranches).not.toHaveBeenCalled();
}

beforeEach(async () => {
  await i18n.changeLanguage("ko");
  vi.clearAllMocks();
  ipc.listWorkflowRuns.mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The sidebar's query holds every repository; the view must find its path in it.
  client.setQueryData(["repoSyncStatus", ["/work/other", repo.path]], [
    { ...sync, path: "/work/other", ahead: 9 },
    sync,
  ], OLD);
  client.setQueryData(["branches", repo.path], [makeBranch()], OLD);
  useRepositoryStore.setState({
    repos: [repo],
    activeRepo: repo,
    activeRepoPath: repo.path,
    activeWorktrees: {},
  });
  useAccountStore.setState({ activeAccountId: null });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("CommitDetail meta lines", () => {
  it("shows repository, commit and parent lines", () => {
    renderDetail();
    expect(screen.getByText("저장소")).toBeTruthy();
    expect(screen.getByText("xames-backend")).toBeTruthy();
    expect(screen.getByText("a81c0e2")).toBeTruthy();
    expect(screen.getByText("7c2f8d1")).toBeTruthy();
  });

  it("leaves out the co-author line when the commit has no trailer", () => {
    renderDetail();
    expect(screen.queryByText("공동 작성자")).toBeNull();
    expect(screen.queryByTestId("commit-co-authors")).toBeNull();
  });

  it("lists every co-author and marks the agent guess", () => {
    renderDetail(
      makeCommit({
        coAuthors: [
          { name: "Claude", email: "noreply@anthropic.com" },
          { name: "Mina", email: "mina@example.com" },
        ],
        isAgentAuthored: true,
      }),
    );
    expect(screen.getByText("공동 작성자")).toBeTruthy();
    expect(screen.getByTestId("commit-co-authors").textContent).toBe("Claude, Mina");
    expect(screen.getByTitle("mina@example.com")).toBeTruthy();
    expect(screen.getByText("에이전트 작성(추정)")).toBeTruthy();
  });

  it("shows the changed-file count in the header", () => {
    render(
      <QueryClientProvider client={client}>
        <CommitDetail
          commit={makeCommit()}
          changedFiles={[
            { path: "a.ts", status: "modified" },
            { path: "b.ts", status: "added" },
          ]}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("바뀐 파일 2")).toBeTruthy();
  });
});

describe("CommitDetail CI line", () => {
  it("does not claim the commit never ran when it is only missing from the recent runs", () => {
    cacheRuns([makeRun({ headSha: "ffffffff" }), makeRun({ id: 2, headSha: "eeeeeeee" })]);
    renderDetail();
    expect(screen.getByText("CI")).toBeTruthy();
    expect(screen.getByText("최근 실행 2건에 없음")).toBeTruthy();
    expect(screen.queryByText("이 커밋의 실행 기록 없음")).toBeNull();
  });

  it("says there is no run when the repository has none", () => {
    cacheRuns([]);
    renderDetail();
    expect(screen.getByText("이 커밋의 실행 기록 없음")).toBeTruthy();
  });

  it("shows the CI result matched by headSha without fetching again", () => {
    cacheRuns([makeRun()]);
    renderDetail();
    expect(screen.getByText("통과")).toBeTruthy();
    expect(screen.getByText(/test\.yml/)).toBeTruthy();
    expectNoFetch();
  });

  it("hides the CI line when the repository has no account, even if runs are cached", () => {
    const noAccount = { ...repo, accountId: null };
    useRepositoryStore.setState({ repos: [noAccount], activeRepo: noAccount });
    cacheRuns([makeRun()], null);
    renderDetail();
    expect(screen.queryByText("CI")).toBeNull();
    expect(ipc.listWorkflowRuns).not.toHaveBeenCalled();
  });

  it("re-fetches the run list while this commit's CI is running", async () => {
    cacheRuns([makeRun({ status: "in_progress", conclusion: null })]);
    ipc.listWorkflowRuns.mockResolvedValue([makeRun()]);
    renderDetail();
    expect(screen.getByText("실행 중")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("통과")).toBeTruthy());
    expect(ipc.listWorkflowRuns).toHaveBeenCalledTimes(1);
  });
});

describe("CommitDetail remote line", () => {
  it("shows the not-pushed line with the ahead count, read from the cache only", () => {
    cacheRuns([makeRun()]);
    cacheHistory([makeCommit({ isUnpushed: true })]);
    renderDetail();
    expect(screen.getByText("아직 push 안 함 (origin보다 ↑2)")).toBeTruthy();
    expectNoFetch();
  });

  it("names the remote the branch actually tracks", () => {
    const twoRemotes = {
      ...repo,
      remotes: [
        { name: "origin", url: "https://github.com/me/x.git" },
        { name: "upstream", url: "https://github.com/o/x.git" },
      ],
    } as RepoInfo;
    useRepositoryStore.setState({ repos: [twoRemotes], activeRepo: twoRemotes });
    client.setQueryData(["branches", repo.path], [makeBranch({ upstream: "upstream/main" })]);
    cacheHistory([makeCommit({ isUnpushed: true })]);
    renderDetail();
    expect(screen.getByText("아직 push 안 함 (upstream보다 ↑2)")).toBeTruthy();
  });

  it("says no remote branch is linked when the branch has no upstream", () => {
    client.setQueryData(["repoSyncStatus", [repo.path]], [{ ...sync, hasUpstream: false }]);
    cacheHistory([makeCommit({ isUnpushed: true })]);
    renderDetail();
    expect(screen.getByText("아직 push 안 함 (연결된 원격 브랜치 없음)")).toBeTruthy();
  });

  it("leaves the line out when the commit is not in the loaded history", () => {
    cacheHistory([makeCommit({ id: "other", isUnpushed: true })]);
    renderDetail();
    expect(screen.queryByText("원격")).toBeNull();
  });

  it("does not read another repository's history", () => {
    cacheHistory([makeCommit({ isUnpushed: true })], "/work/other");
    renderDetail();
    expect(screen.queryByText("원격")).toBeNull();
  });
});

describe("summarizeCi", () => {
  it("returns null when no run is for this commit", () => {
    expect(summarizeCi([], SHA)).toBeNull();
    expect(summarizeCi([makeRun({ headSha: "other" })], SHA)).toBeNull();
  });

  it("uses only the newest run of each workflow", () => {
    const runs = [
      makeRun({ id: 1, conclusion: "failure", createdAt: "2026-09-24T09:00:00Z" }),
      makeRun({ id: 2, conclusion: "success", createdAt: "2026-09-24T10:00:00Z" }),
    ];
    expect(summarizeCi(runs, SHA)).toEqual({ state: "passed", names: ["test.yml"] });
  });

  it("reports running before failed, and failed before passed", () => {
    const failed = makeRun({ name: "lint", conclusion: "failure" });
    const running = makeRun({ name: "build", status: "in_progress", conclusion: null });
    expect(summarizeCi([makeRun(), failed], SHA)?.state).toBe("failed");
    expect(summarizeCi([makeRun(), failed, running], SHA)?.state).toBe("running");
  });
});

describe("remoteLineOf", () => {
  it("is null without remotes or when the commit is not in the loaded history", () => {
    expect(remoteLineOf(true, sync, [])).toBeNull();
    expect(remoteLineOf(undefined, sync, ["origin"])).toBeNull();
  });

  it("covers pushed, not pushed and no upstream", () => {
    expect(remoteLineOf(false, sync, ["origin"], "origin/main")).toEqual({
      kind: "pushed",
      remote: "origin",
    });
    expect(remoteLineOf(true, sync, ["upstream", "origin"], "upstream/feat")).toEqual({
      kind: "unpushed",
      remote: "upstream",
      ahead: 2,
    });
    expect(remoteLineOf(true, { ...sync, hasUpstream: false }, ["origin"])).toEqual({
      kind: "noUpstream",
    });
  });
});

describe("upstreamRemoteOf", () => {
  it("takes the longest remote name that prefixes the upstream ref", () => {
    expect(upstreamRemoteOf("my/fork/feat", ["my", "my/fork"])).toBe("my/fork");
  });

  it("names a remote without an upstream only when there is just one", () => {
    expect(upstreamRemoteOf(null, ["origin"])).toBe("origin");
    expect(upstreamRemoteOf(null, ["origin", "upstream"])).toBeNull();
    expect(upstreamRemoteOf(undefined, ["origin", "upstream"])).toBeNull();
  });
});
