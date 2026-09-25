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
  branchesLoading: false,
  syncByPath: {} as Record<string, unknown>,
  unpushed: undefined as unknown,
}));
const commands = vi.hoisted(() => ({
  gitFetch: vi.fn(() => Promise.resolve()),
  gitPull: vi.fn(() => Promise.resolve()),
  gitPush: vi.fn(() => Promise.resolve()),
  getPushTarget: vi.fn(() => Promise.resolve({ remote: "origin", refspec: "HEAD:refs/heads/feat/x" })),
  // 여러 저장소 확인 창(W5-T2)이 여는 계획. 창이 열리는지만 보므로 빈 계획을 돌려준다.
  planRemoteOp: vi.fn(() => Promise.resolve([])),
  openInTerminal: vi.fn(() => Promise.resolve()),
  openRepoInEditor: vi.fn(() => Promise.resolve()),
  revealInFinder: vi.fn(() => Promise.resolve()),
  openInEditor: vi.fn(() => Promise.resolve()),
}));
const opener = vi.hoisted(() => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

vi.mock("@/api/commands", () => commands);
vi.mock("@/api/queries", () => ({
  useBranches: () => ({ data: data.branches, isLoading: data.branchesLoading }),
  useRepoSyncStatuses: () => ({ data: data.syncByPath }),
  useUnpushedCommits: () => ({ data: data.unpushed }),
  useHeadDetached: () => ({ data: data.detached }),
  useTokenValidation: () => ({ data: { valid: true, canPush: true }, isLoading: false }),
  useStatus: () => ({ data: [] }),
  useStashList: () => ({ data: data.stashes }),
  useStashMutations: () => ({ push: {}, pushPartial: {} }),
  invalidateAfterSync: () => Promise.resolve(),
}));
vi.mock("@/components/toolbar/AutoSyncHint", () => ({ AutoSyncHint: () => null }));

import { useRepositoryStore } from "@/stores/repository";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";

const { GitActionZone } = await import("@/components/toolbar/GitActionZone");
const { WorkspaceSyncGroup } = await import("@/components/toolbar/SyncZone");
const { ToolbarDropdownContext } = await import("@/components/toolbar/useToolbarDropdown");

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

const dropdown = { activeDropdown: null, toggle: vi.fn(), close: vi.fn() };

function renderZone(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToolbarDropdownContext.Provider value={dropdown}>{ui}</ToolbarDropdownContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  data.branches = [branch({})];
  data.stashes = [];
  data.detached = false;
  data.branchesLoading = false;
  data.unpushed = undefined;
  data.syncByPath = {};
  dropdown.toggle.mockClear();
  Object.values(commands).forEach((fn) => fn.mockClear());
  useRepositoryStore.setState({ repos: [repo], activeRepoPath: repo.path, activeRepo: repo });
});

afterEach(cleanup);

