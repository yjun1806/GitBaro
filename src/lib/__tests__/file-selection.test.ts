import { describe, expect, it } from "vitest";
import {
  entryPaths,
  isSelectedEntry,
  resolveFileSelection,
  stageableEntries,
} from "@/lib/file-selection";
import type { StatusEntry } from "@/types";

function entry(path: string, staged: boolean, extra: Partial<StatusEntry> = {}): StatusEntry {
  return { path, staged, status: "modified", ...extra };
}

describe("file selection", () => {
  it("distinguishes the staged and unstaged rows of the same path", () => {
    const sel = { path: "a.ts", staged: false };
    expect(isSelectedEntry(entry("a.ts", false), sel)).toBe(true);
    expect(isSelectedEntry(entry("a.ts", true), sel)).toBe(false);
  });

  it("keeps a selection whose row still exists", () => {
    const sel = { path: "a.ts", staged: true };
    const entries = [entry("a.ts", true), entry("a.ts", false)];
    expect(resolveFileSelection(entries, sel)).toBe(sel);
  });

  it("follows a file to the other section after staging", () => {
    const sel = { path: "a.ts", staged: false };
    expect(resolveFileSelection([entry("a.ts", true)], sel)).toEqual({
      path: "a.ts",
      staged: true,
    });
  });

  it("clears the selection when the file disappears", () => {
    expect(resolveFileSelection([entry("b.ts", false)], { path: "a.ts", staged: true })).toBeNull();
  });

  it("sends both sides of a rename to git", () => {
    const renamed = entry("new.ts", true, { status: "renamed", origPath: "old.ts" });
    expect(entryPaths([renamed, entry("x.ts", true)])).toEqual(["new.ts", "old.ts", "x.ts"]);
  });

  it("leaves conflicted files out of stage all", () => {
    const entries = [entry("a.ts", false), entry("c.ts", false, { status: "conflicted" })];
    expect(stageableEntries(entries).map((e) => e.path)).toEqual(["a.ts"]);
  });
});
