import { GitBranch, Check, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, formatRelativeTime } from "@/lib/utils";
import { BranchStatusDot } from "./BranchStatusDot";
import { BranchStatusBadge } from "./BranchStatusBadge";
import type { BranchInfo, WorktreeInfo } from "@/types";

interface BranchRowProps {
  branch: BranchInfo;
  isCurrent: boolean;
  isActive?: boolean;
  worktreeByBranch?: Map<string, WorktreeInfo>;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function BranchRow({
  branch,
  isCurrent,
  isActive,
  worktreeByBranch,
  onSelect,
  onContextMenu,
}: BranchRowProps) {
  const { t } = useTranslation();
  const hasAheadBehind =
    branch.aheadBehind &&
    (branch.aheadBehind.ahead > 0 || branch.aheadBehind.behind > 0);

  return (
    <button
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e);
      }}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors group",
        isCurrent
          ? "bg-primary/8 text-primary"
          : isActive
            ? "bg-accent"
            : "hover:bg-accent",
      )}
    >
      <BranchStatusDot branch={branch} />
      <GitBranch
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          isCurrent ? "text-primary" : "text-muted-foreground",
        )}
      />

      <div className="flex-1 min-w-0 text-left">
        <span className="truncate block">{branch.name}</span>
        {branch.lastCommitAuthor && !branch.isRemote && (
          <span className="text-[11px] text-muted-foreground truncate block">
            {t("branch.commitByAuthor", { name: branch.lastCommitAuthor.name })}
          </span>
        )}
      </div>

      <BranchStatusBadge branch={branch} />

      {hasAheadBehind && (
        <span className="flex items-center gap-1.5 text-xs tabular-nums shrink-0">
          {branch.aheadBehind!.ahead > 0 && (
            <span className="text-primary font-medium">
              {"\u2191"}
              {branch.aheadBehind!.ahead}
            </span>
          )}
          {branch.aheadBehind!.behind > 0 && (
            <span className="text-danger font-medium">
              {"\u2193"}
              {branch.aheadBehind!.behind}
            </span>
          )}
        </span>
      )}

      {branch.lastCommitTime != null && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(branch.lastCommitTime)}
        </span>
      )}

      {worktreeByBranch?.has(branch.name) && (
        <FolderGit2 className="w-3.5 h-3.5 text-info shrink-0" />
      )}
      {isCurrent && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
    </button>
  );
}
