import { GitBranch, CloudOff, Check } from "lucide-react";
import { WorktreeIcon } from "@/components/ui/WorktreeIcon";
import { Tooltip } from "@/components/ui/Tooltip";
import { useTranslation } from "react-i18next";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useAvatarResolver } from "@/hooks/use-avatar-resolver";
import { BranchStatusBadge } from "./BranchStatusBadge";
import type { BranchInfo, WorktreeInfo } from "@/types";

/** Author avatar for the last commit — image with an initials fallback. */
function AuthorAvatar({ name, url }: { name: string; url?: string }) {
  const label = name || "?";
  if (url) {
    return (
      <img
        src={url}
        alt={label}
        className="w-3.5 h-3.5 rounded-full shrink-0 object-cover"
      />
    );
  }
  return (
    <div className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold bg-primary/10 text-primary">
      {label[0].toUpperCase()}
    </div>
  );
}

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
  const resolveAvatarUrl = useAvatarResolver();
  const hasAheadBehind =
    branch.aheadBehind &&
    (branch.aheadBehind.ahead > 0 || branch.aheadBehind.behind > 0);
  const isUnpublished = !branch.isRemote && !branch.upstream;

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
      {/* Fixed leading anchor: same size and position on every row so branch
          names share one left edge. Status lives in the trailing zone below. */}
      <GitBranch
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          isCurrent ? "text-primary" : "text-muted-foreground",
        )}
      />

      <span className="flex-1 min-w-0 truncate text-left">{branch.name}</span>

      {/* Trailing metadata zone: author \u2192 badge \u2192 sync \u2192 time \u2192 worktree \u2192 current */}
      {branch.lastCommitAuthor && (
        <Tooltip label={branch.lastCommitAuthor.name || "?"}>
          <AuthorAvatar
            name={branch.lastCommitAuthor.name}
            url={resolveAvatarUrl(branch.lastCommitAuthor.email)}
          />
        </Tooltip>
      )}

      <BranchStatusBadge branch={branch} />

      {hasAheadBehind ? (
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
      ) : (
        isUnpublished && (
          <CloudOff
            className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50"
            aria-label={t("branch.unpublished")}
          />
        )
      )}

      {branch.lastCommitTime != null && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(branch.lastCommitTime)}
        </span>
      )}

      {worktreeByBranch?.has(branch.name) && (
        <WorktreeIcon className="w-3.5 h-3.5" />
      )}
      {isCurrent && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
    </button>
  );
}
