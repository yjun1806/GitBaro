import type { ReactNode } from "react";
import { GitPullRequest, GitMerge, XCircle } from "lucide-react";
import clsx from "clsx";

type PrStatus = "open" | "merged" | "closed";

interface PrStatusBadgeProps {
  status: PrStatus;
  className?: string;
}

const config: Record<
  PrStatus,
  { label: string; icon: ReactNode; classes: string }
> = {
  open: {
    label: "Open",
    icon: <GitPullRequest className="w-3 h-3" />,
    classes: "bg-success/10 text-success border-success/30",
  },
  merged: {
    label: "Merged",
    icon: <GitMerge className="w-3 h-3" />,
    classes: "bg-info/10 text-info border-info/30",
  },
  closed: {
    label: "Closed",
    icon: <XCircle className="w-3 h-3" />,
    classes: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

export function PrStatusBadge({ status, className }: PrStatusBadgeProps) {
  const { label, icon, classes } = config[status];

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border",
        classes,
        className
      )}
    >
      {icon}
      {label}
    </span>
  );
}
