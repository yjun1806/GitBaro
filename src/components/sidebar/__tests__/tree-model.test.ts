import { describe, expect, it } from "vitest";
import { buildRepoTree, type Workspace } from "@/lib/repo-tree";
import type { RepoInfo, RepoSyncStatus } from "@/types";
import type { WorktreeReviewStatus } from "@/hooks/useReviewStatus";
import {
  buildSignals,
  collapsibleKeys,
  expandedWorktreePaths,
  filterTree,
  isWatchedPath,
  workspaceRepoKey,
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
    unpushed: 0,
    isDirty: false,
    dirtyCount: 0,
    dirtyLatestMtime: null,
    ...over,
  };
}

function review(path: string): WorktreeReviewStatus {
  return { path, branch: "main", headOid: "abc", isMain: true, repoPath: path };
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
  it("merges sync status, known worktrees and change times per path", () => {
    const signals = buildSignals(
      { [API]: sync(API, { dirtyCount: 2, ahead: 1, unpushed: 1 }) },
      { [WT]: review(WT) },
      { [WEB]: NOW - 1000 },
    );
    expect(signals[API]).toEqual({ dirtyCount: 2, ahead: 1, behind: 0, lastChangedAt: null });
    expect(signals[WT]).toEqual({ dirtyCount: 0, ahead: 0, behind: 0, lastChangedAt: null });
    expect(signals[WEB]).toMatchObject({ lastChangedAt: NOW - 1000 });
  });

  it("counts commits on no remote as commits to push, even without an upstream", () => {
    const signals = buildSignals({ [API]: sync(API, { hasUpstream: false, ahead: 0, unpushed: 4 }) }, {}, {});
    expect(signals[API].ahead).toBe(4);
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
  it("lists accounts, workspace cards and every repository card, but not repository rows inside a workspace", () => {
    expect(collapsibleKeys(tree()).sort()).toEqual(["acct:acme", `repo:${TOOL}`, "ws:w1"]);
  });
});

describe("expandedWorktreePaths", () => {
  const openExcept = (closed: string[]) => (key: string) => !closed.includes(key);

  it("returns worktrees of expanded repositories only, asking with the workspace-row key inside a workspace", () => {
    expect(expandedWorktreePaths(tree(), openExcept([]))).toEqual([WT]);
    expect(expandedWorktreePaths(tree(), openExcept([workspaceRepoKey(API)]))).toEqual([]);
    // 워크스페이스 밖 저장소 카드의 키(repo:)는 워크스페이스 안 줄에 영향이 없다.
    expect(expandedWorktreePaths(tree(), openExcept([`repo:${API}`]))).toEqual([WT]);
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
    const saved = ["ws:w1", workspaceRepoKey(API)];
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
