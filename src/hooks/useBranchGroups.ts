import { useMemo } from "react";
import type { BranchInfo } from "@/types";
import { fuzzyFilter } from "@/lib/fuzzy-search";

export type SortBy = "name" | "recent";

export interface GroupedBranches {
  default: BranchInfo | null;
  recent: BranchInfo[];
  other: BranchInfo[];
  remoteOnly: BranchInfo[];
}

interface FolderGroup {
  prefix: string;
  branches: BranchInfo[];
}

export interface OtherBranchesGrouped {
  folders: FolderGroup[];
  ungrouped: BranchInfo[];
}

const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60; // 3 months in seconds

export function isStale(branch: BranchInfo): boolean {
  if (branch.isFullyMerged) return false;
  if (branch.lastCommitTime == null) return false;
  const now = Math.floor(Date.now() / 1000);
  return now - branch.lastCommitTime > STALE_THRESHOLD_MS;
}

export function useBranchGroups(
  branches: BranchInfo[],
  recentNames: string[],
  query: string,
  sortBy: SortBy,
): GroupedBranches {
  return useMemo(() => {
    // Track which remotes are tracked by local branches
    const trackedRemotes = new Set(
      branches
        .filter((b) => !b.isRemote && b.upstream)
        .map((b) => b.upstream!),
    );

    // Apply fuzzy filter
    const filtered = query.length > 0
      ? fuzzyFilter(branches, query, (b) => b.name)
      : branches;

    const defaultBranch = filtered.find((b) => !b.isRemote && b.isDefault) ?? null;

    const localNonDefault = filtered.filter(
      (b) => !b.isRemote && !b.isDefault,
    );

    // Recent: branches from reflog (order preserved), max 5
    const recent = recentNames
      .filter((name) => localNonDefault.some((b) => b.name === name))
      .slice(0, 5)
      .map((name) => localNonDefault.find((b) => b.name === name)!)
      .filter(Boolean);

    // Other: everything not in default or recent
    const recentNameSet = new Set(recent.map((b) => b.name));
    let other = localNonDefault.filter((b) => !recentNameSet.has(b.name));

    // Sort "other" branches
    if (sortBy === "name") {
      other = [...other].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      other = [...other].sort((a, b) => {
        const ta = a.lastCommitTime ?? 0;
        const tb = b.lastCommitTime ?? 0;
        return tb - ta;
      });
    }

    // Remote-only: remotes without local tracking branch
    const remoteOnly = filtered.filter(
      (b) => b.isRemote && !trackedRemotes.has(b.name),
    );

    return { default: defaultBranch, recent, other, remoteOnly };
  }, [branches, recentNames, query, sortBy]);
}

/**
 * Group branches by prefix (e.g., "feature/", "bugfix/").
 * Only groups prefixes with 2+ branches.
 */
export function groupByPrefix(branches: BranchInfo[]): OtherBranchesGrouped {
  const prefixMap = new Map<string, BranchInfo[]>();
  const ungrouped: BranchInfo[] = [];

  for (const branch of branches) {
    const slashIndex = branch.name.indexOf("/");
    if (slashIndex > 0) {
      const prefix = branch.name.slice(0, slashIndex);
      const existing = prefixMap.get(prefix) ?? [];
      prefixMap.set(prefix, [...existing, branch]);
    } else {
      ungrouped.push(branch);
    }
  }

  const folders: FolderGroup[] = [];
  for (const [prefix, items] of prefixMap) {
    if (items.length >= 2) {
      folders.push({ prefix, branches: items });
    } else {
      ungrouped.push(...items);
    }
  }

  // Preserve input order — folder order follows the sort applied by useBranchGroups
  // (alphabetical for "name", chronological for "recent")

  return { folders, ungrouped };
}
