import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { CommitInfo } from "@/types";

interface HistoryTimelineProps {
  commits: CommitInfo[];
  selectedOid?: string;
  onSelectCommit: (commit: CommitInfo) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() / 1000 - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n.charAt(0).toUpperCase())
    .join("");
}

export function HistoryTimeline({
  commits,
  selectedOid,
  onSelectCommit,
}: HistoryTimelineProps) {
  const { t } = useTranslation();

  if (commits.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        {t("history.noCommits")}
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {commits.map((commit) => (
        <button
          key={commit.id}
          onClick={() => onSelectCommit(commit)}
          className={clsx(
            "flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-gray-100 dark:border-gray-800",
            commit.id === selectedOid
              ? "bg-blue-50 dark:bg-blue-900/30"
              : "hover:bg-gray-50 dark:hover:bg-gray-800"
          )}
        >
          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0 mt-0.5">
            {getInitials(commit.author.name)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p
              className={clsx(
                "text-sm font-medium truncate",
                commit.id === selectedOid
                  ? "text-blue-700 dark:text-blue-300"
                  : "text-gray-800 dark:text-gray-100"
              )}
            >
              {commit.summary}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {commit.author.name}
              </span>
              <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
              <span className="text-xs text-gray-400 shrink-0">
                {formatRelativeTime(commit.timestamp)}
              </span>
            </div>
          </div>

          {/* Short hash */}
          <span className="text-xs font-mono text-gray-300 dark:text-gray-600 shrink-0 mt-1">
            {commit.shortId}
          </span>
        </button>
      ))}
    </div>
  );
}
