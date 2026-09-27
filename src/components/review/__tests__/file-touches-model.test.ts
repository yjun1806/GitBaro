import { describe, expect, it } from "vitest";
import type { FileTouchesState } from "@/api/queries";
import type { CommitTouch, FileTouches, RepoFileTouches, ReviewWorktree } from "@/types";
import {
  fileTouchKey,
  fileTouchSources,
  groupFileTouches,
  latestTouchTime,
  ticketNoteKeys,
  type FileTouchSource,
} from "../file-touches-model";

function commitTouch(overrides: Partial<CommitTouch> & { oid: string; subject: string; authorTime: number }): CommitTouch {
  return {
    shortOid: overrides.oid.slice(0, 7),
    authorName: "t",
    parentOid: null,
    path: "src/a.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    isBinary: false,
    tooLarge: false,
    ...overrides,
  };
}

function fileTouches(overrides: Partial<FileTouches> & { path: string; commits: CommitTouch[] }): FileTouches {
  return {
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    isBinary: false,
    tooLarge: false,
    ...overrides,
  };
}

function repoResult(overrides: Partial<RepoFileTouches> & { path: string }): RepoFileTouches {
  return {
    error: null,
    truncated: false,
    rangeBase: "base",
    head: "head",
    merges: 0,
    files: [],
    ...overrides,
  };
}

function source(path: string, repoPath = path, worktreeLabel: string | null = null): FileTouchSource {
  return { repoPath, path, worktreeLabel };
}

function ok(data: RepoFileTouches): FileTouchesState {
  return { status: "success", data };
}

const PENDING: FileTouchesState = { status: "pending" };

describe("groupFileTouches", () => {
  it("puts files touched by 2+ commits before files touched by one, each newest-first", () => {
    const results = [
      ok(
        repoResult({
          path: "/a",
          files: [
            fileTouches({ path: "single-old.ts", commits: [commitTouch({ oid: "s1", subject: "s1", authorTime: 100 })] }),
            fileTouches({
              path: "multi.ts",
              commits: [
                commitTouch({ oid: "m2", subject: "m2", authorTime: 300 }),
                commitTouch({ oid: "m1", subject: "m1", authorTime: 200 }),
              ],
            }),
            fileTouches({ path: "single-new.ts", commits: [commitTouch({ oid: "s2", subject: "s2", authorTime: 400 })] }),
          ],
        }),
      ),
    ];
    const grouped = groupFileTouches([source("/a")], results);
    expect(grouped.multi.map((r) => r.touches.path)).toEqual(["multi.ts"]);
    expect(grouped.single.map((r) => r.touches.path)).toEqual(["single-new.ts", "single-old.ts"]);
  });

  it("re-sorts by recency across repositories, not just within one repo's own order", () => {
    const results = [
      ok(repoResult({ path: "/a", files: [fileTouches({ path: "old.ts", commits: [commitTouch({ oid: "a1", subject: "a1", authorTime: 100 })] })] })),
      ok(repoResult({ path: "/b", files: [fileTouches({ path: "new.ts", commits: [commitTouch({ oid: "b1", subject: "b1", authorTime: 500 })] })] })),
    ];
    const grouped = groupFileTouches([source("/a"), source("/b")], results);
    expect(grouped.single.map((r) => `${r.source.path}:${r.touches.path}`)).toEqual(["/b:new.ts", "/a:old.ts"]);
  });

  it("sorts by the latest commit time among a file's commits, not by its first-listed commit (same rule as the backend)", () => {
    // 걸음 순서의 첫 커밋(commits[0])이 작성 시각은 더 이르다(rebase한 커밋). 가장 늦은 시각(900)으로 줄 세운다.
    const rebased = fileTouches({
      path: "rebased.ts",
      commits: [
        commitTouch({ oid: "r2", subject: "r2", authorTime: 100 }),
        commitTouch({ oid: "r1", subject: "r1", authorTime: 900 }),
      ],
    });
    const plain = fileTouches({
      path: "plain.ts",
      commits: [
        commitTouch({ oid: "p2", subject: "p2", authorTime: 500 }),
        commitTouch({ oid: "p1", subject: "p1", authorTime: 400 }),
      ],
    });
    expect(latestTouchTime(rebased)).toBe(900);
    const grouped = groupFileTouches([source("/a")], [ok(repoResult({ path: "/a", files: [plain, rebased] }))]);
    expect(grouped.multi.map((r) => r.touches.path)).toEqual(["rebased.ts", "plain.ts"]);
  });

  it("puts files changed only in a merge (no commits) in their own group", () => {
    const results = [
      ok(
        repoResult({
          path: "/a",
          merges: 2,
          files: [
            fileTouches({ path: "resolved.ts", commits: [] }),
            fileTouches({ path: "x.ts", commits: [commitTouch({ oid: "a1", subject: "a1", authorTime: 1 })] }),
          ],
        }),
      ),
    ];
    const grouped = groupFileTouches([source("/a")], results);
    expect(grouped.single.map((r) => r.touches.path)).toEqual(["x.ts"]);
    expect(grouped.mergeOnly.map((r) => r.touches.path)).toEqual(["resolved.ts"]);
    expect(grouped.merges).toEqual([{ source: source("/a"), count: 2 }]);
  });

  it("keeps a stable key per worktree + path so the same path in two worktrees does not collide", () => {
    expect(fileTouchKey("/a", "x.ts")).not.toBe(fileTouchKey("/a-feat", "x.ts"));
  });

  it("carries the worktree's rangeBase/head and source onto every row, for the combined diff query", () => {
    const wt = source("/a-feat", "/a", "feat");
    const results = [
      ok(
        repoResult({
          path: "/a-feat",
          rangeBase: "base-a",
          head: "head-a",
          files: [fileTouches({ path: "x.ts", commits: [commitTouch({ oid: "a1", subject: "a1", authorTime: 1 })] })],
        }),
      ),
    ];
    const [row] = groupFileTouches([wt], results).single;
    expect(row.rangeBase).toBe("base-a");
    expect(row.head).toBe("head-a");
    expect(row.source).toEqual(wt);
  });

  it("reports a repository it could not read as an error, not as an empty file list", () => {
    const grouped = groupFileTouches([source("/a")], [ok(repoResult({ path: "/a", error: "not a repository" }))]);
    expect(grouped.errors).toEqual([{ source: source("/a"), error: "not a repository" }]);
    expect(grouped.multi).toHaveLength(0);
    expect(grouped.single).toHaveLength(0);
  });

  it("reports a failed query (rejected invoke) as that worktree's error instead of loading forever", () => {
    const grouped = groupFileTouches([source("/a"), source("/b")], [PENDING, { status: "error", error: "channel closed" }]);
    expect(grouped.errors).toEqual([{ source: source("/b"), error: "channel closed" }]);
    expect(grouped.pending).toEqual([source("/a")]);
  });

  it("collects truncated repositories separately from errors", () => {
    expect(groupFileTouches([source("/a")], [ok(repoResult({ path: "/a", truncated: true }))]).truncated).toEqual([source("/a")]);
  });

  it("keeps the rows of read worktrees while another is still loading", () => {
    const results = [
      ok(repoResult({ path: "/a", files: [fileTouches({ path: "x.ts", commits: [commitTouch({ oid: "a1", subject: "a1", authorTime: 1 })] })] })),
      PENDING,
    ];
    const grouped = groupFileTouches([source("/a"), source("/b")], results);
    expect(grouped.single.map((r) => r.touches.path)).toEqual(["x.ts"]);
    expect(grouped.pending).toEqual([source("/b")]);
  });

  it("treats a missing result as pending", () => {
    expect(groupFileTouches([source("/a")], []).pending).toEqual([source("/a")]);
  });

  it("is empty (no rows, no errors, nothing pending) when nothing is unpushed anywhere", () => {
    const grouped = groupFileTouches([source("/a"), source("/b")], [ok(repoResult({ path: "/a" })), ok(repoResult({ path: "/b" }))]);
    expect(grouped.multi).toHaveLength(0);
    expect(grouped.single).toHaveLength(0);
    expect(grouped.errors).toHaveLength(0);
    expect(grouped.pending).toHaveLength(0);
  });
});

