import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { CommitInfo } from "@/types";
import { formatRelativeTime } from "@/lib/utils";

interface HistoryTimelineProps {
  commits: CommitInfo[];
  selectedOid?: string;
  onSelectCommit: (commit: CommitInfo) => void;
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
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
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
            "flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border",
            commit.id === selectedOid
              ? "bg-primary/10"
              : "hover:bg-accent"
          )}
        >
          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0 mt-0.5">
            {getInitials(commit.author.name)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p
              className={clsx(
                "text-sm font-medium truncate",
                commit.id === selectedOid
                  ? "text-primary"
                  : "text-foreground"
              )}
            >
              {commit.summary}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground truncate">
                {commit.author.name}
              </span>
              <span className="text-xs text-muted-foreground/50">·</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatRelativeTime(commit.timestamp)}
              </span>
            </div>
          </div>

          {/* Short hash */}
          <span className="text-xs font-mono text-muted-foreground/50 shrink-0 mt-1">
            {commit.shortId}
          </span>
        </button>
      ))}
    </div>
  );
}
