import { useState } from "react";
import { X, FolderOpen, Search, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { GitHubAccount } from "@/types";

type Tab = "github" | "url";

interface CloneDialogProps {
  accounts: GitHubAccount[];
  selectedAccountId: string | null;
  onAccountChange: (accountId: string) => void;
  onClone: (params: { url: string; localPath: string; accountId: string | null }) => void;
  onClose: () => void;
}

export function CloneDialog({
  accounts,
  selectedAccountId,
  onAccountChange,
  onClone,
  onClose,
}: CloneDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("github");
  const [repoSearch, setRepoSearch] = useState("");
  const [url, setUrl] = useState("");
  const [localPath, setLocalPath] = useState("");

  const handleClone = () => {
    const cloneUrl = tab === "url" ? url : "";
    if (!cloneUrl && tab === "url") return;
    onClone({ url: cloneUrl, localPath, accountId: selectedAccountId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t("repo.clone")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-6">
          {(["github", "url"] as Tab[]).map((t_) => (
            <button
              key={t_}
              onClick={() => setTab(t_)}
              className={clsx(
                "px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t_
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              )}
            >
              {t_ === "github" ? "GitHub.com" : "URL"}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {tab === "github" && (
            <>
              {/* Account selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Account
                </label>
                <select
                  value={selectedAccountId ?? ""}
                  onChange={(e) => onAccountChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select account...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.username}
                    </option>
                  ))}
                </select>
              </div>

              {/* Repo search */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Repository
                </label>
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <Search className="w-4 h-4 text-gray-400 shrink-0" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className="flex-1 text-sm bg-transparent text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {tab === "url" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Repository URL
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Local path */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Local Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="~/Projects/..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors">
                <FolderOpen className="w-4 h-4" />
                Browse
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleClone}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Clone
          </button>
        </div>
      </div>
    </div>
  );
}
