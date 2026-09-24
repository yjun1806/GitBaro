// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
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

beforeEach(async () => {
  await i18n.changeLanguage("en");
  onClose.mockReset();
  openWorktree.mockReset();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  useUIStore.setState({ activeTab: "stash", compareBranch: "old" });
  useBranchRangeStore.getState().clear();
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
    expect(useBranchRangeStore.getState().range).toEqual({ repoPath: REPO, base: "main", target: "docs/y" });
    // 그래프 탭으로 가고, 예전 비교 화면은 끈다.
    expect(useUIStore.getState().activeTab).toBe("history");
    expect(useUIStore.getState().compareBranch).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it("opens the merge dialog for the row's branch", () => {
    renderZone();
    fireEvent.click(row("docs/y").getByRole("button", { name: "Merge…" }));
    expect(screen.getByText("merge-panel:docs/y")).toBeTruthy();
  });
});
