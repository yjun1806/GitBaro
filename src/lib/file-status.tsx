import {
  Pencil,
  Plus,
  Minus,
  ArrowRight,
  Copy,
  EyeOff,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type { FileStatus } from "@/types";

export const statusColors: Record<FileStatus, string> = {
  modified: "text-warning bg-warning/10",
  added: "text-success bg-success/10",
  deleted: "text-danger bg-danger/10",
  renamed: "text-info bg-info/10",
  copied: "text-info bg-info/10",
  untracked: "text-muted-foreground bg-muted",
  ignored: "text-muted-foreground bg-surface",
  conflicted: "text-danger bg-danger/10",
};

export const statusTextColors: Record<FileStatus, string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-danger",
  renamed: "text-primary",
  copied: "text-primary",
  untracked: "text-success",
  conflicted: "text-danger",
  ignored: "text-muted-foreground",
};

const statusTooltips: Record<FileStatus, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  untracked: "Untracked",
  ignored: "Ignored",
  conflicted: "Conflicted",
};

export const statusIcons: Record<FileStatus, LucideIcon> = {
  modified: Pencil,
  added: Plus,
  deleted: Minus,
  renamed: ArrowRight,
  copied: Copy,
  untracked: Plus,
  ignored: EyeOff,
  conflicted: AlertTriangle,
};

interface FileStatusBadgeProps {
  status: FileStatus;
  size?: "sm" | "md";
  className?: string;
}

export function FileStatusBadge({ status, size = "sm", className }: FileStatusBadgeProps) {
  const Icon = statusIcons[status];
  const sizeClass = size === "md" ? "w-5 h-5" : "w-4 h-4";
  const iconSize = size === "md" ? 13 : 12;

  return (
    <span
      title={statusTooltips[status]}
      className={clsx(
        "flex items-center justify-center rounded shrink-0",
        sizeClass,
        statusColors[status],
        className,
      )}
    >
      <Icon size={iconSize} strokeWidth={2.5} />
    </span>
  );
}
