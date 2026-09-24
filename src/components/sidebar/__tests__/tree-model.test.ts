import { describe, expect, it } from "vitest";
import { buildRepoTree, type Workspace } from "@/lib/repo-tree";
import type { RepoInfo, RepoSyncStatus } from "@/types";
import type { WorktreeReviewStatus } from "@/hooks/useReviewStatus";
import {
  ancestorsToReveal,
  buildSignals,
  collapsibleKeys,
  expandedWorktreePaths,
  filterTree,
  isWatchedPath,
  liveAvatarStack,
  liveEntries,
  repoTotals,
  workspaceTotals,
  worktreesByRepoFrom,
} from "../tree-model";

const NOW = 1_000_000_000;

function repo(path: string, owner = "acme"): RepoInfo {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    currentBranch: "main",
    isDirty: false,
    remotes: [{ name: "origin", url: `https://github.com/${owner}/${name}.git` }],
    accountId: null,
  };
}

function sync(path: string, over: Partial<RepoSyncStatus> = {}): RepoSyncStatus {
  return {
    path,
    branch: "main",
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    isDirty: false,
    dirtyCount: 0,
    dirtyLatestMtime: null,
    ...over,
  };
}

function review(path: string, newCount: number | null): WorktreeReviewStatus {
  return { path, branch: "main", headOid: "abc", isMain: true, repoPath: path, newCount, basis: null };
}

const API = "/r/api";
const WEB = "/r/web";
const TOOL = "/r/tool";
const WT = "/r/api/.worktrees/feat";
const repos = [repo(API), repo(WEB), repo(TOOL)];
const ws: Workspace = { id: "w1", name: "product", accountKey: "acme", repoPaths: [API, WEB] };

function tree(signals = {}) {
  return buildRepoTree({
    repos,
    accounts: [],
    workspaces: [ws],
    orderByParent: {},
    sortModeByAccount: {},
    signals,
    worktreesByRepo: { [API]: [{ path: WT, branch: "feat/login" }] },
    now: NOW,
  });
}

describe("buildSignals", () => {
  it("merges sync status, new commit counts and change times per path", () => {
    const signals = buildSignals(
      { [API]: sync(API, { dirtyCount: 2, ahead: 1 }) },
      { [WT]: review(WT, 3) },
      { [WEB]: NOW - 1000 },
    );
    expect(signals[API]).toEqual({ dirtyCount: 2, newCommits: 0, ahead: 1, behind: 0, lastChangedAt: null });
    expect(signals[WT]).toMatchObject({ dirtyCount: 0, newCommits: 3 });
    expect(signals[WEB]).toMatchObject({ lastChangedAt: NOW - 1000 });
  });

  it("treats a count that is not known yet as zero", () => {
    expect(buildSignals({}, { [API]: review(API, null) }, {})[API].newCommits).toBe(0);
  });
});

describe("worktreesByRepoFrom", () => {
  it("keeps only linked worktrees", () => {
    const result = worktreesByRepoFrom([
      {
        repoPath: API,
        worktrees: [
          { path: API, branch: "main", headOid: "a", isMain: true },
          { path: WT, branch: "feat/login", headOid: "b", isMain: false },
        ],
      },
    ]);
    expect(result).toEqual({ [API]: [{ path: WT, branch: "feat/login" }] });
  });
});

describe("totals", () => {
  it("adds worktree values to the repository and repositories to the workspace", () => {
    const signals = {
      [API]: { dirtyCount: 1, newCommits: 2 },
      [WT]: { dirtyCount: 4, newCommits: 1 },
      [WEB]: { dirtyCount: 3 },
    };
    const [account] = tree(signals);
    const wsNode = account.children.find((c) => c.kind === "workspace");
    if (wsNode?.kind !== "workspace") throw new Error("workspace missing");
    const apiNode = wsNode.repos.find((r) => r.repo.path === API)!;
    expect(repoTotals(apiNode, signals)).toEqual({ dirty: 5, newCommits: 3 });
    expect(workspaceTotals(wsNode, signals)).toEqual({ dirty: 8, newCommits: 3 });
  });
});

