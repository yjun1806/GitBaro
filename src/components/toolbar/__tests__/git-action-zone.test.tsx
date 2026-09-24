// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import type { BranchInfo } from "@/types";

const data = vi.hoisted(() => ({
  branches: [] as unknown[],
  stashes: [] as unknown[],
  detached: false,
}));
const commands = vi.hoisted(() => ({
  gitFetch: vi.fn(() => Promise.resolve()),
  gitPull: vi.fn(() => Promise.resolve()),
  gitPush: vi.fn(() => Promise.resolve()),
  getPushTarget: vi.fn(() => Promise.resolve({ remote: "origin", refspec: "HEAD:refs/heads/feat/x" })),
  openInTerminal: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/api/commands", () => commands);
vi.mock("@/api/queries", () => ({
  useBranches: () => ({ data: data.branches }),
  useHeadDetached: () => ({ data: data.detached }),
  useTokenValidation: () => ({ data: { valid: true, canPush: true }, isLoading: false }),
  useStatus: () => ({ data: [] }),
  useStashList: () => ({ data: data.stashes }),
  useStashMutations: () => ({ push: {}, pushPartial: {} }),
  invalidateAfterSync: () => Promise.resolve(),
}));
vi.mock("@/components/toolbar/AutoSyncHint", () => ({ AutoSyncHint: () => null }));
// 기존 창은 그대로 쓴다. 여기서는 어느 창이 열리는지만 본다.
vi.mock("@/components/stash/StashSaveDialog", () => ({
  StashSaveDialog: () => <div>stash-save-dialog</div>,
}));
vi.mock("@/components/toolbar/MergeDialog", () => ({
  MergeDialog: ({ currentBranch }: { currentBranch: string }) => <div>merge-dialog:{currentBranch}</div>,
}));

import { useRepositoryStore } from "@/stores/repository";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";

const { GitActionZone } = await import("@/components/toolbar/GitActionZone");

const repo = makeRepo("xames", "mos", { accountId: "acc-1" });

function branch(overrides: Partial<BranchInfo>): BranchInfo {
  return {
    name: "feat/x",
    isHead: true,
    isRemote: false,
    upstream: "origin/feat/x",
    aheadBehind: { ahead: 19, behind: 0 },
    ...overrides,
  } as BranchInfo;
}

function renderZone(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  data.branches = [branch({})];
  data.stashes = [];
  data.detached = false;
  Object.values(commands).forEach((fn) => fn.mockClear());
  useRepositoryStore.setState({ repos: [repo], activeRepoPath: repo.path, activeRepo: repo });
});

afterEach(cleanup);

describe("GitActionZone — repository mode", () => {
  it("shows the ahead count on Push and the stash count on Stash", () => {
    data.stashes = [{}, {}];
    renderZone(<GitActionZone mode="repo" onOpenBranchPanel={() => {}} />);
    expect(screen.getByRole("button", { name: "Push — ↑19" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Stash — 2" })).toBeTruthy();
  });

  it("turns Push off when there is nothing to push", () => {
    data.branches = [branch({ aheadBehind: { ahead: 0, behind: 0 } })];
    renderZone(<GitActionZone mode="repo" onOpenBranchPanel={() => {}} />);
    expect(screen.getByRole("button", { name: "Push" })).toHaveProperty("disabled", true);
  });

  it("runs fetch and push on the open repository", async () => {
    renderZone(<GitActionZone mode="repo" onOpenBranchPanel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Fetch/ }));
    await waitFor(() => expect(commands.gitFetch).toHaveBeenCalledWith(repo.path, "acc-1"));
    fireEvent.click(screen.getByRole("button", { name: "Push — ↑19" }));
    await waitFor(() => expect(commands.gitPush).toHaveBeenCalledWith(repo.path, "acc-1", false));
  });

  it("keeps the force-push confirmation with the exact command", async () => {
    renderZone(<GitActionZone mode="repo" onOpenBranchPanel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Push options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Force push/ }));
    expect(await screen.findByText("git push --force-with-lease origin HEAD:refs/heads/feat/x")).toBeTruthy();
    expect(commands.gitPush).not.toHaveBeenCalled();
  });

  it("opens the branch panel, the merge dialog, the stash dialog and the terminal", async () => {
    const onOpenBranchPanel = vi.fn();
    renderZone(<GitActionZone mode="repo" onOpenBranchPanel={onOpenBranchPanel} />);

    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    expect(onOpenBranchPanel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(screen.getByText("merge-dialog:feat/x")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stash" }));
    expect(screen.getByText("stash-save-dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in Terminal" }));
    await waitFor(() => expect(commands.openInTerminal).toHaveBeenCalledWith(repo.path));
  });

  it("turns Merge, Pull and Push off on a detached HEAD", () => {
    data.detached = true;
    data.branches = [];
    renderZone(<GitActionZone mode="repo" onOpenBranchPanel={() => {}} />);
    expect(screen.getByRole("button", { name: /^Merge/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Pull" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Push" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /^Fetch/ })).toHaveProperty("disabled", false);
  });
});

describe("GitActionZone — workspace mode", () => {
  it("turns Fetch, Pull and Push off until onMultiRepo is wired", () => {
    renderZone(<GitActionZone mode="workspace" />);
    for (const label of ["Fetch", "Pull", "Push"]) {
      expect(screen.getByRole("button", { name: `${label} — Pick a repository` })).toHaveProperty("disabled", true);
    }
  });

  it("calls onMultiRepo with the operation instead of running git on one repository", () => {
    const onMultiRepo = vi.fn();
    renderZone(<GitActionZone mode="workspace" onMultiRepo={onMultiRepo} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(onMultiRepo.mock.calls).toEqual([["fetch"], ["pull"], ["push"]]);
    expect(commands.gitFetch).not.toHaveBeenCalled();
    expect(commands.gitPush).not.toHaveBeenCalled();
  });

  it("keeps branch, Merge, Stash and the terminal off", () => {
    renderZone(<GitActionZone mode="workspace" onMultiRepo={() => {}} />);
    for (const label of ["Branch", "Merge", "Stash", "Open in Terminal"]) {
      expect(screen.getByRole("button", { name: `${label} — Pick a repository` })).toHaveProperty("disabled", true);
    }
  });
});
