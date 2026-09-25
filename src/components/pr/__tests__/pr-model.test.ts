import { describe, expect, it } from "vitest";
import type { BranchInfo, PrReviewThread, PullRequestSummary } from "@/types";
import {
  fileStatusOf,
  headBranchRefs,
  openThreadCount,
  orderForBranch,
  prErrorKind,
  revealLineOf,
  threadsByFile,
} from "../pr-model";

function thread(extra: Partial<PrReviewThread>): PrReviewThread {
  return {
    id: "t",
    path: "a.ts",
    line: 1,
    originalLine: 1,
    startLine: null,
    side: "right",
    isResolved: false,
    isOutdated: false,
    diffHunk: "",
    comments: [],
    commentsTruncated: false,
    ...extra,
  };
}

function pr(extra: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    number: 1,
    title: "t",
    url: "u",
    state: "open",
    isDraft: false,
    author: { login: "a", avatarUrl: null },
    headRef: "feat",
    baseRef: "main",
    headSha: "h",
    isCrossRepository: false,
    headRepo: "acme/app",
    reviewDecision: null,
    ciState: null,
    commentCount: 0,
    threadCount: 0,
    labels: [],
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

function branch(name: string, isRemote: boolean): BranchInfo {
  return {
    name,
    isHead: false,
    isRemote,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
  };
}

describe("threadsByFile", () => {
  it("groups by file, splits outdated threads off and sorts by line", () => {
    const map = threadsByFile([
      thread({ id: "b30", path: "b.ts", line: 30 }),
      thread({ id: "a20", line: 20 }),
      thread({ id: "a-old", line: null, originalLine: 5, isOutdated: true }),
      thread({ id: "a3", line: 3 }),
    ]);
    expect([...map.keys()]).toEqual(["b.ts", "a.ts"]);
    expect(map.get("a.ts")!.current.map((t) => t.id)).toEqual(["a3", "a20"]);
    expect(map.get("a.ts")!.outdated.map((t) => t.id)).toEqual(["a-old"]);
    expect(map.get("b.ts")!.outdated).toEqual([]);
  });

  it("counts only unresolved threads, outdated ones included", () => {
    const map = threadsByFile([
      thread({ id: "1" }),
      thread({ id: "2", isResolved: true }),
      thread({ id: "3", isOutdated: true, line: null }),
    ]);
    expect(openThreadCount(map.get("a.ts"))).toBe(2);
    expect(openThreadCount(undefined)).toBe(0);
  });
});

describe("revealLineOf", () => {
  it("reveals only new-side lines that still have a place in the diff", () => {
    expect(revealLineOf(thread({ line: 12 }))).toBe(12);
    expect(revealLineOf(thread({ line: 12, side: "left" }))).toBeNull();
    expect(revealLineOf(thread({ line: null, isOutdated: true }))).toBeNull();
  });
});

describe("orderForBranch", () => {
  it("puts the open same-repo PR of the checked-out branch first and marks it", () => {
    const rows = orderForBranch(
      [
        pr({ number: 1, headRef: "other" }),
        pr({ number: 2, headRef: "feat" }),
        pr({ number: 3, headRef: "feat", isCrossRepository: true }),
        pr({ number: 4, headRef: "feat", state: "closed" }),
      ],
      "feat",
    );
    expect(rows.map((r) => [r.pr.number, r.isCurrent])).toEqual([
      [2, true],
      [1, false],
      [3, false],
      [4, false],
    ]);
  });

  it("keeps the order when no branch is checked out", () => {
    const rows = orderForBranch([pr({ number: 1 }), pr({ number: 2 })], null);
    expect(rows.map((r) => r.isCurrent)).toEqual([false, false]);
  });
});

describe("headBranchRefs", () => {
  it("prefers the local branch and an origin remote branch", () => {
    const branches = [branch("feat", false), branch("upstream/feat", true), branch("origin/feat", true)];
    expect(headBranchRefs(pr({}), branches, ["upstream", "origin"])).toEqual({ local: "feat", remote: "origin/feat" });
  });

  it("has nothing to check out for fork PRs or unknown branches", () => {
    expect(headBranchRefs(pr({ isCrossRepository: true }), [branch("feat", false)], ["origin"])).toEqual({
      local: null,
      remote: null,
    });
    expect(headBranchRefs(pr({}), [branch("main", false)], ["origin"])).toEqual({ local: null, remote: null });
  });
});

describe("prErrorKind", () => {
  it("reads the backend error type and HTTP status", () => {
    expect(prErrorKind({ type: "GithubApi", message: "HTTP 404: Not Found" })).toBe("notFound");
    expect(prErrorKind({ type: "GithubApi", message: "HTTP 403: nope" })).toBe("forbidden");
    expect(prErrorKind({ type: "GithubApi", message: "HTTP 500: boom" })).toBe("other");
    expect(prErrorKind({ type: "RateLimit", message: "Resets at 1" })).toBe("rateLimited");
    expect(prErrorKind({ type: "Auth", message: "Could not resolve owner/repo" })).toBe("noGitHubRemote");
    expect(prErrorKind({ type: "Network", message: "timeout" })).toBe("network");
    expect(prErrorKind("plain")).toBe("other");
  });
});

describe("fileStatusOf", () => {
  it("maps GitHub file states onto the app's badges", () => {
    expect(fileStatusOf("removed")).toBe("deleted");
    expect(fileStatusOf("renamed")).toBe("renamed");
    expect(fileStatusOf("changed")).toBe("modified");
  });
});
