// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import type { RepoInfo, StatusEntry } from "@/types";

const REPO = "/work/app";
const WT = "/work/app-wt";

const state = {
  status: [] as StatusEntry[] | undefined,
  merge: null as unknown,
  branches: [{ name: "feat/x", isHead: true, isRemote: false }] as
    | { name: string; isHead: boolean; isRemote: boolean }[]
    | undefined,
};

vi.mock("@/api/queries", () => ({
  useStatus: () => ({ data: state.status }),
  useMergeState: () => ({ data: state.merge }),
  useMergeRecoveryMutations: () => ({ abort: vi.fn(), conclude: vi.fn() }),
  useBranches: () => ({ data: state.branches }),
  useCommitHistoryInfinite: () => ({ data: { pages: [[{ id: "abcdef1234567" }]] } }),
}));

const { ChangesView } = await import("../ChangesView");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;

function renderView() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChangesView />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  state.status = [];
  state.merge = null;
  state.branches = [{ name: "feat/x", isHead: true, isRemote: false }];
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  useUIStore.setState({ commitFocusAt: null });
});

afterEach(cleanup);

describe("ChangesView composer", () => {
  it("collapses to a short 'No changes' state when nothing is uncommitted", () => {
    renderView();
    expect(screen.getByTestId("changes-empty").textContent).toContain("No changes");
    expect(screen.queryByPlaceholderText("Summary (required)")).toBeNull();
    expect(screen.queryByTestId("commit-target")).toBeNull();
  });

  it("brings the composer back once a file changes", () => {
    const { rerender } = renderView();
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ChangesView />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("changes-empty")).toBeNull();
    expect(screen.getByTestId("commit-target")).toBeTruthy();
  });

  it("keeps the composer during a merge even without files", () => {
    state.merge = { kind: "merge" };
    renderView();
    expect(screen.queryByTestId("changes-empty")).toBeNull();
  });

  it("says which branch and worktree the commit goes to", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    renderView();
    expect(screen.getByTestId("commit-target").textContent).toBe("Commit to feat/x · main working tree");
  });

  it("names a linked worktree and a detached HEAD", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    state.branches = [];
    useRepositoryStore.setState({ activeRepoPath: WT });
    renderView();
    expect(screen.getByTestId("commit-target").textContent).toBe("Commit to No branch (HEAD abcdef1) · app-wt");
  });

  it("does not claim 'no branch' before the branch list arrives", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    state.branches = undefined;
    renderView();
    expect(screen.getByTestId("commit-target").textContent).toBe("Commit to … · main working tree");
  });

  it("moves focus to the summary after 'Commit (N)'", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    renderView();
    act(() => useUIStore.getState().setCommitFocusAt(Date.now()));
    const summary = screen.getByTestId("commit-target").nextElementSibling;
    expect(document.activeElement).toBe(summary);
    expect(useUIStore.getState().commitFocusAt).toBeNull();
  });

  it("ignores a stale focus request", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    useUIStore.setState({ commitFocusAt: Date.now() - 60_000 });
    renderView();
    expect(document.activeElement).toBe(document.body);
  });
});