describe("filterTree", () => {
  const branchOf = (p: string) => (p === WEB ? "fix/nav" : p === WT ? "feat/login" : "main");

  it("returns the same tree for an empty query", () => {
    const t = tree();
    expect(filterTree(t, "  ", branchOf)).toBe(t);
  });

  it("matches repository names, current branches and worktree branches", () => {
    const byName = filterTree(tree(), "TOOL", branchOf);
    expect(byName[0].children.map((c) => c.key)).toEqual([`repo:${TOOL}`]);

    const byBranch = filterTree(tree(), "fix/", branchOf);
    const wsNode = byBranch[0].children[0];
    expect(wsNode.kind === "workspace" && wsNode.repos.map((r) => r.repo.path)).toEqual([WEB]);

    const byWorktree = filterTree(tree(), "login", branchOf);
    const wsNode2 = byWorktree[0].children[0];
    expect(wsNode2.kind === "workspace" && wsNode2.repos.map((r) => r.repo.path)).toEqual([API]);
  });

  it("keeps a whole workspace when its name matches and drops accounts with no match", () => {
    const t = filterTree(tree(), "product", branchOf);
    const wsNode = t[0].children[0];
    expect(wsNode.kind === "workspace" && wsNode.repos).toHaveLength(2);
    expect(filterTree(tree(), "zzz", branchOf)).toEqual([]);
  });

  it("lifts matching quiet repositories out of the folded row", () => {
    const quiet = tree({ [TOOL]: { dirtyCount: 0 } });
    expect(quiet[0].quietRepos.map((r) => r.repo.path)).toEqual([TOOL]);
    const t = filterTree(quiet, "tool", branchOf);
    expect(t[0].children.map((c) => c.key)).toEqual([`repo:${TOOL}`]);
    expect(t[0].quietRepos).toEqual([]);
  });
});

describe("collapsibleKeys", () => {
  it("lists accounts, workspaces and repositories with worktrees", () => {
    expect(collapsibleKeys(tree()).sort()).toEqual(["acct:acme", `repo:${API}`, "ws:w1"]);
  });
});

describe("expandedWorktreePaths", () => {
  const openExcept = (closed: string[]) => (key: string) => !closed.includes(key);

  it("returns worktrees of expanded repositories only", () => {
    expect(expandedWorktreePaths(tree(), openExcept([]))).toEqual([WT]);
    expect(expandedWorktreePaths(tree(), openExcept([`repo:${API}`]))).toEqual([]);
  });

  it("ignores repositories hidden under a folded workspace or account", () => {
    expect(expandedWorktreePaths(tree(), openExcept(["ws:w1"]))).toEqual([]);
    expect(expandedWorktreePaths(tree(), openExcept(["acct:acme"]))).toEqual([]);
  });

  it("counts a quiet repository only while its account's quiet row is open", () => {
    const quietTree = buildRepoTree({
      repos,
      accounts: [],
      workspaces: [],
      orderByParent: {},
      sortModeByAccount: {},
      signals: { [API]: { dirtyCount: 0 }, [WT]: { dirtyCount: 0 } },
      worktreesByRepo: { [API]: [{ path: WT, branch: "feat/login" }] },
      now: NOW,
    });
    expect(quietTree[0].quietRepos.map((r) => r.repo.path)).toContain(API);
    expect(expandedWorktreePaths(quietTree, openExcept([]))).toEqual([]);
    expect(expandedWorktreePaths(quietTree, openExcept([]), ["acme"])).toEqual([WT]);
  });

  it("follows the caller's open check, so a search that forces rows open counts them", () => {
    const branchOf = (p: string) => (p === WT ? "feat/login" : "main");
    const searched = filterTree(tree(), "login", branchOf);
    const saved = ["ws:w1", `repo:${API}`];
    expect(expandedWorktreePaths(searched, openExcept(saved))).toEqual([]);
    expect(expandedWorktreePaths(searched, () => true)).toEqual([WT]);
  });
});

