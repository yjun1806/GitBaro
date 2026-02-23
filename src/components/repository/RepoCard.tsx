import { GitBranch } from "lucide-react";
import clsx from "clsx";
import type { RepoInfo, GitHubAccount } from "@/types";
import { AccountAvatar } from "@/components/account/AccountAvatar";

interface RepoCardProps {
  repo: RepoInfo;
  account?: GitHubAccount;
  isSelected?: boolean;
  onClick: () => void;
}

export function RepoCard({
  repo,
  account,
  isSelected = false,
  onClick,
}: RepoCardProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors relative",
        isSelected
          ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700"
          : "hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={clsx(
              "text-sm font-medium truncate",
              isSelected
                ? "text-blue-700 dark:text-blue-300"
                : "text-gray-800 dark:text-gray-100"
            )}
          >
            {repo.name}
          </span>
          {repo.isDirty && (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400" title="Uncommitted changes" />
          )}
        </div>

        {repo.currentBranch && (
          <div className="flex items-center gap-1 mt-0.5">
            <GitBranch className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {repo.currentBranch}
            </span>
          </div>
        )}
      </div>

      {account && (
        <AccountAvatar account={account} size="sm" className="shrink-0" />
      )}
    </button>
  );
}
