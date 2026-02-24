import type { ReactNode } from "react";
import { GitPullRequest, GitMerge, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

type PrStatus = "open" | "merged" | "closed";

interface PrStatusBadgeProps {
  status: PrStatus;
  className?: string;
}

const config: Record<
  PrStatus,
  { labelKey: string; icon: ReactNode; classes: string }
> = {
  open: {
    labelKey: "pr.open",
    icon: <GitPullRequest className="w-3 h-3" />,
    classes: "bg-success/10 text-success border-success/30",
  },
  merged: {
    labelKey: "pr.merged",
    icon: <GitMerge className="w-3 h-3" />,
    classes: "bg-info/10 text-info border-info/30",
  },
  closed: {
    labelKey: "pr.closed",
    icon: <XCircle className="w-3 h-3" />,
    classes: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

export function PrStatusBadge({ status, className }: PrStatusBadgeProps) {
  const { t } = useTranslation();
  const { labelKey, icon, classes } = config[status];

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border",
        classes,
        className
      )}
    >
      {icon}
      {t(labelKey)}
    </span>
  );
}
