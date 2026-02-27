import { CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/types";

type SyncStatus = "ahead" | "behind" | "diverged" | "synced" | "unpublished";

function getSyncStatus(branch: BranchInfo): SyncStatus {
  if (!branch.upstream) return "unpublished";
  if (!branch.aheadBehind) return "synced";

  const { ahead, behind } = branch.aheadBehind;
  if (ahead > 0 && behind > 0) return "diverged";
  if (ahead > 0) return "ahead";
  if (behind > 0) return "behind";
  return "synced";
}

const dotStyles: Record<SyncStatus, string> = {
  ahead: "bg-primary",
  behind: "bg-danger",
  diverged: "bg-warning",
  synced: "",
  unpublished: "bg-muted-foreground/40",
};

interface BranchStatusDotProps {
  branch: BranchInfo;
  className?: string;
}

export function BranchStatusDot({ branch, className }: BranchStatusDotProps) {
  if (branch.isRemote) return null;

  const status = getSyncStatus(branch);
  if (status === "synced") return null;

  if (status === "unpublished") {
    return (
      <span className={cn("shrink-0", className)} title={status}>
        <CloudOff className="w-3 h-3 text-muted-foreground/50" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "w-2 h-2 shrink-0 rounded-full",
        dotStyles[status],
        className,
      )}
      title={status}
    />
  );
}
