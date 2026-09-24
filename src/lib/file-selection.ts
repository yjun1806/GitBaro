import type { StatusEntry } from "@/types";

export interface FileSelection {
  path: string;
  staged: boolean;
}

/** Whether `entry` is the selected row. A path can appear in both sections. */
export function isSelectedEntry(entry: StatusEntry, selection: FileSelection | null): boolean {
  return selection !== null && entry.path === selection.path && entry.staged === selection.staged;
}

/**
 * Re-resolve a file selection against a fresh status list.
 *
 * - The same (path, staged) row still exists → keep it.
 * - Only the other section has the path (it was just staged or unstaged)
 *   → follow the file there.
 * - The path is gone (committed, discarded) → `null`.
 */
export function resolveFileSelection(
  entries: StatusEntry[],
  selection: FileSelection | null,
): FileSelection | null {
  if (!selection) return null;
  if (entries.some((e) => isSelectedEntry(e, selection))) return selection;
  const moved = entries.find((e) => e.path === selection.path);
  return moved ? { path: moved.path, staged: moved.staged } : null;
}

/**
 * Paths git must receive to stage/unstage/discard `entries`. A rename is two
 * index entries (the new path and the removed old path), so both are sent.
 */
export function entryPaths(entries: StatusEntry[]): string[] {
  const paths = new Set<string>();
  for (const e of entries) {
    paths.add(e.path);
    if (e.origPath) paths.add(e.origPath);
  }
  return [...paths];
}

/** Entries "Stage all" may stage: conflicted files must be resolved one by one. */
export function stageableEntries(entries: StatusEntry[]): StatusEntry[] {
  return entries.filter((e) => e.status !== "conflicted");
}
