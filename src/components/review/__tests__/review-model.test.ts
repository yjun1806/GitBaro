import { describe, expect, it } from "vitest";
import {
  activityInvalidationKeys,
  isHiddenReviewRepo,
  isOnDefaultBranch,
  repoOfActivityPath,
  splitReviewRepos,
  type ReviewRepoSignals,
} from "../review-model";

const quiet: ReviewRepoSignals = {
  branch: "main",
  defaultBranch: "main",
  newCount: 0,
  wipCount: 0,
  error: null,
};

describe("isHiddenReviewRepo (질문 2: main에 있고 새 커밋·WIP가 없으면 숨김)", () => {
  it("hides a repository on its default branch with nothing to review", () => {
    expect(isHiddenReviewRepo(quiet)).toBe(true);
  });

  it("shows it when it has new commits", () => {
    expect(isHiddenReviewRepo({ ...quiet, newCount: 2 })).toBe(false);
  });

  it("shows it when it has uncommitted changes", () => {
    expect(isHiddenReviewRepo({ ...quiet, wipCount: 1 })).toBe(false);
  });

  it("shows it when it is on another branch, even with nothing new", () => {
    expect(isHiddenReviewRepo({ ...quiet, branch: "feat/x" })).toBe(false);
  });

  it("uses the repository's own default branch (trunk), not a fixed name", () => {
    expect(isHiddenReviewRepo({ ...quiet, branch: "trunk", defaultBranch: "trunk" })).toBe(true);
    expect(isHiddenReviewRepo({ ...quiet, branch: "main", defaultBranch: "trunk" })).toBe(false);
  });

  it("falls back to main/master when the default branch is unknown", () => {
    expect(isOnDefaultBranch("master", null)).toBe(true);
    expect(isOnDefaultBranch("develop", null)).toBe(false);
    expect(isHiddenReviewRepo({ ...quiet, branch: "master", defaultBranch: null })).toBe(true);
  });

  it("never hides detached HEAD or a repository it could not read", () => {
    expect(isHiddenReviewRepo({ ...quiet, branch: null })).toBe(false);
    expect(isHiddenReviewRepo({ ...quiet, error: "not a repo" })).toBe(false);
  });

  it("treats a not-yet-counted new-commit number as zero", () => {
    expect(isHiddenReviewRepo({ ...quiet, newCount: null })).toBe(true);
  });
});

describe("splitReviewRepos", () => {
  const repos = [
    { ...quiet, id: "a" },
    { ...quiet, id: "b", newCount: 3 },
    { ...quiet, id: "c", wipCount: 2 },
  ];

  it("keeps the order and counts what it hid", () => {
    const { visible, hiddenCount } = splitReviewRepos(repos, false);
    expect(visible.map((r) => r.id)).toEqual(["b", "c"]);
    expect(hiddenCount).toBe(1);
  });

  it("shows everything with show-all", () => {
    const { visible, hiddenCount } = splitReviewRepos(repos, true);
    expect(visible.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(hiddenCount).toBe(0);
  });
});

describe("repoOfActivityPath", () => {
  const repos = [
    { repoPath: "/w/app", worktreePaths: ["/w/app", "/w/app/.worktrees/feat"] },
    { repoPath: "/w/app-admin", worktreePaths: ["/w/app-admin"] },
    { repoPath: "/w/other", worktreePaths: ["/w/other", "/w/app/.claude/worktrees/x"] },
  ];

  it("maps a repository or worktree path to its repository", () => {
    expect(repoOfActivityPath("/w/app", repos)).toBe("/w/app");
    expect(repoOfActivityPath("/w/app/.worktrees/feat", repos)).toBe("/w/app");
    expect(repoOfActivityPath("/w/app-admin/", repos)).toBe("/w/app-admin");
  });

  it("does not mistake a sibling with the same prefix for the repository", () => {
    expect(repoOfActivityPath("/w/app-admin/src", repos)).toBe("/w/app-admin");
  });

  it("picks the deepest match when a worktree lives inside another repository", () => {
    expect(repoOfActivityPath("/w/app/.claude/worktrees/x", repos)).toBe("/w/other");
  });

  it("returns null outside the workspace", () => {
    expect(repoOfActivityPath("/elsewhere", repos)).toBeNull();
  });
});

describe("activityInvalidationKeys", () => {
  it("lists only that repository's status, diff and timeline keys", () => {
    expect(
      activityInvalidationKeys({ repoPath: "/w/app", worktreePaths: ["/w/app", "/w/app-feat"] }),
    ).toEqual([
      ["status", "/w/app"],
      ["status", "/w/app-feat"],
      ["fileDiff", "/w/app"],
      ["fileDiff", "/w/app-feat"],
      ["workspaceHistory", "/w/app"],
    ]);
  });
});
