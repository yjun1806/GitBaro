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
  renamed: "text-info",
  copied: "text-info",
  untracked: "text-success",
  conflicted: "text-danger",
  ignored: "text-muted-foreground",
};

export const statusTooltips: Record<FileStatus, string> = {
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

/**
 * @deprecated 디자인 시스템은 색 칸 아이콘 대신 글자 하나(`FileStatusLetter`, `ui/marks.tsx`)를
 * 쓴다(D5). 아직 이것을 쓰는 화면(`graph/UnpushedRangeView`, `diff/DiffHeader`, `history/CommitDetail`,
 * `live/FollowPanel`, `pr/PrDetailPane` 등)이 `FileStatusLetter`로 옮겨가면 지운다.
 */
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
