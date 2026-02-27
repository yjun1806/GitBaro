import { useTranslation } from "react-i18next";
import { ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useBranchComparison } from "@/api/queries";
import { formatRelativeTime } from "@/lib/utils";
import type { CommitInfo } from "@/types";

interface BranchCompareViewProps {
  repoPath: string;
  baseBranch: string;
  compareBranch: string;
  selectedCommitId: string | null;
  onSelectCommit: (id: string) => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n.charAt(0).toUpperCase())
    .join("");
}

function CommitRow({
  commit,
  isSelected,
  onClick,
}: {
  commit: CommitInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border w-full",
        isSelected ? "bg-primary/10" : "hover:bg-accent",
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
            "text-sm font-semibold leading-snug truncate",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          {commit.summary}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground/70 truncate">
            {commit.author.name}
          </span>
          <span className="text-xs text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground/50 shrink-0">
            {formatRelativeTime(commit.timestamp)}
          </span>
        </div>
      </div>

      {/* Short hash */}
      <span className="text-xs font-mono text-muted-foreground/50 shrink-0 mt-1">
        {commit.shortId}
      </span>
    </button>
  );
}

export function BranchCompareView({
  repoPath,
  baseBranch,
  compareBranch,
  selectedCommitId,
  onSelectCommit,
}: BranchCompareViewProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useBranchComparison(
    repoPath,
    baseBranch,
    compareBranch,
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("compare.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  if (data.aheadCount === 0 && data.behindCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("compare.branchesIdentical")}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Ahead section */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface sticky top-0 z-10">
          <ArrowUp className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            {t("compare.ahead")}
          </span>
          <span className="bg-primary/10 text-primary text-xs font-semibold rounded-full px-2 py-0.5">
            {data.aheadCount}
          </span>
        </div>
        {data.aheadCommits.length > 0 ? (
          data.aheadCommits.map((commit) => (
            <CommitRow
              key={commit.id}
              commit={commit}
              isSelected={commit.id === selectedCommitId}
              onClick={() => onSelectCommit(commit.id)}
            />
          ))
        ) : (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {t("compare.noCommitsAhead")}
          </div>
        )}
      </div>

      {/* Behind section */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface sticky top-0 z-10">
          <ArrowDown className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-medium text-foreground">
            {t("compare.behind")}
          </span>
          <span className="bg-orange-500/10 text-orange-500 text-xs font-semibold rounded-full px-2 py-0.5">
            {data.behindCount}
          </span>
        </div>
        {data.behindCommits.length > 0 ? (
          data.behindCommits.map((commit) => (
            <CommitRow
              key={commit.id}
              commit={commit}
              isSelected={commit.id === selectedCommitId}
              onClick={() => onSelectCommit(commit.id)}
            />
          ))
        ) : (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {t("compare.noCommitsBehind")}
          </div>
        )}
      </div>
    </div>
  );
}
