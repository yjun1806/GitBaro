// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useHistoryViewStore } from "@/stores/history-view";
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
  useUIStore.setState({ workingFocusAt: null });
  useHistoryViewStore.getState().reset();
});

afterEach(cleanup);

describe("ChangesView composer", () => {
  it("hides staging and the composer while another branch is viewed, and goes back from the note", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    state.branches = [
      { name: "feat/x", isHead: true, isRemote: false },
      { name: "main", isHead: false, isRemote: false },
    ];
    useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "main", isRemote: false });
    renderView();
    expect(screen.queryByTestId("commit-target")).toBeNull();
    expect(screen.queryByPlaceholderText("Summary (required)")).toBeNull();
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByText(i18n.t("historyView.composerHidden"))).toBeTruthy();

    act(() => screen.getByRole("button", { name: "Back to current branch" }).click());
    expect(useHistoryViewStore.getState().target).toBeNull();
    expect(screen.getByTestId("commit-target")).toBeTruthy();
  });

  it("keeps the composer when the viewed branch is the checked-out one", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false });
    renderView();
    expect(screen.getByTestId("commit-target")).toBeTruthy();
  });

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
    expect(screen.getByTestId("commit-target").getAttribute("title")).toBe("Commit to feat/x · main working tree");
    expect(screen.getByTestId("commit-target").textContent).toBe("Commit to feat/x");
  });

  it("names a linked worktree and a detached HEAD", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    state.branches = [];
    useRepositoryStore.setState({ activeRepoPath: WT });
    renderView();
    expect(screen.getByTestId("commit-target").getAttribute("title")).toBe("Commit to No branch (HEAD abcdef1) · app-wt");
  });

  it("does not claim 'no branch' before the branch list arrives", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    state.branches = undefined;
    renderView();
    expect(screen.getByTestId("commit-target").getAttribute("title")).toBe("Commit to … · main working tree");
  });

  it("moves focus to the file list, not the summary, after 'Working changes N'", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    renderView();
    act(() => useUIStore.getState().setWorkingFocusAt(Date.now()));
    expect(document.activeElement).toBe(screen.getByTestId("changes-file-list"));
    expect(useUIStore.getState().workingFocusAt).toBeNull();
  });

  it("ignores a stale focus request", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    useUIStore.setState({ workingFocusAt: Date.now() - 60_000 });
    renderView();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the composer small at rest: one summary line, add description, and the commit button", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: true }];
    renderView();
    const composer = screen.getByTestId("commit-composer");
    expect(composer.querySelector("textarea")).toBeNull();
    expect(screen.queryByTestId("summary-counter")).toBeNull();
    const commit = screen.getByRole("button", { name: "Commit to feat/x" });
    // 요약이 없으면 커밋할 수 없다.
    expect(commit).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByPlaceholderText("Summary (required)"), { target: { value: "fix: thing" } });
    expect(screen.getByRole("button", { name: "Commit to feat/x" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Add description" }));
    expect(screen.getByPlaceholderText("Description")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add description" })).toBeNull();
  });

  it("shows the summary counter only near the limit", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: true }];
    renderView();
    const summary = screen.getByPlaceholderText("Summary (required)");
    fireEvent.change(summary, { target: { value: "x".repeat(59) } });
    expect(screen.queryByTestId("summary-counter")).toBeNull();
    fireEvent.change(summary, { target: { value: "x".repeat(60) } });
    expect(screen.getByTestId("summary-counter").textContent).toBe("60/72");
    fireEvent.change(summary, { target: { value: "x".repeat(73) } });
    expect(screen.getByTestId("summary-counter").className).toContain("text-warning");
  });

  it("does not offer a commit without staged files", () => {
    state.status = [{ path: "a.ts", status: "modified", staged: false }];
    renderView();
    fireEvent.change(screen.getByPlaceholderText("Summary (required)"), { target: { value: "fix: thing" } });
    expect(screen.getByRole("button", { name: "Commit to feat/x" })).toHaveProperty("disabled", true);
  });
});
