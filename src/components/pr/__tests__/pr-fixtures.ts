import type { PullRequestDetail, PullRequestSummary, RepoInfo } from "@/types";

export const REPO = "/work/app";

export const repo = {
  path: REPO,
  name: "app",
  remotes: [{ name: "origin", url: "https://github.com/acme/app.git" }],
  accountId: "yj",
} as unknown as RepoInfo;

export function summary(extra: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 1,
    title: "Some change",
    url: "https://github.com/acme/app/pull/1",
    state: "open",
    isDraft: false,
    author: { login: "agent-bot", avatarUrl: null },
    headRef: "feat/x",
    baseRef: "main",
    headSha: "head1",
    isCrossRepository: false,
    headRepo: "acme/app",
    reviewDecision: null,
    ciState: null,
    commentCount: 0,
    threadCount: 0,
    labels: [],
    createdAt: "2026-09-20T09:00:00Z",
    updatedAt: "2026-09-21T09:00:00Z",
    ...extra,
  };
}

export function detail(extra: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ...summary({ number: 42, title: "Add login form", url: "https://github.com/acme/app/pull/42" }),
    body: "Adds a **login** form.\n\n<img src=x onerror=alert(1)>",
    baseSha: "base0",
    mergedAt: null,
    closedAt: null,
    mergeable: "mergeable",
    additions: 3,
    deletions: 1,
    changedFiles: 2,
    reviewers: [{ login: "alice", avatarUrl: null, state: "approved", isTeam: false }],
    commits: [{ oid: "c0ffee1234", headline: "feat: add form", authorName: "Agent", author: null, authoredAt: "2026-09-20T08:00:00Z" }],
    commitCount: 1,
    checks: [{ name: "test", status: "completed", conclusion: "failure", url: "https://ci/1", description: null }],
    conversation: [
      { kind: "comment", id: "c1", author: { login: "bob", avatarUrl: null }, body: "First comment", createdAt: "2026-09-20T10:00:00Z", url: "u1", reviewState: null },
      { kind: "review", id: "r1", author: { login: "alice", avatarUrl: null }, body: "", createdAt: "2026-09-20T11:00:00Z", url: "u2", reviewState: "approved" },
    ],
    threads: [
      {
        id: "t1", path: "src/login.ts", line: 11, originalLine: 11, startLine: null, side: "right",
        isResolved: false, isOutdated: false, diffHunk: "@@ -10,3 +10,4 @@\n a\n+c",
        comments: [{ id: "tc1", author: { login: "alice", avatarUrl: null }, body: "Why this line?", createdAt: "2026-09-20T12:00:00Z", url: "u3" }],
        commentsTruncated: false,
      },
      {
        id: "t2", path: "src/login.ts", line: null, originalLine: 4, startLine: null, side: "right",
        isResolved: false, isOutdated: true, diffHunk: "@@ -3,3 +3,3 @@\n-x\n+old line",
        comments: [{ id: "tc2", author: { login: "bob", avatarUrl: null }, body: "Stale remark", createdAt: "2026-09-19T12:00:00Z", url: "u4" }],
        commentsTruncated: false,
      },
    ],
    truncated: { commits: false, comments: false, reviews: false, threads: false, checks: false },
    localDiff: false,
    ...extra,
  };
}

/** `list_pull_request_files`의 원본 모양(`kind`). */
export const rawFiles = {
  truncated: false,
  files: [
    {
      path: "src/login.ts",
      oldPath: null,
      status: "modified",
      additions: 2,
      deletions: 1,
      hunks: [
        {
          header: "@@ -10,3 +10,4 @@\n",
          oldStart: 10,
          newStart: 10,
          lines: [
            { kind: "context", content: "a\n", oldLineNo: 10, newLineNo: 10 },
            { kind: "deletion", content: "b\n", oldLineNo: 11, newLineNo: null },
            { kind: "addition", content: "c\n", oldLineNo: null, newLineNo: 11 },
          ],
        },
      ],
    },
    { path: "assets/logo.png", oldPath: null, status: "added", additions: 0, deletions: 0, hunks: null },
  ],
};
