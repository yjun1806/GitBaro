import { describe, expect, it } from "vitest";
import {
  activityInvalidationKeys,
  dedupeReviewMembers,
  isHiddenReviewRepo,
  isOnDefaultBranch,
  activityTargetOf,
  type ReviewRepoSignals,
} from "../review-model";

const quiet: ReviewRepoSignals = {
  branch: "main",
  defaultBranch: "main",
  unpushedCount: 0,
  wipCount: 0,
  error: null,
};

describe("isHiddenReviewRepo (질문 2: main에 있고 원격에 없는 커밋·WIP가 없으면 숨김)", () => {
  it("hides a repository on its default branch with nothing to review", () => {
    expect(isHiddenReviewRepo(quiet)).toBe(true);
  });

  it("shows it when it has commits no remote has yet", () => {
    expect(isHiddenReviewRepo({ ...quiet, unpushedCount: 2 })).toBe(false);
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

  it("treats a not-yet-counted unpushed number as zero", () => {
    expect(isHiddenReviewRepo({ ...quiet, unpushedCount: null })).toBe(true);
  });
});

describe("activityTargetOf", () => {
  const repos = [
    { repoPath: "/w/app", worktreePaths: ["/w/app", "/w/app/.worktrees/feat"] },
    { repoPath: "/w/app-admin", worktreePaths: ["/w/app-admin"] },
    { repoPath: "/w/other", worktreePaths: ["/w/other", "/w/app/.claude/worktrees/x"] },
  ];

  it("maps a repository or worktree path to that worktree and its repository", () => {
    expect(activityTargetOf("/w/app", repos)).toEqual({ repoPath: "/w/app", root: "/w/app" });
    expect(activityTargetOf("/w/app/.worktrees/feat", repos)).toEqual({
      repoPath: "/w/app",
      root: "/w/app/.worktrees/feat",
    });
    expect(activityTargetOf("/w/app-admin/", repos)).toEqual({ repoPath: "/w/app-admin", root: "/w/app-admin" });
  });

  it("does not mistake a sibling with the same prefix for the repository", () => {
    expect(activityTargetOf("/w/app-admin/src", repos)?.repoPath).toBe("/w/app-admin");
  });

  it("picks the deepest match when a worktree lives inside another repository", () => {
    expect(activityTargetOf("/w/app/.claude/worktrees/x", repos)).toEqual({
      repoPath: "/w/other",
      root: "/w/app/.claude/worktrees/x",
    });
  });

  it("returns null outside the workspace", () => {
    expect(activityTargetOf("/elsewhere", repos)).toBeNull();
  });
});

describe("activityInvalidationKeys", () => {
  it("lists only that worktree's status and diff keys, not the timeline", () => {
    expect(activityInvalidationKeys("/w/app-feat")).toEqual([
      ["status", "/w/app-feat"],
      ["fileDiff", "/w/app-feat"],
    ]);
  });
});

describe("dedupeReviewMembers", () => {
  const member = (path: string, worktrees: string[]) => ({ path, worktrees: worktrees.map((p) => ({ path: p })) });

  it("keeps each worktree in the first repository that lists it and drops a repository that is another's worktree", () => {
    const out = dedupeReviewMembers([
      member("/r/api", ["/r/api", "/r/api-feat"]),
      member("/r/web", ["/r/web"]),
      member("/r/api-feat/", ["/r/api", "/r/api-feat"]),
    ]);
    expect(out.map((m) => [m.path, m.worktrees.map((w) => w.path)])).toEqual([
      ["/r/api", ["/r/api", "/r/api-feat"]],
      ["/r/web", ["/r/web"]],
    ]);
  });
});
