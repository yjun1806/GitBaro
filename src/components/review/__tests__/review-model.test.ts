import { describe, expect, it } from "vitest";
import type { CommitInfo, NewCommitIds, WorkspaceRepoHistory } from "@/types";
import {
  activityInvalidationKeys,
  isHiddenReviewRepo,
  isOnDefaultBranch,
  activityTargetOf,
  laneCommitsOf,
  splitReviewRepos,
  sumNewCounts,
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

describe("sumNewCounts", () => {
  const c = (path: string, newCount: number): NewCommitIds => ({ path, headOid: "h", newCount, basis: "oid", ids: [] });

  it("adds every worktree's new commits, not just the main checkout's", () => {
    expect(sumNewCounts(["/w/a", "/w/a-feat"], { "/w/a": c("/w/a", 0), "/w/a-feat": c("/w/a-feat", 3) })).toBe(3);
  });

  it("is null when nothing was counted yet", () => {
    expect(sumNewCounts(["/w/a"], {})).toBeNull();
  });
});

describe("laneCommitsOf", () => {
  const commit = (id: string): CommitInfo => ({
    id,
    shortId: id,
    message: id,
    summary: id,
    author: { name: "t", email: "t@t" },
    committer: { name: "t", email: "t@t" },
    timestamp: 1,
    parentIds: [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  });
  const history = (commits: CommitInfo[]): WorkspaceRepoHistory => ({
    path: "/w/a",
    branch: "main",
    headOid: "c3",
    defaultBranch: "main",
    baseRef: "origin/main",
    baseStatus: "found",
    mergeBaseOid: "c3",
    mergeBaseCommit: commit("c3"),
    commits,
    truncated: false,
    error: null,
  });

  it("keeps the timeline and the base when it already holds every new commit", () => {
    const lane = laneCommitsOf(history([commit("f1")]), new Set(["f1"]), undefined);
    expect(lane).toEqual({ commits: [commit("f1")], hasBase: true, needsRecent: false });
  });

  it("adds new commits that sit at or below the merge base, and ends the lane without the base row", () => {
    // main에서 pull로 받은 커밋: 갈라진 지점 = HEAD라 타임라인이 비었다.
    const ids = new Set(["c3", "c2"]);
    expect(laneCommitsOf(history([]), ids, undefined)).toEqual({ commits: [], hasBase: false, needsRecent: true });
    const lane = laneCommitsOf(history([]), ids, [commit("c3"), commit("c2"), commit("c1")]);
    expect(lane.commits.map((x) => x.id)).toEqual(["c3", "c2"]);
    expect(lane.hasBase).toBe(false);
  });
});
