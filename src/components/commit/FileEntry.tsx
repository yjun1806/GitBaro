import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { FileStatusLetter } from "@/components/ui/marks";
import type { FileStatus } from "@/types";

export interface FileEntryProps {
  entry: {
    path: string;
    origPath?: string | null;
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
  /** Discard this row's changes (unstaged row: working tree only; staged row: back to HEAD). */
  onDiscard?: () => void;
  ref?: React.Ref<HTMLDivElement>;
}

function baseName(path: string): string {
  return path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
}

function dirName(path: string): string {
  return path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
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
  const filename = baseName(entry.path);
  // Rename: show "old → new". Keep the old directory when the file moved folders.
  const previousName = entry.origPath
    ? dirName(entry.origPath) === dirName(entry.path)
      ? baseName(entry.origPath)
      : entry.origPath
    : null;

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
        "group flex items-center gap-2 px-3 h-7 cursor-pointer transition-colors select-none border-b border-border",
        isSelected
          ? "bg-(--acc-sel)"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-inset ring-primary/30"
            : "hover:bg-accent",
      )}
    >
      <input
        type="checkbox"
        className="w-3.5 h-3.5 shrink-0 cursor-pointer"
        checked={entry.staged}
        aria-label={t(entry.staged ? "changes.checkbox.unstageFile" : "changes.checkbox.stageFile", { file: entry.path })}
        onChange={(e) => {
          e.stopPropagation();
          onToggleStage();
        }}
      />
      <FileStatusLetter status={entry.status as FileStatus} />
      <span
        className="text-[12.5px] font-medium text-foreground truncate"
        title={entry.origPath ? `${entry.origPath} → ${entry.path}` : undefined}
      >
        {previousName && <span className="text-muted-foreground">{previousName} → </span>}
        {filename}
      </span>
      {(entry.insertions != null || entry.deletions != null) && (
        <span className="font-mono text-[11.5px] shrink-0">
          {entry.insertions != null && <span className="text-diff-add-fg">+{entry.insertions}</span>}
          {entry.insertions != null && entry.deletions != null && <span className="text-muted-foreground"> </span>}
          {entry.deletions != null && <span className="text-diff-del-fg">{"−"}{entry.deletions}</span>}
        </span>
      )}
      <span className="flex-1" />
      {entry.modifiedAt != null && (
        <span className="text-[11.5px] text-muted-foreground shrink-0">{formatRelativeTime(entry.modifiedAt)}</span>
      )}
      {onDiscard && (
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          tone="danger"
          title={t("changes.discard")}
          aria-label={t("changes.discard")}
          onClick={(e) => {
            e.stopPropagation();
            onDiscard();
          }}
          className="opacity-0 group-hover:opacity-100"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

export const FileEntry = memo(FileEntryComponent);
