import { describe, expect, it } from "vitest";
import type { CommitTouch, FileTouches, RepoFileTouches } from "@/types";
import { fileTouchKey, groupFileTouches, ticketNoteKeys } from "../file-touches-model";

function commitTouch(overrides: Partial<CommitTouch> & { oid: string; subject: string; authorTime: number }): CommitTouch {
  return {
    shortOid: overrides.oid.slice(0, 7),
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
    files: [],
    ...overrides,
  };
}

describe("groupFileTouches", () => {
  it("puts files touched by 2+ commits before files touched by one, each newest-first", () => {
    const results: RepoFileTouches[] = [
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
    ];
    const grouped = groupFileTouches(["/a"], results);
    expect(grouped.multi.map((r) => r.touches.path)).toEqual(["multi.ts"]);
    expect(grouped.single.map((r) => r.touches.path)).toEqual(["single-new.ts", "single-old.ts"]);
  });

  it("re-sorts by recency across repositories, not just within one repo's own order", () => {
    const results: RepoFileTouches[] = [
      repoResult({
        path: "/a",
        files: [fileTouches({ path: "old.ts", commits: [commitTouch({ oid: "a1", subject: "a1", authorTime: 100 })] })],
      }),
      repoResult({
        path: "/b",
        files: [fileTouches({ path: "new.ts", commits: [commitTouch({ oid: "b1", subject: "b1", authorTime: 500 })] })],
      }),
    ];
    const grouped = groupFileTouches(["/a", "/b"], results);
    expect(grouped.single.map((r) => `${r.repoPath}:${r.touches.path}`)).toEqual(["/b:new.ts", "/a:old.ts"]);
  });

  it("keeps a stable key per repository + path so the same path in two repos does not collide", () => {
    expect(fileTouchKey("/a", "x.ts")).not.toBe(fileTouchKey("/b", "x.ts"));
  });

  it("carries the repository's rangeBase/head onto every row, for the combined diff query", () => {
    const results: RepoFileTouches[] = [
      repoResult({
        path: "/a",
        rangeBase: "base-a",
        head: "head-a",
        files: [fileTouches({ path: "x.ts", commits: [commitTouch({ oid: "a1", subject: "a1", authorTime: 1 })] })],
      }),
    ];
    const [row] = groupFileTouches(["/a"], results).single;
    expect(row.rangeBase).toBe("base-a");
    expect(row.head).toBe("head-a");
  });

  it("reports a repository it could not read as an error, not as an empty file list", () => {
    const results: RepoFileTouches[] = [repoResult({ path: "/a", error: "not a repository" })];
    const grouped = groupFileTouches(["/a"], results);
    expect(grouped.errors).toEqual([{ repoPath: "/a", error: "not a repository" }]);
    expect(grouped.multi).toHaveLength(0);
    expect(grouped.single).toHaveLength(0);
  });

  it("collects truncated repositories separately from errors", () => {
    const results: RepoFileTouches[] = [repoResult({ path: "/a", truncated: true })];
    expect(groupFileTouches(["/a"], results).truncatedRepos).toEqual(["/a"]);
  });

  it("is loading while any repository's query has not resolved yet", () => {
    const results: (RepoFileTouches | undefined)[] = [repoResult({ path: "/a" }), undefined];
    expect(groupFileTouches(["/a", "/b"], results).isLoading).toBe(true);
  });

  it("is empty (no rows, no errors) when nothing is unpushed anywhere", () => {
    const results: RepoFileTouches[] = [repoResult({ path: "/a" }), repoResult({ path: "/b" })];
    const grouped = groupFileTouches(["/a", "/b"], results);
    expect(grouped.multi).toHaveLength(0);
    expect(grouped.single).toHaveLength(0);
    expect(grouped.errors).toHaveLength(0);
    expect(grouped.isLoading).toBe(false);
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
