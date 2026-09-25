import { describe, expect, it } from "vitest";
import { buildRepoTree, QUIET_WINDOW_MS, type PathSignals } from "@/lib/repo-tree";
import { suggestWorktreePath } from "@/components/worktree/worktree-path";
import type { RepoInfo } from "@/types";

const NOW = 2_000_000_000_000;

function repo(path: string): RepoInfo {
  const name = path.split("/").pop()!;
  return {
    path,
    name,
    currentBranch: "main",
    isDirty: false,
    remotes: [{ name: "origin", url: `https://github.com/acme/${name}.git` }],
    accountId: null,
  };
}

const ALPHA = "/r/alpha";
const BETA = "/r/beta";
const repos = [repo(ALPHA), repo(BETA)];

function tree(signals: Record<string, PathSignals>, extra: Partial<Parameters<typeof buildRepoTree>[0]> = {}) {
  return buildRepoTree({
    repos,
    accounts: [],
    workspaces: [],
    orderByParent: {},
    sortModeByAccount: {},
    signals,
    now: NOW,
    ...extra,
  })[0];
}

describe("buildRepoTree — sidebar settings", () => {
  // 5분 전에 바뀌었고 할 일은 없다.
  const signals: Record<string, PathSignals> = {
    [ALPHA]: { dirtyCount: 0, lastChangedAt: NOW - 5 * 60_000 },
    [BETA]: { dirtyCount: 0, lastChangedAt: NOW - QUIET_WINDOW_MS - 1 },
  };

  it("uses the chosen quiet window", () => {
    expect(tree(signals).quietRepos.map((n) => n.repo.path)).toEqual([BETA]);
    expect(tree(signals, { quietWindowMs: 2 * 60_000 }).quietRepos.map((n) => n.repo.path)).toEqual([ALPHA, BETA]);
  });

  it("keeps quiet repositories among the others when folding is off", () => {
    const account = tree(signals, { collapseQuiet: false });
    expect(account.quietRepos).toEqual([]);
    expect(account.children.map((c) => (c.kind === "repo" ? c.repo.path : c.key))).toEqual([ALPHA, BETA]);
  });

  it("sorts by display name when sorting by name", () => {
    const names: Record<string, string> = { [ALPHA]: "zeta", [BETA]: "able" };
    const account = tree({}, { sortModeByAccount: { acme: "name" }, nameOf: (r) => names[r.path] });
    expect(account.children.map((c) => (c.kind === "repo" ? c.repo.path : c.key))).toEqual([BETA, ALPHA]);
  });
});

describe("suggestWorktreePath", () => {
  it("puts the worktree next to the repository by default", () => {
    expect(suggestWorktreePath("/Users/me/code/app", "feat/login")).toBe("/Users/me/code/app-feat-login");
  });

  it("uses the chosen parent folder when set", () => {
    expect(suggestWorktreePath("/Users/me/code/app", "feat/login", "/Users/me/wt/")).toBe("/Users/me/wt/app-feat-login");
  });

  it("suggests nothing without a branch", () => {
    expect(suggestWorktreePath("/Users/me/code/app", "", "/Users/me/wt")).toBe("");
  });
});