describe("fileTouchSources", () => {
  function wt(path: string, overrides: Partial<ReviewWorktree> = {}): ReviewWorktree {
    return { path, branch: null, headOid: null, isMain: false, ...overrides };
  }

  it("reads every worktree of each repository, main first, labelling linked ones", () => {
    const sources = fileTouchSources([
      {
        path: "/app",
        worktrees: [
          wt("/app/.worktrees/feat", { branch: "feat/x", headOid: "h2" }),
          wt("/app", { branch: "main", headOid: "h1", isMain: true }),
          wt("/tmp/detached", { headOid: "h3" }),
        ],
      },
      { path: "/api", worktrees: [wt("/api", { branch: "main", headOid: "h1", isMain: true })] },
    ]);
    expect(sources).toEqual([
      { repoPath: "/app", path: "/app", worktreeLabel: null },
      { repoPath: "/app", path: "/app/.worktrees/feat", worktreeLabel: "feat/x" },
      { repoPath: "/app", path: "/tmp/detached", worktreeLabel: "detached" },
      // 다른 저장소는 HEAD가 같은 값이어도 따로 읽는다.
      { repoPath: "/api", path: "/api", worktreeLabel: null },
    ]);
  });

  it("reads a worktree whose HEAD equals an earlier one in the same repository only once", () => {
    const sources = fileTouchSources([
      {
        path: "/app",
        worktrees: [
          wt("/app", { branch: "main", headOid: "h1", isMain: true }),
          wt("/app-review", { headOid: "h1" }),
          wt("/app-new", { headOid: null }),
          wt("/app-new2", { headOid: null }),
        ],
      },
    ]);
    expect(sources.map((s) => s.path)).toEqual(["/app", "/app-new", "/app-new2"]);
  });
});

describe("ticketNoteKeys", () => {
  it("is empty for a single commit, even with a ticket key in the subject", () => {
    expect(ticketNoteKeys([commitTouch({ oid: "a", subject: "[XMS-371] fix thing", authorTime: 1 })])).toEqual([]);
  });

  it("is empty when every commit shares the same ticket key", () => {
    const commits = [
      commitTouch({ oid: "a", subject: "[XMS-371] one", authorTime: 2 }),
      commitTouch({ oid: "b", subject: "[XMS-371] two", authorTime: 1 }),
    ];
    expect(ticketNoteKeys(commits)).toEqual([]);
  });

  it("lists the distinct ticket keys, in first-seen order, once a file's commits carry 2+", () => {
    const commits = [
      commitTouch({ oid: "a", subject: "[XMS-371] one", authorTime: 2 }),
      commitTouch({ oid: "b", subject: "[XMS-364] two", authorTime: 1 }),
    ];
    expect(ticketNoteKeys(commits)).toEqual(["XMS-371", "XMS-364"]);
  });

  it("is empty when no commit subject has a ticket key", () => {
    const commits = [
      commitTouch({ oid: "a", subject: "fix thing", authorTime: 2 }),
      commitTouch({ oid: "b", subject: "another fix", authorTime: 1 }),
    ];
    expect(ticketNoteKeys(commits)).toEqual([]);
  });
});
