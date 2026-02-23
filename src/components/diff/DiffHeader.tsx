import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { FileStatus } from "@/types";

interface DiffHeaderProps {
  filePath: string;
  status: FileStatus;
  addedLines: number;
  removedLines: number;
  viewMode: "unified" | "split";
  onToggleView: () => void;
}

const statusColors: Record<FileStatus, string> = {
  modified: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
  added: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20",
  deleted: "text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20",
  renamed: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20",
  copied: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20",
  untracked: "text-gray-500 bg-gray-100 dark:bg-gray-800",
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

export function DiffHeader({
  filePath,
  status,
  addedLines,
  removedLines,
  viewMode,
  onToggleView,
}: DiffHeaderProps) {
  const { t } = useTranslation();

  const dir = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/") + 1)
    : "";
  const filename = filePath.includes("/")
    ? filePath.substring(filePath.lastIndexOf("/") + 1)
    : filePath;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 min-w-0">
      <span
        className={clsx(
          "text-xs font-bold w-5 h-5 flex items-center justify-center rounded shrink-0",
          statusColors[status]
        )}
      >
        {statusLabels[status]}
      </span>

      <div className="flex-1 min-w-0 flex items-center gap-0.5">
        <span className="text-xs text-gray-400 truncate">{dir}</span>
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
          {filename}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {addedLines > 0 && (
          <span className="text-xs font-medium text-green-600 dark:text-green-400">
            +{addedLines}
          </span>
        )}
        {removedLines > 0 && (
          <span className="text-xs font-medium text-red-500 dark:text-red-400">
            -{removedLines}
          </span>
        )}

        <button
          onClick={onToggleView}
          className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {viewMode === "unified" ? t("diff.split") : t("diff.unified")}
        </button>
      </div>
    </div>
  );
}
