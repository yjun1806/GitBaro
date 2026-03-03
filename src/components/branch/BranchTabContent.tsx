import { useState } from "react";
import { ArrowDownUp, ChevronRight, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { BranchGroup } from "./BranchGroup";
import { BranchRow } from "./BranchRow";
import { groupByPrefix } from "@/hooks/useBranchGroups";
import type { GroupedBranches, SortBy } from "@/hooks/useBranchGroups";
import type { BranchInfo, WorktreeInfo } from "@/types";

interface BranchTabContentProps {
  groups: GroupedBranches;
  currentBranch: string | null;
  activeIndex: number;
  sortBy: SortBy;
  worktreeByBranch?: Map<string, WorktreeInfo>;
  onSortChange: (sort: SortBy) => void;
  onSelect: (branch: BranchInfo) => void;
  onContextMenu: (branch: BranchInfo, e: React.MouseEvent) => void;
}

export function BranchTabContent({
  groups,
  currentBranch,
  activeIndex,
  sortBy,
  worktreeByBranch,
  onSortChange,
  onSelect,
  onContextMenu,
}: BranchTabContentProps) {
  const { t } = useTranslation();

  // Calculate flat index offsets for keyboard navigation
  let idx = 0;
  const defaultStart = idx;
  if (groups.default) idx += 1;

  const recentStart = idx;
  idx += groups.recent.length;

  const otherStart = idx;
  idx += groups.other.length;

  const remoteStart = idx;

  const isEmpty =
    !groups.default &&
    groups.recent.length === 0 &&
    groups.other.length === 0 &&
    groups.remoteOnly.length === 0;

  // Prefix grouping for "Other" section
  const otherGrouped = groupByPrefix(groups.other);
  const [collapsedPrefixes, setCollapsedPrefixes] = useState<Set<string>>(
    new Set(),
  );

  const togglePrefix = (prefix: string) => {
    setCollapsedPrefixes((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) {
        next.delete(prefix);
      } else {
        next.add(prefix);
      }
      return next;
    });
  };

  if (isEmpty) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("branch.noBranches")}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Default Branch */}
      {groups.default && (
        <BranchGroup
          label={t("branch.defaultBranch")}
          branches={[groups.default]}
          currentBranch={currentBranch}
          activeIndex={activeIndex}
          startIndex={defaultStart}
          worktreeByBranch={worktreeByBranch}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      )}

      {/* Recent Branches */}
      {groups.recent.length > 0 && (
        <div className={cn(groups.default && "border-t border-border")}>
          <BranchGroup
            label={t("branch.recentBranches")}
            branches={groups.recent}
            currentBranch={currentBranch}
            activeIndex={activeIndex}
            startIndex={recentStart}
            worktreeByBranch={worktreeByBranch}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        </div>
      )}

      {/* Other Branches */}
      {groups.other.length > 0 && (
        <div
          className={cn(
            (groups.default || groups.recent.length > 0) &&
              "border-t border-border",
          )}
        >
          <div className="flex items-center gap-2 px-3 pt-1.5 pb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
              {t("branch.otherBranches")}
            </p>
            <button
              onClick={() =>
                onSortChange(sortBy === "name" ? "recent" : "name")
              }
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
              title={
                sortBy === "name"
                  ? t("branch.sortByRecent")
                  : t("branch.sortByName")
              }
            >
              <ArrowDownUp className="w-3 h-3" />
              {sortBy === "name"
                ? t("branch.sortByName")
                : t("branch.sortByRecent")}
            </button>
          </div>

          {/* Unified sorted items (folders + ungrouped) */}
          {(() => {
            type OtherItem =
              | { type: "folder"; folder: (typeof otherGrouped.folders)[number] }
              | { type: "branch"; branch: BranchInfo };

            const items: OtherItem[] = [
              ...otherGrouped.folders.map(
                (folder) => ({ type: "folder" as const, folder }),
              ),
              ...otherGrouped.ungrouped.map(
                (branch) => ({ type: "branch" as const, branch }),
              ),
            ];

            const getSortKey = (item: OtherItem) => {
              if (sortBy === "recent") {
                if (item.type === "folder") {
                  return Math.max(
                    ...item.folder.branches.map((b) => b.lastCommitTime ?? 0),
                  );
                }
                return item.branch.lastCommitTime ?? 0;
              }
              return item.type === "folder"
                ? item.folder.prefix
                : item.branch.name;
            };

            const sorted =
              sortBy === "recent"
                ? [...items].sort(
                    (a, b) =>
                      (getSortKey(b) as number) - (getSortKey(a) as number),
                  )
                : [...items].sort((a, b) =>
                    (getSortKey(a) as string).localeCompare(
                      getSortKey(b) as string,
                    ),
                  );

            return sorted.map((item) => {
              if (item.type === "folder") {
                const { folder } = item;
                const isCollapsed = collapsedPrefixes.has(folder.prefix);
                return (
                  <div key={`folder:${folder.prefix}`} className="mt-0.5">
                    <button
                      onClick={() => togglePrefix(folder.prefix)}
                      className="w-full flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    >
                      <ChevronRight
                        className={cn(
                          "w-3 h-3 shrink-0 transition-transform",
                          !isCollapsed && "rotate-90",
                        )}
                      />
                      <Folder className="w-3 h-3 shrink-0" />
                      <span className="font-medium">{folder.prefix}/</span>
                      <span className="text-muted-foreground/50 tabular-nums">
                        {folder.branches.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="ml-3 border-l border-border/60">
                        {folder.branches.map((branch) => {
                          const flatIdx = groups.other.indexOf(branch);
                          return (
                            <BranchRow
                              key={branch.name}
                              branch={branch}
                              isCurrent={branch.name === currentBranch}
                              isActive={activeIndex === otherStart + flatIdx}
                              worktreeByBranch={worktreeByBranch}
                              onSelect={() => onSelect(branch)}
                              onContextMenu={(e) =>
                                onContextMenu(branch, e)
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const { branch } = item;
              const flatIdx = groups.other.indexOf(branch);
              return (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  isCurrent={branch.name === currentBranch}
                  isActive={activeIndex === otherStart + flatIdx}
                  worktreeByBranch={worktreeByBranch}
                  onSelect={() => onSelect(branch)}
                  onContextMenu={(e) => onContextMenu(branch, e)}
                />
              );
            });
          })()}
        </div>
      )}

      {/* Remote Branches */}
      {groups.remoteOnly.length > 0 && (
        <div className="border-t border-border">
          <BranchGroup
            label={t("branch.remote")}
            branches={groups.remoteOnly}
            currentBranch={currentBranch}
            activeIndex={activeIndex}
            startIndex={remoteStart}
            collapsible
            defaultCollapsed
            count={groups.remoteOnly.length}
            worktreeByBranch={worktreeByBranch}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        </div>
      )}
    </>
  );
}

/**
 * Calculate total number of visible branches for keyboard navigation.
 */
export function getFlatBranchCount(groups: GroupedBranches): number {
  let count = 0;
  if (groups.default) count += 1;
  count += groups.recent.length;
  count += groups.other.length;
  count += groups.remoteOnly.length;
  return count;
}

/**
 * Get a branch by its flat index.
 */
export function getBranchAtIndex(
  groups: GroupedBranches,
  index: number,
): BranchInfo | null {
  let idx = 0;

  if (groups.default) {
    if (index === idx) return groups.default;
    idx += 1;
  }

  for (const b of groups.recent) {
    if (index === idx) return b;
    idx += 1;
  }

  for (const b of groups.other) {
    if (index === idx) return b;
    idx += 1;
  }

  for (const b of groups.remoteOnly) {
    if (index === idx) return b;
    idx += 1;
  }

  return null;
}
