import { describe, expect, it } from "vitest";
import { groupFilesByDirectory } from "@/lib/group-files";
import type { StatusEntry } from "@/types";

function makeEntry(path: string): StatusEntry {
  return {
    path,
    status: "modified",
    staged: false,
    insertions: 0,
    deletions: 0,
    sizeBytes: 100,
    lastModified: 1700000000,
  };
}

describe("groupFilesByDirectory", () => {
  it("groups files by parent directory correctly", () => {
    const entries = [
      makeEntry("src/components/App.tsx"),
      makeEntry("src/components/Button.tsx"),
      makeEntry("src/lib/utils.ts"),
    ];

    const groups = groupFilesByDirectory(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].directory).toBe("src/components");
    expect(groups[0].files).toHaveLength(2);
    expect(groups[1].directory).toBe("src/lib");
    expect(groups[1].files).toHaveLength(1);
  });

  it("groups root-level files under empty string key", () => {
    const entries = [makeEntry("README.md"), makeEntry("package.json")];

    const groups = groupFilesByDirectory(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].directory).toBe("");
    expect(groups[0].files).toHaveLength(2);
  });

  it("sorts groups alphabetically with root first, files within groups sorted alphabetically", () => {
    const entries = [
      makeEntry("src/lib/z-utils.ts"),
      makeEntry("README.md"),
      makeEntry("src/api/commands.ts"),
      makeEntry("src/lib/a-helpers.ts"),
    ];

    const groups = groupFilesByDirectory(entries);

    expect(groups[0].directory).toBe("");
    expect(groups[1].directory).toBe("src/api");
    expect(groups[2].directory).toBe("src/lib");
    expect(groups[2].files[0].path).toBe("src/lib/a-helpers.ts");
    expect(groups[2].files[1].path).toBe("src/lib/z-utils.ts");
  });

  it("returns empty array for empty input", () => {
    const groups = groupFilesByDirectory([]);
    expect(groups).toEqual([]);
  });

  it("handles single directory with multiple files", () => {
    const entries = [
      makeEntry("src/utils/b.ts"),
      makeEntry("src/utils/a.ts"),
      makeEntry("src/utils/c.ts"),
    ];

    const groups = groupFilesByDirectory(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].directory).toBe("src/utils");
    expect(groups[0].files.map((f) => f.path)).toEqual([
      "src/utils/a.ts",
      "src/utils/b.ts",
      "src/utils/c.ts",
    ]);
  });

  it("groups deeply nested paths by immediate parent", () => {
    const entries = [
      makeEntry("a/b/c/d/file1.ts"),
      makeEntry("a/b/c/d/file2.ts"),
      makeEntry("a/b/c/other.ts"),
    ];

    const groups = groupFilesByDirectory(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].directory).toBe("a/b/c");
    expect(groups[0].files).toHaveLength(1);
    expect(groups[1].directory).toBe("a/b/c/d");
    expect(groups[1].files).toHaveLength(2);
  });
});
