// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import type { RepoInfo, WorktreeInfo } from "@/types";

const REPO = "/work/app";
const FEAT = "/work/app-feat";
// 폭 우선순위(셋째 항목: 폴더 이름)를 시험하려고 일부러 길게 지었다.
const LONG = "/work/a-worktree-folder-name-long-enough-to-need-shortening";

const worktrees: WorktreeInfo[] = [
  { path: REPO, head: "a", branch: "main", isMain: true, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
  { path: FEAT, head: "b", branch: "feat/x", isMain: false, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
  { path: LONG, head: "c", branch: "feat/y", isMain: false, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
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

  it("shortens a long folder name in the middle and keeps the full name as the title", () => {
    useRepositoryStore.setState({
      repos: [repo],
      activeRepo: repo,
      activeRepoPath: LONG,
      repoPrefs: {},
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorktreeZone isOpen={false} onToggle={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const folderName = LONG.split("/").pop()!;
    const shortened = middleEllipsis(folderName, 16);
    expect(shortened).not.toBe(folderName);
    const trigger = screen.getByTitle(folderName);
    expect(trigger).toHaveTextContent(shortened);
    expect(trigger).not.toHaveTextContent(folderName);
  });

  it("always gives the icon-only return-to-main button an aria-label and title", () => {
    useRepositoryStore.setState({
      repos: [repo],
      activeRepo: repo,
      activeRepoPath: FEAT,
      repoPrefs: {},
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorktreeZone isOpen={false} onToggle={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const returnButton = screen.getByRole("button", { name: "Return to primary folder" });
    expect(returnButton).toHaveAttribute("title", expect.stringContaining("Return to primary folder"));
  });
});