describe("isWatchedPath", () => {
  it("is true only for paths the backend reports as watched", () => {
    expect(isWatchedPath(WT, [API, WT], [WEB])).toBe(true);
    expect(isWatchedPath(WEB, [API, WT], [WEB])).toBe(false);
    // 감시 목록에서 빠진 경로(접은 저장소의 워크트리 등)는 폴링도 되지 않으므로 흐리게 그린다.
    expect(isWatchedPath("/r/api/.worktrees/old", [API], [])).toBe(false);
  });

  it("assumes watched before the backend has answered once", () => {
    expect(isWatchedPath(WT, [], [])).toBe(true);
  });
});

describe("liveEntries", () => {
  const branchOf = (p: string) => (p === WT ? "feat/login" : "main");
  const worktrees = { [API]: [{ path: WT, branch: "feat/login" }] };

  it("lists paths changed in the last 10 minutes, newest first, resolved to repo or worktree", () => {
    const entries = liveEntries(
      { [WEB]: NOW - 60_000, [WT]: NOW - 5_000, [TOOL]: NOW - 11 * 60_000 },
      NOW,
      repos,
      worktrees,
      branchOf,
    );
    expect(entries.map((e) => [e.path, e.repo.path, e.isWorktree, e.branch])).toEqual([
      [WT, API, true, "feat/login"],
      [WEB, WEB, false, "main"],
    ]);
  });

  it("drops paths that belong to no registered repository", () => {
    expect(liveEntries({ "/gone": NOW }, NOW, repos, worktrees, branchOf)).toEqual([]);
  });
});

describe("ancestorsToReveal", () => {
  it("finds a repository inside a workspace and lists the workspace and account keys to open", () => {
    const target = ancestorsToReveal(tree(), API);
    expect(target).toEqual({
      accountKey: "acct:acme",
      workspaceKey: "ws:w1",
      isQuiet: false,
      repoNodeKey: `repo:${API}`, // API has a worktree (WT), so its own row must open too
    });
  });

  it("finds a repository directly under the account, with no workspace to open", () => {
    const target = ancestorsToReveal(tree(), TOOL);
    expect(target).toEqual({
      accountKey: "acct:acme",
      workspaceKey: null,
      isQuiet: false,
      repoNodeKey: null, // TOOL has no worktrees
    });
  });

  it("marks a quiet repository so its account's quiet row is opened too", () => {
    const quietTree = buildRepoTree({
      repos,
      accounts: [],
      workspaces: [],
      orderByParent: {},
      sortModeByAccount: {},
      signals: { [API]: { dirtyCount: 0 }, [WT]: { dirtyCount: 0 } },
      worktreesByRepo: { [API]: [{ path: WT, branch: "feat/login" }] },
      now: NOW,
    });
    const target = ancestorsToReveal(quietTree, API);
    expect(target).toMatchObject({ isQuiet: true, repoNodeKey: `repo:${API}` });
  });

  it("returns null for a path that isn't in the tree", () => {
    expect(ancestorsToReveal(tree(), "/gone")).toBeNull();
  });
});

describe("liveAvatarStack", () => {
  const branchOf = (p: string) => (p === WT ? "feat/login" : "main");
  const worktrees = { [API]: [{ path: WT, branch: "feat/login" }] };

  it("counts each repository once even if a worktree and its repo both changed", () => {
    const entries = liveEntries(
      { [WT]: NOW - 1_000, [API]: NOW - 2_000, [WEB]: NOW - 3_000 },
      NOW,
      repos,
      worktrees,
      branchOf,
    );
    const stack = liveAvatarStack(entries, 3);
    expect(stack.shown.map((r) => r.path)).toEqual([API, WEB]);
    expect(stack.overflow).toBe(0);
  });

  it("caps the shown avatars and reports the rest as overflow", () => {
    const entries = liveEntries(
      { [API]: NOW - 1_000, [WEB]: NOW - 2_000, [TOOL]: NOW - 3_000 },
      NOW,
      repos,
      worktrees,
      branchOf,
    );
    const stack = liveAvatarStack(entries, 2);
    expect(stack.shown.map((r) => r.path)).toEqual([API, WEB]);
    expect(stack.overflow).toBe(1);
  });

  it("is empty when nothing changed recently", () => {
    expect(liveAvatarStack([], 3)).toEqual({ shown: [], overflow: 0 });
  });
});
