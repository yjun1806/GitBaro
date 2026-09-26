import { describe, expect, it } from "vitest";
import { resolveScope, sameScope, type ScopeAppState } from "../scope";

const base: ScopeAppState = {
  activeWorkspaceId: null,
  ownerRepoPath: null,
  activeWorktreePath: null,
  currentBranch: null,
  aggregateRepoPath: null,
  viewedBranch: null,
};

describe("resolveScope", () => {
  it("is null when nothing is open", () => {
    expect(resolveScope(base)).toBeNull();
  });

  it("resolves to the workspace when one is active, even with a repo also open", () => {
    expect(
      resolveScope({ ...base, activeWorkspaceId: "ws1", ownerRepoPath: "/r/a", currentBranch: "main" }),
    ).toEqual({ kind: "workspace", workspaceId: "ws1" });
  });

  it("resolves to the checked-out branch by default", () => {
    expect(
      resolveScope({ ...base, ownerRepoPath: "/r/a", activeWorktreePath: "/r/a", currentBranch: "feat/x" }),
    ).toEqual({ kind: "branch", repoPath: "/r/a", branch: "feat/x", worktreePath: "/r/a" });
  });

  it("resolves to the repo scope when the sidebar repo row is chosen (aggregate view)", () => {
    expect(
      resolveScope({
        ...base,
        ownerRepoPath: "/r/a",
        activeWorktreePath: "/r/a",
        currentBranch: "feat/x",
        aggregateRepoPath: "/r/a",
      }),
    ).toEqual({ kind: "repo", repoPath: "/r/a" });
  });

  it("ignores an aggregate flag left over from a different repo", () => {
    expect(
      resolveScope({
        ...base,
        ownerRepoPath: "/r/a",
        activeWorktreePath: "/r/a",
        currentBranch: "main",
        aggregateRepoPath: "/r/other",
      }),
    ).toEqual({ kind: "branch", repoPath: "/r/a", branch: "main", worktreePath: "/r/a" });
  });

  it("falls back to the repo scope on a detached HEAD (no branch to scope into)", () => {
    expect(resolveScope({ ...base, ownerRepoPath: "/r/a", activeWorktreePath: "/r/a" })).toEqual({
      kind: "repo",
      repoPath: "/r/a",
    });
  });

  it("prefers a viewed (not checked out) branch over the checked-out one, and clears the worktree", () => {
    expect(
      resolveScope({
        ...base,
        ownerRepoPath: "/r/a",
        activeWorktreePath: "/r/a",
        currentBranch: "main",
        viewedBranch: "feat/other",
      }),
    ).toEqual({ kind: "branch", repoPath: "/r/a", branch: "feat/other", worktreePath: null });
  });
});

describe("sameScope", () => {
  it("treats null as equal only to null", () => {
    expect(sameScope(null, null)).toBe(true);
    expect(sameScope(null, { kind: "repo", repoPath: "/r/a" })).toBe(false);
  });

  it("compares by the identifying field of each kind", () => {
    expect(sameScope({ kind: "workspace", workspaceId: "w1" }, { kind: "workspace", workspaceId: "w1" })).toBe(true);
    expect(sameScope({ kind: "workspace", workspaceId: "w1" }, { kind: "workspace", workspaceId: "w2" })).toBe(false);
    expect(sameScope({ kind: "repo", repoPath: "/r/a" }, { kind: "workspace", workspaceId: "w1" })).toBe(false);
    expect(
      sameScope(
        { kind: "branch", repoPath: "/r/a", branch: "main", worktreePath: "/r/a" },
        { kind: "branch", repoPath: "/r/a", branch: "main", worktreePath: null },
      ),
    ).toBe(true);
  });
});
