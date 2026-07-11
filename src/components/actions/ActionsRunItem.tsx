import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Ban,
  SkipForward,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { WorkflowRun } from "@/types";

interface ActionsRunItemProps {
  run: WorkflowRun;
  isSelected?: boolean;
  isHighlighted?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  ref?: React.Ref<HTMLButtonElement>;
}

function RunStatusIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === "in_progress") {
    return <Loader2 className="w-4 h-4 text-warning animate-spin shrink-0" />;
  }
  if (status === "queued" || status === "pending" || status === "waiting") {
    return <Clock className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
  switch (conclusion) {
    case "success":
      return <CheckCircle className="w-4 h-4 text-success shrink-0" />;
    case "failure":
      return <XCircle className="w-4 h-4 text-danger shrink-0" />;
    case "cancelled":
      return <Ban className="w-4 h-4 text-muted-foreground shrink-0" />;
    case "skipped":
      return <SkipForward className="w-4 h-4 text-muted-foreground shrink-0" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}

export function ActionsRunItem({
  run,
  isSelected,
  isHighlighted,
  onClick,
  onContextMenu,
  ref,
}: ActionsRunItemProps) {
  const createdTimestamp = Math.floor(new Date(run.createdAt).getTime() / 1000);

  return (
    <button
      ref={ref}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-border select-none",
        isSelected
          ? "bg-primary/10 text-primary font-semibold"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-primary/30"
            : "hover:bg-accent",
      )}
    >
      <RunStatusIcon status={run.status} conclusion={run.conclusion} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{run.name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full truncate max-w-[120px]",
              isSelected
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {run.headBranch}
          </span>
          <span
            className={cn(
              "text-xs shrink-0",
              isSelected ? "text-primary/50" : "text-muted-foreground",
            )}
          >
            {"\u00B7"}
          </span>
          <span
            className={cn(
              "text-xs shrink-0",
              isSelected ? "text-primary/70" : "text-muted-foreground",
            )}
          >
            #{run.runNumber}
          </span>
          <span
            className={cn(
              "text-xs shrink-0",
              isSelected ? "text-primary/50" : "text-muted-foreground",
            )}
          >
            {"\u00B7"}
          </span>
          <span
            className={cn(
              "text-xs shrink-0",
              isSelected ? "text-primary/70" : "text-muted-foreground",
            )}
          >
            {formatRelativeTime(createdTimestamp)}
          </span>
        </div>
      </div>
    </button>
  );
}
