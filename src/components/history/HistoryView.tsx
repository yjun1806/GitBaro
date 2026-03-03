import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { useCommitHistory, useCommitAvatars, useBranches, useBranchComparison, useStatus } from "@/api/queries";
import { BranchCompareSelector } from "@/components/history/BranchCompareSelector";
import { BranchCompareView } from "@/components/history/BranchCompareView";
import { MergeActionPanel } from "@/components/history/MergeActionPanel";
import { CommitItem } from "@/components/history/CommitItem";
import { cn } from "@/lib/utils";
import type { CommitInfo } from "@/types";

export interface HistoryViewProps {
  selectedCommitId: string | null;
  onSelectCommit: (id: string) => void;
}

export function HistoryView({ selectedCommitId, onSelectCommit }: HistoryViewProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const { data: commits = [], isLoading } = useCommitHistory(activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: githubAvatarMap = {} } = useCommitAvatars(activeRepoPath);
  const compareBranch = useUIStore((s) => s.compareBranch);
  const setCompareBranch = useUIStore((s) => s.setCompareBranch);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const headBranch = branches.find((b) => b.isHead);
  const currentBranchName = headBranch?.name ?? null;
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const { data: comparisonData } = useBranchComparison(
    activeRepoPath,
    currentBranchName,
    compareBranch,
  );

  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("history.loadingHistory")}</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("history.noCommits")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background">
      {/* Branch compare selector */}
      {branches.length > 1 && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <BranchCompareSelector
            branches={branches}
            currentBranch={currentBranchName}
            compareBranch={compareBranch}
            onSelect={setCompareBranch}
          />
        </div>
      )}

      {/* Compare view or normal commit list */}
      {compareBranch && activeRepoPath && currentBranchName ? (
        <>
          <BranchCompareView
            repoPath={activeRepoPath}
            baseBranch={currentBranchName}
            compareBranch={compareBranch}
            selectedCommitId={selectedCommitId}
            onSelectCommit={onSelectCommit}
            resolveAvatarUrl={(email) => {
              const key = email.toLowerCase();
              return accountAvatarMap.get(key) || githubAvatarMap[key] || undefined;
            }}
          />
          <MergeActionPanel
            repoPath={activeRepoPath}
            compareBranch={compareBranch}
            currentBranch={currentBranchName}
            behindCount={comparisonData?.behindCount ?? 0}
            isDirty={statusEntries.length > 0}
          />
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {commits.map((commit: CommitInfo, index: number) => {
            const isUnpushed = index < ahead;
            const emailKey = commit.author.email?.toLowerCase() ?? "";
            const avatarSrc =
              accountAvatarMap.get(emailKey) ||
              githubAvatarMap[emailKey] ||
              undefined;
            return (
              <CommitItem
                key={commit.id}
                commit={commit}
                isSelected={selectedCommitId === commit.id}
                avatarUrl={avatarSrc}
                onClick={() => onSelectCommit(commit.id)}
                trailing={
                  isUnpushed ? (
                    <div
                      className={cn(
                        "shrink-0 self-center flex items-center justify-center w-5 h-5 rounded-full",
                        selectedCommitId === commit.id
                          ? "bg-primary/20"
                          : "bg-primary/10",
                      )}
                    >
                      <ArrowUp
                        strokeWidth={3}
                        className="w-3 h-3 text-primary"
                      />
                    </div>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
