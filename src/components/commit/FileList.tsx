import { useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { FileStatusBadge } from "@/lib/file-status";
import type { StatusEntry } from "@/types";

interface FileListProps {
  files: StatusEntry[];
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onSelectFile?: (path: string) => void;
  selectedPath?: string;
}


interface ContextMenuState {
  x: number;
  y: number;
  file: StatusEntry;
}

export function FileList({
  files,
  onStage,
  onUnstage,
  onDiscard,
  onStageAll,
  onUnstageAll,
  onSelectFile,
  selectedPath,
}: FileListProps) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged);

  const handleContextMenu = (e: React.MouseEvent, file: StatusEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const closeContextMenu = () => setContextMenu(null);

  return (
    <div className="flex flex-col h-full min-h-0" onClick={closeContextMenu}>
      {/* Staged files */}
      {staged.length > 0 && (
        <div className="flex flex-col min-h-0 max-h-[50%] shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-border shrink-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("commit.stagedChanges")} ({staged.length})
            </span>
            <button
              onClick={onUnstageAll}
              className="text-xs text-primary hover:text-primary transition-colors"
            >
              {t("changes.unstageAll")}
            </button>
          </div>
          <div className="overflow-y-auto flex-1 min-h-0">
            {staged.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                isSelected={file.path === selectedPath}
                onToggle={() => onUnstage(file.path)}
                onClick={() => onSelectFile?.(file.path)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unstaged files */}
      {unstaged.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-border shrink-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("commit.unstaged")} ({unstaged.length})
            </span>
            <button
              onClick={onStageAll}
              className="text-xs text-primary hover:text-primary transition-colors"
            >
              {t("changes.stageAll")}
            </button>
          </div>
          <div className="overflow-y-auto flex-1 min-h-0">
            {unstaged.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                isSelected={file.path === selectedPath}
                onToggle={() => onStage(file.path)}
                onClick={() => onSelectFile?.(file.path)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              />
            ))}
          </div>
        </div>
      )}

      {files.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {t("changes.noChanges")}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-36"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.file.staged ? (
            <ContextMenuItem
              label={t("commit.unstage")}
              onClick={() => { onUnstage(contextMenu.file.path); closeContextMenu(); }}
            />
          ) : (
            <ContextMenuItem
              label={t("commit.stage")}
              onClick={() => { onStage(contextMenu.file.path); closeContextMenu(); }}
            />
          )}
          <ContextMenuItem
            label={t("changes.discard")}
            danger
            onClick={() => { onDiscard(contextMenu.file.path); closeContextMenu(); }}
          />
        </div>
      )}
    </div>
  );
}


interface FileRowProps {
  file: StatusEntry;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function FileRow({ file, isSelected, onToggle, onClick, onContextMenu }: FileRowProps) {
  const dir = file.path.includes("/")
    ? file.path.substring(0, file.path.lastIndexOf("/") + 1)
    : "";
  const filename = file.path.includes("/")
    ? file.path.substring(file.path.lastIndexOf("/") + 1)
    : file.path;

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx(
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors",
        isSelected
          ? "bg-primary/10"
          : "hover:bg-accent"
      )}
    >
      <input
        type="checkbox"
        checked={file.staged}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-ring shrink-0"
      />
      <FileStatusBadge status={file.status} />
      <span className="text-xs text-muted-foreground truncate max-w-16">{dir}</span>
      <span className="text-xs font-medium text-foreground truncate">
        {filename}
      </span>
    </div>
  );
}

interface ContextMenuItemProps {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

function ContextMenuItem({ label, danger = false, onClick }: ContextMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full px-4 py-1.5 text-sm text-left transition-colors",
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}
