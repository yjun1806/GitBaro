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
    classes: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800",
  },
  merged: {
    label: "Merged",
    icon: <GitMerge className="w-3 h-3" />,
    classes: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  },
  closed: {
    label: "Closed",
    icon: <XCircle className="w-3 h-3" />,
    classes: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
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
