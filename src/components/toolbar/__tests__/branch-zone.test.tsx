// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import type { BranchInfo, RepoInfo, WorktreeInfo } from "@/types";

const REPO = "/work/app";
const FEAT = "/work/app-feat";
// 폭 우선순위(넷째 항목: 브랜치 이름)를 시험하려고 일부러 길게 지었다.
const LONG_BRANCH = "feature/a-branch-name-long-enough-to-need-shortening";

const data = vi.hoisted(() => ({
  branches: [] as unknown[],
  worktrees: [] as unknown[],
  detached: false,
}));
const commands = vi.hoisted(() => ({
  switchBranch: vi.fn(() => Promise.resolve()),
  createBranch: vi.fn(() => Promise.resolve()),
  deleteBranch: vi.fn(() => Promise.resolve()),
  renameBranch: vi.fn(() => Promise.resolve()),
  stashPush: vi.fn(() => Promise.resolve(null)),
  stashPopByOid: vi.fn(() => Promise.resolve()),
  openInEditor: vi.fn(() => Promise.resolve()),
  openInTerminal: vi.fn(() => Promise.resolve()),
  openRepoInEditor: vi.fn(() => Promise.resolve()),
  revealInFinder: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@/api/commands", () => commands);
vi.mock("@/api/queries", () => ({
  useBranches: () => ({ data: data.branches }),
  useHeadDetached: () => ({ data: data.detached }),
  useStatus: () => ({ data: [] }),
  useWorktrees: () => ({ data: data.worktrees }),
}));
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => vi.fn() }));

const { BranchZone } = await import("../BranchZone");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;

function branch(name: string, overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    isHead: true,
    isRemote: false,
    upstream: null,
    aheadBehind: { ahead: 0, behind: 0 },
    ...overrides,
  } as BranchInfo;
}

function renderZone() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BranchZone isOpen={false} onToggle={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  data.branches = [branch(LONG_BRANCH)];
  data.worktrees = [];
  data.detached = false;
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO, repoPrefs: {} });
});
afterEach(cleanup);

describe("BranchZone", () => {
  it("shortens a long branch name in the middle, but keeps the full name in the accessible name", () => {
    renderZone();
    const shortened = middleEllipsis(LONG_BRANCH, 28);
    expect(shortened).not.toBe(LONG_BRANCH);
    const trigger = screen.getByRole("button", { name: `Branch ${LONG_BRANCH}` });
    expect(trigger).toHaveTextContent(shortened);
    expect(trigger).not.toHaveTextContent(LONG_BRANCH);
  });

  it("hides the base label behind a container-query breakpoint, ready to show once there's room", () => {
    const worktrees: WorktreeInfo[] = [
      { path: REPO, head: "a", branch: "main", isMain: true, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
      {
        path: FEAT,
        head: "b",
        branch: "feat/x",
        isMain: false,
        isBare: false,
        isLocked: false,
        lockReason: null,
        isDirty: false,
        isPrunable: false,
        base: { name: "develop", source: "inferred", aheadOfBase: 2, behindBase: 0 },
      },
    ];
    data.branches = [branch("feat/x")];
    data.worktrees = worktrees;
    useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: FEAT, repoPrefs: {} });
    renderZone();

    const chip = screen.getByTestId("worktree-base-chip");
    // 좁을 땐 감춰지고(hidden), 카드 폭이 1360px 이상일 때만 보인다 — jsdom은 컨테이너 쿼리를
    // 계산하지 않으므로 클래스 자체로 그 규칙이 걸려 있는지 확인한다.
    expect(chip.className).toContain("hidden");
    expect(chip.className).toContain("@min-[1360px]:inline-flex");
    expect(chip).toHaveTextContent("based on develop");
  });

  it("moves the base label's meaning into the branch button's tooltip, so it survives even when the label is hidden", async () => {
    const worktrees: WorktreeInfo[] = [
      { path: REPO, head: "a", branch: "main", isMain: true, isBare: false, isLocked: false, lockReason: null, isDirty: false, isPrunable: false, base: null },
      {
        path: FEAT,
        head: "b",
        branch: "feat/x",
        isMain: false,
        isBare: false,
        isLocked: false,
        lockReason: null,
        isDirty: false,
        isPrunable: false,
        base: { name: "develop", source: "inferred", aheadOfBase: 2, behindBase: 0 },
      },
    ];
    data.branches = [branch("feat/x")];
    data.worktrees = worktrees;
    useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: FEAT, repoPrefs: {} });

    vi.useFakeTimers();
    try {
      renderZone();
      const trigger = screen.getByRole("button", { name: "Branch feat/x" });
      fireEvent.mouseEnter(trigger.parentElement!);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toHaveTextContent("based on develop");
      expect(tooltip).toHaveTextContent("estimated");
    } finally {
      vi.useRealTimers();
    }
  });
});
