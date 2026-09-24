import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getCommitDetail, getCommitHistory, getRepoSyncStatus } from "@/api/commands";
import type { RepoSyncStatus } from "@/types";

const invokeMock = vi.mocked(invoke);

const MERGE = "a".repeat(40);
const LEFT = "b".repeat(40);
const RIGHT = "c".repeat(40);
const author = { name: "Dev", email: "dev@x.io", avatarUrl: "https://avatar" };
const claude = { name: "Claude", email: "noreply@anthropic.com" };

beforeEach(() => {
  invokeMock.mockReset();
});

describe("getCommitHistory mapping", () => {
  it("passes parent SHAs, co-authors and the agent guess through", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        oid: MERGE,
        message: "Merge side\n\nCo-authored-by: Claude <noreply@anthropic.com>",
        summary: "Merge side",
        author,
        timestamp: 1_700_000_000,
        parentCount: 2,
        parentIds: [LEFT, RIGHT],
        refs: [],
        isUnpushed: false,
        coAuthors: [claude],
        isAgentAuthored: true,
      },
    ]);

    const [commit] = await getCommitHistory("/repo", 10, 0);

    expect(invokeMock).toHaveBeenCalledWith("get_commit_history", {
      repoPath: "/repo",
      limit: 10,
      offset: 0,
    });
    expect(commit.id).toBe(MERGE);
    expect(commit.shortId).toBe(MERGE.slice(0, 7));
    expect(commit.parentIds).toEqual([LEFT, RIGHT]);
    expect(commit.coAuthors).toEqual([claude]);
    expect(commit.isAgentAuthored).toBe(true);
    expect(commit.isUnpushed).toBe(false);
  });

  it("keeps a root commit's empty parent list and a human commit unmarked", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        oid: LEFT,
        message: "init",
        summary: "init",
        author,
        timestamp: 1,
        parentCount: 0,
        parentIds: [],
        refs: [],
        isUnpushed: true,
        coAuthors: [],
        isAgentAuthored: false,
      },
    ]);

    const [commit] = await getCommitHistory("/repo");

    expect(commit.parentIds).toEqual([]);
    expect(commit.coAuthors).toEqual([]);
    expect(commit.isAgentAuthored).toBe(false);
  });
});

describe("getCommitDetail mapping", () => {
  it("fills the same co-author fields as the history list", async () => {
    invokeMock.mockResolvedValueOnce({
      oid: MERGE,
      message: "Merge side",
      summary: "Merge side",
      author,
      committer: author,
      timestamp: 1_700_000_000,
      parents: [LEFT, RIGHT],
      coAuthors: [claude],
      isAgentAuthored: true,
      diff: { filesChanged: 0, insertions: 0, deletions: 0, files: [] },
    });

    const { commit } = await getCommitDetail("/repo", MERGE);

    expect(commit.parentIds).toEqual([LEFT, RIGHT]);
    expect(commit.coAuthors).toEqual([claude]);
    expect(commit.isAgentAuthored).toBe(true);
  });
});

// getRepoSyncStatus passes the backend response through unchanged, so there is
// no runtime mapping to check. What can break is the call itself and the
// declared type. The field names on the wire are checked by the Rust test
// `reports_dirty_count_and_latest_mtime` (commands/branch.rs); this file is
// type-checked by `pnpm typecheck`, so the `satisfies` and `expectTypeOf`
// lines below fail the build if the type loses or retypes a field.
describe("getRepoSyncStatus contract", () => {
  it("calls repo_sync_status with the repo paths", async () => {
    invokeMock.mockResolvedValueOnce([]);

    await getRepoSyncStatus(["/repo/a", "/repo/b"]);

    expect(invokeMock).toHaveBeenCalledWith("repo_sync_status", {
      repoPaths: ["/repo/a", "/repo/b"],
    });
  });

  it("declares dirtyCount and dirtyLatestMtime next to isDirty", () => {
    const dirty = {
      path: "/repo/a",
      branch: "main",
      ahead: 1,
      behind: 0,
      hasUpstream: true,
      unpushed: 1,
      isDirty: true,
      dirtyCount: 4,
      dirtyLatestMtime: 1_700_000_005_250,
    } satisfies RepoSyncStatus;
    const clean = { ...dirty, isDirty: false, dirtyCount: 0, dirtyLatestMtime: null } satisfies RepoSyncStatus;

    expectTypeOf<RepoSyncStatus["dirtyCount"]>().toEqualTypeOf<number>();
    expectTypeOf<RepoSyncStatus["dirtyLatestMtime"]>().toEqualTypeOf<number | null>();
    expectTypeOf<RepoSyncStatus["isDirty"]>().toEqualTypeOf<boolean>();
    expect([dirty.dirtyCount, clean.dirtyLatestMtime]).toEqual([4, null]);
  });
});
