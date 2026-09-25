// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import type { RepoInfo, WorktreeInfo } from "@/types";

const REPO = "/work/app";
const FEAT = "/work/app-feat";

const worktrees: WorktreeInfo[] = [
  { path: REPO, head: "a", branch: "main", isMain: true, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
  { path: FEAT, head: "b", branch: "feat/x", isMain: false, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
];

vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => vi.fn() }));
vi.mock("@/api/queries", () => ({
  useBranches: () => ({ data: [] }),
  useWorktrees: () => ({ data: worktrees }),
}));
vi.mock("@/components/worktree/WorktreePanel", () => ({
  WorktreePanel: ({ repoName }: { repoName: string }) => (
    <div role="dialog" aria-label="worktrees">
      {repoName}
    </div>
  ),
}));

const { WorktreeZone } = await import("../WorktreeZone");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("WorktreeZone", () => {
  it("names the owner repository by its display name, also from inside a linked worktree", () => {
    useRepositoryStore.setState({
      repos: [repo],
      activeRepo: repo,
      activeRepoPath: FEAT,
      repoPrefs: { [REPO]: { alias: "Shop front" } },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorktreeZone isOpen onToggle={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(within(screen.getByRole("dialog", { name: "worktrees" })).getByText("Shop front")).toBeTruthy();
  });
});
