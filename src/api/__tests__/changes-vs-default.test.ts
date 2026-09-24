import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getChangesVsDefault } from "@/api/commands";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("getChangesVsDefault", () => {
  it("calls the command once per repository path and returns the result as is", async () => {
    const file = {
      path: "a.txt",
      oldPath: null,
      status: "modified",
      additions: 1,
      deletions: 0,
      isBinary: false,
    };
    const result = {
      path: "/r/a",
      branch: "feat/x",
      headOid: "a".repeat(40),
      defaultBranch: "main",
      baseRef: "origin/main",
      baseStatus: "found",
      mergeBaseOid: "b".repeat(40),
      committed: [file],
      uncommitted: [],
      files: [file],
    };
    invokeMock.mockResolvedValueOnce(result);

    const out = await getChangesVsDefault("/r/a");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_changes_vs_default", { path: "/r/a" });
    expect(out).toEqual(result);
  });
});
