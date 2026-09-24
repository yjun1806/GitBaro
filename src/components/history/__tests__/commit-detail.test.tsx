// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import type { CommitInfo, RepoInfo, RepoSyncStatus, WorkflowRun } from "@/types";

vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));

const mockState: {
  history: CommitInfo[];
  sync: RepoSyncStatus | undefined;
  runs: WorkflowRun[] | undefined;
} = { history: [], sync: undefined, runs: [] };

vi.mock("@/api/queries", () => ({
  useCommitHistoryInfinite: () => ({ data: { pages: [mockState.history] } }),
  useRepoSyncStatuses: (paths: string[]) => ({
    data: mockState.sync ? { [paths[0]]: mockState.sync } : {},
  }),
  useWorkflowRuns: (repoPath: string | null, accountId: string | null) =>
    repoPath && accountId && mockState.runs
      ? { data: mockState.runs, isSuccess: true }
      : { data: undefined, isSuccess: false },
}));

const { CommitDetail, summarizeCi, remoteLineOf } = await import(
  "@/components/history/CommitDetail"
);

const SHA = "a81c0e2f00000000000000000000000000000000";

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

const repo: RepoInfo = {
  path: "/work/xames-backend",
  name: "xames-backend",
  currentBranch: "main",
  isDirty: false,
  remotes: [{ name: "origin", url: "https://github.com/o/xames-backend.git" }],
  accountId: "acc-1",
} as RepoInfo;

const sync: RepoSyncStatus = {
  path: repo.path,
  branch: "main",
  ahead: 2,
  behind: 0,
  hasUpstream: true,
  isDirty: false,
  dirtyCount: 0,
  dirtyLatestMtime: null,
};

beforeEach(async () => {
  await i18n.changeLanguage("ko");
  mockState.history = [];
  mockState.sync = undefined;
  mockState.runs = [];
  useRepositoryStore.setState({
    repos: [repo],
    activeRepo: repo,
    activeRepoPath: repo.path,
    activeWorktrees: {},
  });
  useAccountStore.setState({ activeAccountId: null });
});

afterEach(cleanup);

describe("CommitDetail meta lines", () => {
  it("shows repository, commit and parent lines", () => {
    render(<CommitDetail commit={makeCommit()} />);
    expect(screen.getByText("저장소")).toBeTruthy();
    expect(screen.getByText("xames-backend")).toBeTruthy();
    expect(screen.getByText("a81c0e2")).toBeTruthy();
    expect(screen.getByText("7c2f8d1")).toBeTruthy();
  });

  it("leaves out the co-author line when the commit has no trailer", () => {
    render(<CommitDetail commit={makeCommit()} />);
    expect(screen.queryByText("공동 작성자")).toBeNull();
    expect(screen.queryByTestId("commit-co-authors")).toBeNull();
  });

  it("lists every co-author and marks the agent guess", () => {
    render(
      <CommitDetail
        commit={makeCommit({
          coAuthors: [
            { name: "Claude", email: "noreply@anthropic.com" },
            { name: "Mina", email: "mina@example.com" },
          ],
          isAgentAuthored: true,
        })}
      />,
    );
    expect(screen.getByText("공동 작성자")).toBeTruthy();
    expect(screen.getByTestId("commit-co-authors").textContent).toBe("Claude, Mina");
    expect(screen.getByTitle("mina@example.com")).toBeTruthy();
    expect(screen.getByText("에이전트 작성(추정)")).toBeTruthy();
  });

  it("says there is no CI run when no run matches the commit", () => {
    mockState.runs = [makeRun({ headSha: "ffffffff" })];
    render(<CommitDetail commit={makeCommit()} />);
    expect(screen.getByText("CI")).toBeTruthy();
    expect(screen.getByText("이 커밋의 실행 기록 없음")).toBeTruthy();
  });

  it("shows the CI result matched by headSha", () => {
    mockState.runs = [makeRun()];
    render(<CommitDetail commit={makeCommit()} />);
    expect(screen.getByText("통과")).toBeTruthy();
    expect(screen.getByText(/test\.yml/)).toBeTruthy();
  });

  it("hides the CI line when the repository has no account", () => {
    useRepositoryStore.setState({ repos: [{ ...repo, accountId: null }], activeRepo: { ...repo, accountId: null } });
    render(<CommitDetail commit={makeCommit()} />);
    expect(screen.queryByText("CI")).toBeNull();
  });

  it("shows the not-pushed line with the ahead count", () => {
    mockState.history = [makeCommit({ isUnpushed: true })];
    mockState.sync = sync;
    render(<CommitDetail commit={makeCommit()} />);
    expect(screen.getByText("아직 push 안 함 (origin보다 ↑2)")).toBeTruthy();
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
    expect(remoteLineOf(false, sync, ["origin"])).toEqual({ kind: "pushed", remote: "origin" });
    expect(remoteLineOf(true, sync, ["upstream", "origin"])).toEqual({
      kind: "unpushed",
      remote: "origin",
      ahead: 2,
    });
    expect(remoteLineOf(true, { ...sync, hasUpstream: false }, ["origin"])).toEqual({
      kind: "noUpstream",
    });
  });
});
