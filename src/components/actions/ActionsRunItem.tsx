import { CheckCircle, XCircle, Clock, Ban, SkipForward } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { WorkflowRun } from "@/types";
import { Spinner } from "@/components/ui/Spinner";
import { RefLabel } from "@/components/ui/marks";

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
    return <Spinner className="text-warning" />;
  }
  if (status === "queued" || status === "pending" || status === "waiting") {
    return <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  }
  switch (conclusion) {
    case "success":
      return <CheckCircle className="w-3.5 h-3.5 text-success shrink-0" />;
    case "failure":
      return <XCircle className="w-3.5 h-3.5 text-danger shrink-0" />;
    case "cancelled":
      return <Ban className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
    case "skipped":
      return <SkipForward className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
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
        "w-full min-h-11 flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-border select-none",
        isSelected
          ? "bg-(--acc-sel) font-semibold"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-inset ring-primary/30"
            : "hover:bg-accent",
      )}
    >
      <RunStatusIcon status={run.status} conclusion={run.conclusion} />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold truncate">{run.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11.5px] text-muted-foreground">
          <RefLabel name={run.headBranch} kind="local" className="max-w-[120px]" />
          <span className="shrink-0">{"\u00B7"}</span>
          <span className="shrink-0">#{run.runNumber}</span>
          <span className="shrink-0">{"\u00B7"}</span>
          <span className="shrink-0">{formatRelativeTime(createdTimestamp)}</span>
        </div>
      </div>
    </button>
  );
}
