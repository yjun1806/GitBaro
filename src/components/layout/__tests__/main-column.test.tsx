// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import type { RepoInfo, StatusEntry } from "@/types";

// Heavy children talk to Tauri; the shell only decides which one to show.
vi.mock("@/components/toolbar", () => ({ ToolbarRoot: () => <div>toolbar</div> }));
vi.mock("@/components/history/HistoryView", () => ({
  HistoryView: () => (
    <button type="button" onClick={() => useSelectionStore.getState().selectCommit("c1")}>
      history-list
    </button>
  ),
}));
vi.mock("@/components/stash/StashView", () => ({ StashView: () => <div>stash-list</div> }));
vi.mock("@/components/actions/ActionsView", () => ({ ActionsView: () => <div>actions-list</div> }));
vi.mock("@/components/commit/ChangesView", () => ({ ChangesView: () => <div>changes-view</div> }));
vi.mock("@/components/repository/RepoListView", () => ({ RepoListView: () => <div>repo-list</div> }));
vi.mock("@/components/diff/DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));
vi.mock("@/components/stash/StashDetailView", () => ({ StashDetailView: () => <div>stash-detail</div> }));
vi.mock("@/components/actions/ActionsDetailView", () => ({ ActionsDetailView: () => <div>actions-detail</div> }));

const statusEntries: StatusEntry[] = [
  { path: "a.ts", status: "modified", staged: false },
  { path: "b.ts", status: "untracked", staged: false },
] as StatusEntry[];

vi.mock("@/api/queries", () => ({
  useStatus: (path: string | null) => ({ data: path ? statusEntries : [] }),
  useStashList: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: [] }),
  useFileDiff: () => ({ data: null, isLoading: false, isError: false }),
  useCommitDetail: () => ({ data: undefined, isLoading: true }),
  useCommitFileDiff: () => ({ data: null }),
  useCommitAvatars: () => ({ data: {} }),
}));

const { MainColumn } = await import("@/components/layout/MainColumn");

const repo: RepoInfo = {
  path: "/work/app",
  name: "app",
  currentBranch: "main",
  isDirty: true,
  remotes: [],
  accountId: null,
} as RepoInfo;

function renderShell() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MainColumn />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useUIStore.setState({ activeTab: "changes", repoListOpen: false });
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: repo.path });
});

afterEach(cleanup);

describe("MainColumn (two-column shell)", () => {
  it("shows an empty screen when no repository is selected", () => {
    useRepositoryStore.setState({ activeRepo: null, activeRepoPath: null });
    renderShell();
    expect(screen.getByText("No repository selected")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("changes-view")).toBeNull();
    // The toolbar stays so accounts and settings are still reachable.
    expect(screen.getByText("toolbar")).toBeTruthy();
  });

  it("shows the staging list under the panel when the uncommitted-changes row is picked", () => {
    useUIStore.setState({ activeTab: "history" });
    renderShell();
    expect(screen.queryByText("changes-view")).toBeNull();

    const row = screen.getByRole("button", { name: "Uncommitted changes (2)" });
    fireEvent.click(row);

    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("changes-view")).toBeTruthy();
  });

  it("switches to the commit detail when a commit is picked, and back to changes via the row", () => {
    renderShell();
    fireEvent.click(screen.getByText("history-list"));
    expect(useUIStore.getState().activeTab).toBe("history");
    expect(screen.queryByText("changes-view")).toBeNull();
    // Commit detail is loading (mocked query).
    expect(screen.getByText("Loading history")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Uncommitted changes (2)" }));
    expect(useSelectionStore.getState().selectedCommitId).toBeNull();
    expect(screen.getByText("changes-view")).toBeTruthy();

    // Picking the same commit again still opens its detail.
    fireEvent.click(screen.getByText("history-list"));
    expect(useUIStore.getState().activeTab).toBe("history");
  });

  it("has three panel tabs that switch the list and the area below", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Commit graph", "Stash", "Actions"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("history-list")).toBeTruthy();

    fireEvent.click(tabs[1]);
    expect(screen.getByText("stash-list")).toBeTruthy();
    expect(screen.queryByText("history-list")).toBeNull();
    expect(screen.getByText("No stash selected")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(screen.getByText("actions-list")).toBeTruthy();
    act(() => useSelectionStore.getState().selectRun(7));
    expect(screen.getByText("actions-detail")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("tab")[0]);
    expect(screen.getByText("history-list")).toBeTruthy();
    // No commit picked yet, so the graph tab opens on the uncommitted changes.
    expect(useUIStore.getState().activeTab).toBe("changes");
    expect(screen.getByText("changes-view")).toBeTruthy();
  });

  it("blocks the staging list and the diff while a branch switch runs", () => {
    renderShell();
    act(() => useUIStore.getState().setSwitchingBranch(true));
    try {
      const changesCard = screen.getByText("changes-view").closest("section");
      expect(changesCard?.querySelector(".animate-spin")).toBeTruthy();
      const diffCard = screen.getByText("No file selected").closest("section");
      expect(diffCard?.querySelector(".animate-spin")).toBeTruthy();
    } finally {
      act(() => useUIStore.getState().setSwitchingBranch(false));
    }
  });

  it("keeps the stash tab when the panel remounts with an old commit selection", () => {
    const { unmount } = renderShell();
    fireEvent.click(screen.getByText("history-list"));
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(useUIStore.getState().activeTab).toBe("stash");
    expect(useSelectionStore.getState().selectedCommitId).toBe("c1");
    unmount();

    // Opening and closing the repository list remounts the panel.
    renderShell();
    expect(useUIStore.getState().activeTab).toBe("stash");
    expect(screen.getByText("stash-list")).toBeTruthy();
  });

  it("names the stash tab 스태시 in Korean", async () => {
    await i18n.changeLanguage("ko");
    renderShell();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "커밋 그래프",
      "스태시",
      "Actions",
    ]);
  });

  it("replaces the panels with the repository list while it is open", () => {
    useUIStore.setState({ repoListOpen: true });
    renderShell();
    expect(screen.getByText("repo-list")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close repository list" }));
    expect(useUIStore.getState().repoListOpen).toBe(false);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});
