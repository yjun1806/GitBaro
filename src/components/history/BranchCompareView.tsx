import { useTranslation } from "react-i18next";
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranchComparison } from "@/api/queries";
import { formatRelativeTime, getErrorMessage } from "@/lib/utils";
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
      className={cn(
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
          className={cn(
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

interface CommitSectionProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  badgeClass: string;
  commits: CommitInfo[];
  emptyMessage: string;
  selectedCommitId: string | null;
  onSelectCommit: (id: string) => void;
  tooltip?: string;
}

function CommitSection({
  icon,
  label,
  count,
  badgeClass,
  commits,
  emptyMessage,
  selectedCommitId,
  onSelectCommit,
  tooltip,
}: CommitSectionProps) {
  return (
    <div className={cn("flex flex-col", count === 0 && "opacity-50")}>
      <div
        className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface sticky top-0 z-10"
        title={tooltip}
      >
        {icon}
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "text-xs font-semibold rounded-full px-2 py-0.5",
            badgeClass,
          )}
        >
          {count}
        </span>
      </div>
      {commits.length > 0 ? (
        commits.map((commit) => (
          <CommitRow
            key={commit.id}
            commit={commit}
            isSelected={commit.id === selectedCommitId}
            onClick={() => onSelectCommit(commit.id)}
          />
        ))
      ) : (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </div>
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
        {getErrorMessage(error)}
      </div>
    );
  }

  if (!data) return null;

  if (data.aheadCount === 0 && data.behindCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("compare.identical")}
      </div>
    );
  }

  /**
   * Git ↔ UI 용어 매핑:
   * - aheadCount / aheadCommits  → "Outgoing" (현재 브랜치에만 있는 커밋, push 대상)
   * - behindCount / behindCommits → "Incoming" (비교 브랜치에만 있는 커밋, merge 대상)
   */
  const incoming = { count: data.behindCount, commits: data.behindCommits };
  const outgoing = { count: data.aheadCount, commits: data.aheadCommits };

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Incoming section first — more actionable */}
      <CommitSection
        icon={<ArrowDownToLine className="w-4 h-4 text-info" />}
        label={t("compare.incomingFrom", { branch: compareBranch })}
        count={incoming.count}
        badgeClass="bg-info/10 text-info"
        commits={incoming.commits}
        emptyMessage={t("compare.noIncomingCommits")}
        selectedCommitId={selectedCommitId}
        onSelectCommit={onSelectCommit}
        tooltip={t("compare.incomingTooltip", {
          count: incoming.count,
          branch: compareBranch,
        })}
      />

      {/* Outgoing section */}
      <CommitSection
        icon={<ArrowUpFromLine className="w-4 h-4 text-success" />}
        label={t("compare.outgoingTo", { branch: compareBranch })}
        count={outgoing.count}
        badgeClass="bg-success/10 text-success"
        commits={outgoing.commits}
        emptyMessage={t("compare.noOutgoingCommits")}
        selectedCommitId={selectedCommitId}
        onSelectCommit={onSelectCommit}
        tooltip={t("compare.outgoingTooltip", {
          count: outgoing.count,
          branch: compareBranch,
        })}
      />
    </div>
  );
}
