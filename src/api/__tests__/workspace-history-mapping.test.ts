import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getWorkspaceHistory } from "@/api/commands";

const invokeMock = vi.mocked(invoke);

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const sig = { name: "Dev", email: "dev@x.io", timestamp: 1_700_000_000 };

beforeEach(() => {
  invokeMock.mockReset();
});

describe("getWorkspaceHistory mapping", () => {
  it("passes paths and limit, keeps repos separate and maps commits to CommitInfo", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        path: "/r/a",
        branch: "feat/x",
        headOid: HEAD,
        defaultBranch: "main",
        baseRef: "main",
        baseStatus: "found",
        mergeBaseOid: BASE,
        mergeBaseCommit: {
          id: BASE,
          shortId: BASE.slice(0, 8),
          message: "base",
          summary: "base",
          author: sig,
          committer: sig,
          timestamp: 1_699_000_000,
          parentIds: [],
          refs: [{ name: "main", kind: "localBranch", isHead: false }],
          coAuthors: [],
          isAgentAuthored: false,
        },
        commits: [
          {
            id: HEAD,
            shortId: HEAD.slice(0, 8),
            message: "feat",
            summary: "feat",
            author: sig,
            committer: sig,
            timestamp: 1_700_000_000,
            parentIds: [BASE],
            refs: [{ name: "feat/x", kind: "localBranch", isHead: true }],
            coAuthors: [],
            isAgentAuthored: false,
          },
        ],
        truncated: false,
        unpushedOids: [HEAD],
        error: null,
      },
      {
        path: "/r/b",
        branch: null,
        headOid: null,
        defaultBranch: null,
        baseRef: null,
        baseStatus: null,
        mergeBaseOid: null,
        mergeBaseCommit: null,
        commits: [],
        truncated: false,
        unpushedOids: [],
        error: "could not find repository",
      },
    ]);

    const out = await getWorkspaceHistory(["/r/a", "/r/b"], 50);

    expect(invokeMock).toHaveBeenCalledWith("get_workspace_history", {
      paths: ["/r/a", "/r/b"],
      limitPerRepo: 50,
    });
    expect(out.map((r) => r.path)).toEqual(["/r/a", "/r/b"]);
    expect(out[0].commits[0]).toMatchObject({
      id: HEAD,
      shortId: HEAD.slice(0, 7),
      parentIds: [BASE],
      author: { name: "Dev", email: "dev@x.io" },
      committer: { name: "Dev", email: "dev@x.io" },
    });
    expect(out[0].commits[0].author).not.toHaveProperty("timestamp");
    expect(out[0].mergeBaseOid).toBe(BASE);
    expect(out[0].baseStatus).toBe("found");
    expect(out[0].unpushedOids).toEqual([HEAD]);
    expect(out[0].mergeBaseCommit).toMatchObject({
      id: BASE,
      shortId: BASE.slice(0, 7),
      timestamp: 1_699_000_000,
      author: { name: "Dev", email: "dev@x.io" },
    });
    expect(out[0].mergeBaseCommit?.author).not.toHaveProperty("timestamp");
    expect(out[1].mergeBaseCommit).toBeNull();
    expect(out[1].error).toBe("could not find repository");
    expect(out[1].commits).toEqual([]);
  });
});
