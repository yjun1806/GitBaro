import { groupByPrefix } from "@/hooks/useBranchGroups";
import type { GroupedBranches, OtherBranchesGrouped, SortBy } from "@/hooks/useBranchGroups";
import type { BranchInfo } from "@/types";

export type OtherItem =
  | { type: "folder"; folder: OtherBranchesGrouped["folders"][number] }
  | { type: "branch"; branch: BranchInfo };

/** The "Other" section's rows in display order: prefix folders mixed with ungrouped branches. */
export function sortOtherItems(other: BranchInfo[], sortBy: SortBy): OtherItem[] {
  const grouped = groupByPrefix(other);
  const items: OtherItem[] = [
    ...grouped.folders.map((folder) => ({ type: "folder" as const, folder })),
    ...grouped.ungrouped.map((branch) => ({ type: "branch" as const, branch })),
  ];

  if (sortBy === "recent") {
    const time = (item: OtherItem) =>
      item.type === "folder"
        ? Math.max(...item.folder.branches.map((b) => b.lastCommitTime ?? 0))
        : (item.branch.lastCommitTime ?? 0);
    return [...items].sort((a, b) => time(b) - time(a));
  }
  const name = (item: OtherItem) => (item.type === "folder" ? item.folder.prefix : item.branch.name);
  return [...items].sort((a, b) => name(a).localeCompare(name(b)));
}

export interface BranchListCollapse {
  collapsedPrefixes: ReadonlySet<string>;
  remoteCollapsed: boolean;
}

/**
 * Branches in the order their rows are rendered, skipping those hidden inside
 * a collapsed folder or the collapsed remote group. Keyboard navigation moves
 * over exactly this list.
 */
export function getVisibleBranches(
  groups: GroupedBranches,
  sortBy: SortBy,
  { collapsedPrefixes, remoteCollapsed }: BranchListCollapse,
): BranchInfo[] {
  const other = sortOtherItems(groups.other, sortBy).flatMap((item) => {
    if (item.type === "branch") return [item.branch];
    return collapsedPrefixes.has(item.folder.prefix) ? [] : item.folder.branches;
  });
  return [
    ...(groups.default ? [groups.default] : []),
    ...groups.recent,
    ...other,
    ...(remoteCollapsed ? [] : groups.remoteOnly),
  ];
}

/** Next highlighted branch name for an arrow key, wrapping at both ends. */
export function nextActiveName(
  visibleNames: string[],
  activeName: string | null,
  direction: "up" | "down",
): string | null {
  const total = visibleNames.length;
  if (total === 0) return null;
  const current = activeName === null ? -1 : visibleNames.indexOf(activeName);
  if (current < 0) return direction === "down" ? visibleNames[0] : visibleNames[total - 1];
  const next = direction === "down" ? (current + 1) % total : (current - 1 + total) % total;
  return visibleNames[next];
}