describe("GitActionZone — repository mode", () => {
  it("shows the ahead count on Push", () => {
    renderZone(<GitActionZone mode="repo" />);
    expect(screen.getByRole("button", { name: "Push — 19" })).toHaveProperty("disabled", false);
  });

  it("has no Merge or Stash button (the branch panel, stash tab and right-click menus have them)", () => {
    renderZone(<GitActionZone mode="repo" />);
    expect(screen.queryByRole("button", { name: /^Merge/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Stash/ })).toBeNull();
  });

  it("counts commits on no remote and says Publish before the branch has an upstream", () => {
    data.branches = [branch({ upstream: null, aheadBehind: null })];
    data.unpushed = { count: 3, hasUpstream: false, hasRemote: true, commits: [] };
    renderZone(<GitActionZone mode="repo" />);
    expect(screen.getByRole("button", { name: "Publish — 3" })).toHaveProperty("disabled", false);
  });

  it("turns Push off when there is nothing to push", () => {
    data.branches = [branch({ aheadBehind: { ahead: 0, behind: 0 } })];
    renderZone(<GitActionZone mode="repo" />);
    expect(screen.getByRole("button", { name: "Push" })).toHaveProperty("disabled", true);
  });

  it("runs fetch and push on the open repository", async () => {
    renderZone(<GitActionZone mode="repo" />);
    fireEvent.click(screen.getByRole("button", { name: /^Fetch —/ }));
    await waitFor(() => expect(commands.gitFetch).toHaveBeenCalledWith(repo.path, "acc-1"));
    fireEvent.click(screen.getByRole("button", { name: "Push — 19" }));
    await waitFor(() => expect(commands.gitPush).toHaveBeenCalledWith(repo.path, "acc-1", false));
  });

  it("keeps the force-push confirmation with the exact command", async () => {
    renderZone(<GitActionZone mode="repo" />);
    fireEvent.click(screen.getByRole("button", { name: "Push options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Force push/ }));
    expect(await screen.findByText("git push --force-with-lease origin HEAD:refs/heads/feat/x")).toBeTruthy();
    expect(commands.gitPush).not.toHaveBeenCalled();
  });

  it("opens the branch panel and the terminal", async () => {
    renderZone(<GitActionZone mode="repo" />);

    // W5-T3의 브랜치 패널이 들어오기 전까지는 툴바의 브랜치 목록을 연다.
    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    expect(dropdown.toggle).toHaveBeenCalledWith("branch");

    fireEvent.click(screen.getByRole("button", { name: "Open in Terminal" }));
    await waitFor(() => expect(commands.openInTerminal).toHaveBeenCalledWith(repo.path));
  });

  it("opens the repository in the editor, Finder and on GitHub from its own card", async () => {
    useRepositoryStore.setState({
      activeRepo: { ...repo, remotes: [{ name: "origin", url: "git@github.com:mos/xames.git" }] },
    });
    renderZone(<GitActionZone mode="repo" />);

    const group = screen.getByRole("group", { name: "Open repository" });
    const actions = Array.from(group.querySelectorAll("[data-action]")).map((el) => el.getAttribute("data-action"));
    expect(actions).toEqual(["editor", "terminal", "finder", "github"]);

    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    await waitFor(() => expect(commands.openRepoInEditor).toHaveBeenCalledWith(repo.path));
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    await waitFor(() => expect(commands.revealInFinder).toHaveBeenCalledWith(repo.path));
    fireEvent.click(screen.getByRole("button", { name: "View on GitHub" }));
    await waitFor(() => expect(opener.openUrl).toHaveBeenCalledWith("https://github.com/mos/xames"));
  });

  it("turns GitHub off when the repository has no GitHub remote", () => {
    useRepositoryStore.setState({ activeRepo: { ...repo, remotes: [] } });
    renderZone(<GitActionZone mode="repo" />);
    expect(screen.getByRole("button", { name: "View on GitHub" })).toHaveProperty("disabled", true);
  });

  it("turns Pull and Push off on a detached HEAD", () => {
    data.detached = true;
    data.branches = [];
    renderZone(<GitActionZone mode="repo" />);
    expect(screen.getByRole("button", { name: "Pull" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Push" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /^Fetch —/ })).toHaveProperty("disabled", false);
  });
});

describe("GitActionZone — menus and disabled reasons", () => {
  it("keeps force push reachable when nothing is ahead (after undoing a pushed commit)", async () => {
    data.branches = [branch({ aheadBehind: { ahead: 0, behind: 1 } })];
    renderZone(<GitActionZone mode="repo" />);
    expect(screen.getByRole("button", { name: "Push" })).toHaveProperty("disabled", true);
    const pushMenu = screen.getByRole("button", { name: "Push options" });
    expect(pushMenu).toHaveProperty("disabled", false);
    fireEvent.click(pushMenu);
    fireEvent.click(screen.getByRole("menuitem", { name: /Force push/ }));
    expect(await screen.findByText("git push --force-with-lease origin HEAD:refs/heads/feat/x")).toBeTruthy();
  });

  it("offers fetch from the Fetch menu with the last fetch time", async () => {
    renderZone(<GitActionZone mode="repo" />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Fetch now/ }));
    await waitFor(() => expect(commands.gitFetch).toHaveBeenCalledWith(repo.path, "acc-1"));
  });
});

describe("GitActionZone — workspace mode", () => {
  const paths = ["/repos/a", "/repos/b", "/repos/c"];

  it("turns Fetch, Pull and Push off when no multi-repository handler is given", () => {
    renderZone(<WorkspaceSyncGroup paths={paths} />);
    for (const label of ["Fetch", "Pull", "Push"]) {
      expect(screen.getByRole("button", { name: `${label} — Pick a repository` })).toHaveProperty("disabled", true);
    }
  });

  it("opens the per-repository confirmation instead of running git (W5-T2)", async () => {
    renderZone(<GitActionZone mode="workspace" paths={paths} />);
    const push = screen.getByRole("button", { name: "Push" });
    expect(push).toHaveProperty("disabled", false);
    fireEvent.click(push);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(commands.gitPush).not.toHaveBeenCalled();
  });

  it("calls onMultiRepo with the operation instead of running git on one repository", () => {
    const onMultiRepo = vi.fn();
    renderZone(<WorkspaceSyncGroup paths={paths} onMultiRepo={onMultiRepo} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(onMultiRepo.mock.calls).toEqual([["fetch"], ["pull"], ["push"]]);
    expect(commands.gitFetch).not.toHaveBeenCalled();
    expect(commands.gitPush).not.toHaveBeenCalled();
  });

  it("sums the workspace repositories' ahead and behind counts into the Push and Pull badges", () => {
    data.syncByPath = {
      "/repos/a": { path: "/repos/a", ahead: 12, unpushed: 12, behind: 0 },
      // 추적 브랜치가 없어도 원격에 없는 커밋은 센다.
      "/repos/b": { path: "/repos/b", ahead: 0, unpushed: 7, behind: 2 },
      // 워크스페이스 밖 저장소는 세지 않는다.
      "/repos/other": { path: "/repos/other", ahead: 100, unpushed: 100, behind: 100 },
    };
    renderZone(<WorkspaceSyncGroup paths={paths} onMultiRepo={() => {}} />);
    expect(screen.getByRole("button", { name: "Push — 19" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pull — ↓2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeTruthy();
  });

  it("keeps branch and the open-repository buttons off", () => {
    renderZone(<GitActionZone mode="workspace" paths={paths} />);
    for (const label of ["Branch", "Open in editor", "Open in Terminal", "Reveal in Finder", "View on GitHub"]) {
      expect(screen.getByRole("button", { name: `${label} — Pick a repository` })).toHaveProperty("disabled", true);
    }
  });
});
