import { ArrowDownUp, ChevronRight, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { BranchGroup } from "./BranchGroup";
import { BranchRow } from "./BranchRow";
import type { GroupedBranches, SortBy } from "@/hooks/useBranchGroups";
import { sortOtherItems } from "./visible-branches";
import type { BranchInfo, WorktreeInfo } from "@/types";

interface BranchTabContentProps {
  groups: GroupedBranches;
  currentBranch: string | null;
  /** Name of the keyboard-highlighted branch, if any. */
  activeName: string | null;
  sortBy: SortBy;
  collapsedPrefixes: ReadonlySet<string>;
  remoteCollapsed: boolean;
  onTogglePrefix: (prefix: string) => void;
  onToggleRemote: () => void;
  worktreeByBranch?: Map<string, WorktreeInfo>;
  onSortChange: (sort: SortBy) => void;
  onSelect: (branch: BranchInfo) => void;
  onContextMenu: (branch: BranchInfo, e: React.MouseEvent) => void;
}

export function BranchTabContent({
  groups,
  currentBranch,
  activeName,
  sortBy,
  collapsedPrefixes,
  remoteCollapsed,
  onTogglePrefix,
  onToggleRemote,
  worktreeByBranch,
  onSortChange,
  onSelect,
  onContextMenu,
}: BranchTabContentProps) {
  const { t } = useTranslation();

  const isEmpty =
    !groups.default &&
    groups.recent.length === 0 &&
    groups.other.length === 0 &&
    groups.remoteOnly.length === 0;

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
          activeName={activeName}
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
            activeName={activeName}
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
          {sortOtherItems(groups.other, sortBy).map((item) => {
            if (item.type === "folder") {
              const { folder } = item;
              const isCollapsed = collapsedPrefixes.has(folder.prefix);
              return (
                <div key={`folder:${folder.prefix}`} className="mt-0.5">
                  <button
                    onClick={() => onTogglePrefix(folder.prefix)}
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
                      {folder.branches.map((branch) => (
                        <BranchRow
                          key={branch.name}
                          branch={branch}
                          isCurrent={branch.name === currentBranch}
                          isActive={branch.name === activeName}
                          worktreeByBranch={worktreeByBranch}
                          onSelect={() => onSelect(branch)}
                          onContextMenu={(e) => onContextMenu(branch, e)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            const { branch } = item;
            return (
              <BranchRow
                key={branch.name}
                branch={branch}
                isCurrent={branch.name === currentBranch}
                isActive={branch.name === activeName}
                worktreeByBranch={worktreeByBranch}
                onSelect={() => onSelect(branch)}
                onContextMenu={(e) => onContextMenu(branch, e)}
              />
            );
          })}
        </div>
      )}

      {/* Remote Branches */}
      {groups.remoteOnly.length > 0 && (
        <div className="border-t border-border">
          <BranchGroup
            label={t("branch.remote")}
            branches={groups.remoteOnly}
            currentBranch={currentBranch}
            activeName={activeName}
            collapsed={remoteCollapsed}
            onToggleCollapsed={onToggleRemote}
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
