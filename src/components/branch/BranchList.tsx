import { useState } from "react";
import { GitBranch, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { BranchInfo } from "@/types";

interface BranchListProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  onDelete: (branch: BranchInfo) => void;
}

export function BranchList({ branches, currentBranch, onDelete }: BranchListProps) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const local = branches.filter((b) => !b.isRemote);

  const handleDeleteClick = (branch: BranchInfo) => {
    setConfirmDelete(branch.name);
  };

  const handleConfirm = (branch: BranchInfo) => {
    onDelete(branch);
    setConfirmDelete(null);
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {local.map((branch) => (
        <div
          key={branch.name}
          className={clsx(
            "relative flex items-center gap-2 px-3 py-2 rounded-lg",
            branch.name === currentBranch
              ? "bg-blue-50 dark:bg-blue-900/30"
              : "hover:bg-gray-50 dark:hover:bg-gray-800"
          )}
        >
          <GitBranch
            className={clsx(
              "w-4 h-4 shrink-0",
              branch.name === currentBranch
                ? "text-blue-500"
                : "text-gray-400"
            )}
          />
          <div className="flex-1 min-w-0">
            <p
              className={clsx(
                "text-sm font-medium truncate",
                branch.name === currentBranch
                  ? "text-blue-700 dark:text-blue-300"
                  : "text-gray-700 dark:text-gray-200"
              )}
            >
              {branch.name}
              {branch.isHead && (
                <span className="ml-2 text-xs text-blue-500 dark:text-blue-400">HEAD</span>
              )}
            </p>
            {branch.upstream && (
              <p className="text-xs text-gray-400 truncate">{branch.upstream}</p>
            )}
          </div>

          {branch.aheadBehind && (
            <div className="flex items-center gap-1 text-xs">
              {branch.aheadBehind.ahead > 0 && (
                <span className="text-green-600 dark:text-green-400">↑{branch.aheadBehind.ahead}</span>
              )}
              {branch.aheadBehind.behind > 0 && (
                <span className="text-red-500">↓{branch.aheadBehind.behind}</span>
              )}
            </div>
          )}

          {branch.name !== currentBranch && (
            <button
              onClick={() => handleDeleteClick(branch)}
              className="p-1 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title={t("branch.delete")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Inline confirm */}
          {confirmDelete === branch.name && (
            <div className="absolute inset-x-0 bottom-full mb-1 mx-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-10">
              <p className="text-sm text-gray-700 dark:text-gray-200 mb-2">
                {t("branch.deleteConfirm", { name: branch.name })}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirm(branch)}
                  className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
