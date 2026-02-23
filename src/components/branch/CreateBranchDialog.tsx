import { useState } from "react";
import { X, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { BranchInfo } from "@/types";

interface CreateBranchDialogProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  onCreate: (name: string, fromBranch: string) => void;
  onClose: () => void;
}

function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.endsWith("/");
}

export function CreateBranchDialog({
  branches,
  currentBranch,
  onCreate,
  onClose,
}: CreateBranchDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [fromBranch, setFromBranch] = useState(currentBranch ?? "");

  const valid = name.length > 0 && isValidBranchName(name);
  const error = name.length > 0 && !valid ? "Invalid branch name" : null;

  const localBranches = branches.filter((b) => !b.isRemote);

  const handleCreate = () => {
    if (!valid) return;
    onCreate(name, fromBranch);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t("branch.create")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Branch name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("branch.name")}
            </label>
            <div
              className={clsx(
                "flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors",
                error
                  ? "border-red-400 dark:border-red-500 focus-within:ring-2 focus-within:ring-red-300"
                  : "border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500"
              )}
            >
              <GitBranch className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="feature/my-feature"
                className="flex-1 text-sm bg-transparent text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none"
              />
            </div>
            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}
          </div>

          {/* From branch */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("branch.from")}
            </label>
            <select
              value={fromBranch}
              onChange={(e) => setFromBranch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
            >
              {localBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.isHead ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!valid}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Create Branch
          </button>
        </div>
      </div>
    </div>
  );
}
