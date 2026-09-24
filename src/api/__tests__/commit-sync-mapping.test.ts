import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getCommitDetail, getCommitHistory, getRepoSyncStatus } from "@/api/commands";

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

describe("getRepoSyncStatus mapping", () => {
  it("returns dirtyCount and dirtyLatestMtime next to isDirty", async () => {
    const statuses = [
      {
        path: "/repo/a",
        branch: "main",
        ahead: 1,
        behind: 0,
        hasUpstream: true,
        isDirty: true,
        dirtyCount: 4,
        dirtyLatestMtime: 1_700_000_005_250,
      },
      {
        path: "/repo/b",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        isDirty: false,
        dirtyCount: 0,
        dirtyLatestMtime: null,
      },
    ];
    invokeMock.mockResolvedValueOnce(statuses);

    const result = await getRepoSyncStatus(["/repo/a", "/repo/b"]);

    expect(invokeMock).toHaveBeenCalledWith("repo_sync_status", {
      repoPaths: ["/repo/a", "/repo/b"],
    });
    expect(result).toEqual(statuses);
    expect(result[0].dirtyCount).toBe(4);
    expect(result[1].dirtyLatestMtime).toBeNull();
  });
});
