import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { StatusEntry, FileStatus } from "@/types";

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

const statusColors: Record<FileStatus, string> = {
  modified: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
  added: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20",
  deleted: "text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20",
  renamed: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20",
  copied: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20",
  untracked: "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800",
  ignored: "text-gray-400 bg-gray-50 dark:bg-gray-900",
  conflicted: "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30",
};

const statusLabels: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
  ignored: "I",
  conflicted: "!",
};

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
    <div className="flex flex-col h-full" onClick={closeContextMenu}>
      {/* Staged files */}
      {staged.length > 0 && (
        <Section
          title="Staged Changes"
          count={staged.length}
          action={{ label: t("changes.unstageAll"), onClick: onUnstageAll }}
        >
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
        </Section>
      )}

      {/* Unstaged files */}
      {unstaged.length > 0 && (
        <Section
          title="Changes"
          count={unstaged.length}
          action={{ label: t("changes.stageAll"), onClick: onStageAll }}
        >
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
        </Section>
      )}

      {files.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          {t("changes.noChanges")}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-36"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.file.staged ? (
            <ContextMenuItem
              label="Unstage"
              onClick={() => { onUnstage(contextMenu.file.path); closeContextMenu(); }}
            />
          ) : (
            <ContextMenuItem
              label="Stage"
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

interface SectionProps {
  title: string;
  count: number;
  action: { label: string; onClick: () => void };
  children: ReactNode;
}

function Section({ title, count, action, children }: SectionProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 sticky top-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {title} ({count})
        </span>
        <button
          onClick={action.onClick}
          className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {action.label}
        </button>
      </div>
      <div className="flex flex-col">{children}</div>
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
          ? "bg-blue-50 dark:bg-blue-900/30"
          : "hover:bg-gray-50 dark:hover:bg-gray-800"
      )}
    >
      <input
        type="checkbox"
        checked={file.staged}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500 shrink-0"
      />
      <span
        className={clsx(
          "text-xs font-bold w-4 h-4 flex items-center justify-center rounded shrink-0",
          statusColors[file.status]
        )}
      >
        {statusLabels[file.status]}
      </span>
      <span className="text-xs text-gray-400 truncate max-w-16">{dir}</span>
      <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
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
          ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
      )}
    >
      {label}
    </button>
  );
}
