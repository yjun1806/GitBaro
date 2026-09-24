import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getChangesVsDefault, getFileDiffVsDefault } from "@/api/commands";
import type { BranchChangedFile, BranchChanges } from "@/types";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("getChangesVsDefault", () => {
  it("sends the repository path to get_changes_vs_default", async () => {
    // `satisfies` makes typecheck fail if the TS type drifts from this fixture.
    // The Rust test `serialized_shape_matches_the_typescript_types` pins the same keys.
    const file = {
      path: "a.txt",
      oldPath: null,
      status: "modified",
      additions: 1,
      deletions: 0,
      isBinary: false,
    } satisfies BranchChangedFile;
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
    } satisfies BranchChanges;
    invokeMock.mockResolvedValueOnce(result);

    await getChangesVsDefault("/r/a");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_changes_vs_default", { path: "/r/a" });
  });
});

describe("getFileDiffVsDefault", () => {
  const raw = {
    filePath: "src/new.ts",
    oldPath: "src/old.ts",
    binary: false,
    insertions: 2,
    deletions: 1,
    oldContent: "a\nb\n",
    newContent: "a\nc\nd\n",
    baseOid: "c".repeat(40),
    baseIsDivergencePoint: true,
    hunks: [
      {
        header: "@@ -1,2 +1,3 @@\n",
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: "context", content: "a\n", oldLineNo: 1, newLineNo: 1 },
          { kind: "deletion", content: "b\n", oldLineNo: 2, newLineNo: null },
          { kind: "addition", content: "c\n", oldLineNo: null, newLineNo: 2 },
          { kind: "addition", content: "d\n", oldLineNo: null, newLineNo: 3 },
        ],
      },
    ],
  };

  it("passes the old path of a renamed file and maps line kinds and hunk sizes", async () => {
    invokeMock.mockResolvedValueOnce(raw);

    const out = await getFileDiffVsDefault("/r/a", "src/new.ts", "src/old.ts");

    expect(invokeMock).toHaveBeenCalledWith("get_file_diff_vs_default", {
      path: "/r/a",
      filePath: "src/new.ts",
      oldPath: "src/old.ts",
    });
    expect(out.oldPath).toBe("src/old.ts");
    expect(out.baseIsDivergencePoint).toBe(true);
    const [hunk] = out.hunks;
    expect(hunk.oldLines).toBe(2);
    expect(hunk.newLines).toBe(3);
    expect(hunk.lines.map((l) => l.lineType)).toEqual(["context", "delete", "add", "add"]);
    expect(hunk.lines[2]).toEqual({ content: "c\n", lineType: "add", oldLineNo: null, newLineNo: 2 });
  });

  it("sends a null old path when the file was not renamed", async () => {
    invokeMock.mockResolvedValueOnce({ ...raw, oldPath: null });

    await getFileDiffVsDefault("/r/a", "src/new.ts");

    expect(invokeMock).toHaveBeenCalledWith("get_file_diff_vs_default", {
      path: "/r/a",
      filePath: "src/new.ts",
      oldPath: null,
    });
  });
});
