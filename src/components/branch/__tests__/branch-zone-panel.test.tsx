// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useToastStore } from "@/stores/toast";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useHistoryViewStore } from "@/stores/history-view";
import type { BranchInfo, RepoInfo, WorktreeInfo } from "@/types";
import { useBranchRangeStore } from "../branch-range";

const REPO = "/work/app";
const FEAT = "/work/app-feat";

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    isHead: false,
    isRemote: false,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
    ...extra,
  };
}

const worktrees: WorktreeInfo[] = [
  { path: REPO, head: "a", branch: "main", isMain: true, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
  { path: FEAT, head: "b", branch: "feat/x", isMain: false, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
];

const openWorktree = vi.fn();
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => openWorktree }));
vi.mock("@/components/history/MergeActionPanel", () => ({
  MergeActionPanel: ({ compareBranch }: { compareBranch: string }) => <div>merge-panel:{compareBranch}</div>,
}));
vi.mock("@/api/queries", () => ({
  useBranches: () => ({ data: [branch("main", { isHead: true, isDefault: true }), branch("feat/x"), branch("docs/y")] }),
  useHeadDetached: () => ({ data: false }),
  useStatus: () => ({ data: [] }),
  useWorktrees: () => ({ data: worktrees }),
  useBranchBases: () => new Map(),
  useRecentBranches: () => ({ data: [] }),
  useBranchComparison: () => ({ data: { behindCount: 1 }, isLoading: false, error: null }),
}));

const { BranchZone } = await import("@/components/toolbar/BranchZone");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;
const onClose = vi.fn();

function renderZone() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BranchZone isOpen onToggle={() => {}} onClose={onClose} />
    </QueryClientProvider>,
  );
}

const row = (name: string) => within(document.querySelector<HTMLElement>(`[data-branch-name="${name}"]`)!);
/** 행 본문(이름·둘째 줄) 버튼. 누르면 체크아웃하지 않고 본다(branch-panel.test.tsx와 같은 규칙). */
const rowBody = (name: string) => document.querySelector<HTMLElement>(`[data-branch-name="${name}"] button`)!;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  onClose.mockReset();
  openWorktree.mockReset();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO, repoPrefs: {} });
  useUIStore.setState({ activeTab: "stash" });
  useBranchRangeStore.getState().clear();
  useHistoryViewStore.getState().reset();
});
afterEach(cleanup);

describe("BranchZone — branch panel wiring", () => {
  it("opens the D6 panel and moves to the worktree of a branch another worktree uses", () => {
    renderZone();
    expect(screen.getByRole("dialog", { name: "Branches" })).toBeTruthy();
    fireEvent.click(row("feat/x").getByRole("button", { name: "Go to" }));
    expect(openWorktree).toHaveBeenCalledWith(FEAT);
  });

  it("turns Compare into the graph range current..branch", () => {
    renderZone();
    fireEvent.click(row("docs/y").getByRole("button", { name: "Compare" }));
    expect(useBranchRangeStore.getState().range).toEqual({ repoPath: REPO, base: "main", target: "docs/y", head: "main" });
    expect(useUIStore.getState().activeTab).toBe("history");
    expect(onClose).toHaveBeenCalled();
  });

  it("reports a failed copy of the branch name instead of claiming success", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) } });
    useToastStore.setState({ toasts: [] });
    renderZone();
    fireEvent.contextMenu(document.querySelector<HTMLElement>('[data-branch-name="docs/y"]')!.querySelector("button")!);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy branch name" }));
    await vi.waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.type)).toEqual(["error"]));
  });

  it("opens the merge dialog for the row's branch", () => {
    renderZone();
    fireEvent.click(row("docs/y").getByRole("button", { name: "Merge…" }));
    expect(screen.getByText("merge-panel:docs/y")).toBeTruthy();
  });

  it("names the repository by its display name in the panel subtitle", () => {
    useRepositoryStore.setState({ repoPrefs: { [REPO]: { alias: "Shop front" } } });
    renderZone();
    expect(within(screen.getByRole("dialog", { name: "Branches" })).getByText("Shop front")).toBeTruthy();
  });

  it("turns the crumb into the viewed branch (step change, not checkout) and offers a quick way back", () => {
    renderZone();
    // Before picking anything, the crumb shows the checked-out branch (main).
    const crumbLabel = () => screen.getByTestId("branch-crumb").getAttribute("aria-label");
    expect(crumbLabel()).toBe("Branch main");
    expect(screen.queryByRole("button", { name: "Back to the repository" })).toBeNull();

    fireEvent.click(rowBody("docs/y"));
    expect(useHistoryViewStore.getState()).toMatchObject({ repoPath: REPO, target: { kind: "ref", name: "docs/y", isRemote: false } });
    expect(crumbLabel()).toBe("Viewing docs/y");
    expect(screen.getByTestId("branch-crumb").textContent).toContain("docs/y");

    fireEvent.click(screen.getByRole("button", { name: "Back to the repository" }));
    expect(useHistoryViewStore.getState().target).toBeNull();
    expect(crumbLabel()).toBe("Branch main");
    expect(screen.queryByRole("button", { name: "Back to the repository" })).toBeNull();
  });

  it("shows the crumb as viewing all branches when that's picked from the panel", () => {
    renderZone();
    fireEvent.click(screen.getByRole("button", { name: "All branches" }));
    expect(useHistoryViewStore.getState()).toMatchObject({ repoPath: REPO, target: { kind: "all" } });
    expect(screen.getByTestId("branch-crumb").getAttribute("aria-label")).toBe("Viewing All branches");
  });
});
