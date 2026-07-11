import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { FileStatusBadge } from "@/lib/file-status";
import type { FileStatus } from "@/types";

export interface FileEntryProps {
  entry: {
    path: string;
    status: string;
    staged: boolean;
    insertions?: number | null;
    deletions?: number | null;
    modifiedAt?: number | null;
  };
  isSelected: boolean;
  isHighlighted?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onToggleStage: () => void;
  /** Discard working-tree changes for this file (unstaged files only). */
  onDiscard?: () => void;
  ref?: React.Ref<HTMLDivElement>;
}

function FileEntryComponent({
  entry,
  isSelected,
  isHighlighted,
  onClick,
  onDoubleClick,
  onContextMenu,
  onToggleStage,
  onDiscard,
  ref,
}: FileEntryProps) {
  const { t } = useTranslation();
  const filename = entry.path.includes("/")
    ? entry.path.substring(entry.path.lastIndexOf("/") + 1)
    : entry.path;

  return (
    <div
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors select-none border-b border-border",
        isSelected
          ? "bg-primary/10 text-primary font-semibold"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-primary/30"
            : "hover:bg-accent",
      )}
    >
      <input
        type="checkbox"
        className="w-3.5 h-3.5 shrink-0 cursor-pointer"
        checked={entry.staged}
        onChange={(e) => {
          e.stopPropagation();
          onToggleStage();
        }}
      />
      <FileStatusBadge status={entry.status as FileStatus} />
      <span className="text-xs font-medium text-foreground truncate">{filename}</span>
      {(entry.insertions != null || entry.deletions != null) && (
        <span className="text-xs shrink-0">
          {entry.insertions != null && <span className="text-success">+{entry.insertions}</span>}
          {entry.insertions != null && entry.deletions != null && <span className="text-muted-foreground"> </span>}
          {entry.deletions != null && <span className="text-danger">-{entry.deletions}</span>}
        </span>
      )}
      <span className="flex-1" />
      {entry.modifiedAt != null && (
        <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(entry.modifiedAt)}</span>
      )}
      {onDiscard && (
        <button
          type="button"
          title={t("changes.discard")}
          aria-label={t("changes.discard")}
          onClick={(e) => {
            e.stopPropagation();
            onDiscard();
          }}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export const FileEntry = memo(FileEntryComponent);
