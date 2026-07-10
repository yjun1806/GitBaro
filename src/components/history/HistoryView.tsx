import { useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Loader2 } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useCommitHistoryInfinite, useCommitAvatars, useBranches, useBranchComparison, useStatus } from "@/api/queries";
import { BranchCompareSelector } from "@/components/history/BranchCompareSelector";
import { BranchCompareView } from "@/components/history/BranchCompareView";
import { MergeActionPanel } from "@/components/history/MergeActionPanel";
import { CommitItem } from "@/components/history/CommitItem";
import { cn } from "@/lib/utils";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import type { CommitInfo } from "@/types";

export function HistoryView() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const {
    data: historyData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useCommitHistoryInfinite(activeRepoPath);
  const commits = useMemo(
    () => historyData?.pages.flat() ?? [],
    [historyData],
  );
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

  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const selectCommit = useSelectionStore((s) => s.selectCommit);

  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );

  const selectedCommitIdx = useMemo(
    () => commits.findIndex((c) => c.id === selectedCommitId),
    [commits, selectedCommitId],
  );

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: commits,
    onSelect: (c) => selectCommit(c.id),
    selectedIndex: selectedCommitIdx,
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  // 옵저버 콜백이 항상 최신 상태를 읽도록 ref에 보관 (옵저버 재생성 방지)
  const loadState = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  useEffect(() => {
    loadState.current = { hasNextPage, isFetchingNextPage, fetchNextPage };
  });

  // 하단 sentinel이 뷰포트(스크롤 컨테이너)에 들어오면 다음 페이지를 이어 로드
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const { hasNextPage: more, isFetchingNextPage: busy, fetchNextPage: load } =
          loadState.current;
        if (more && !busy) load();
      },
      { root, rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLoading, compareBranch, activeRepoPath]);

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
        <div ref={scrollRef} className="flex-1 overflow-y-auto" {...containerProps}>
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
                ref={itemRef(index)}
                commit={commit}
                isSelected={selectedCommitId === commit.id}
                isHighlighted={activeIndex === index}
                avatarUrl={avatarSrc}
                onClick={() => selectCommit(commit.id)}
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
          {/* 무한 스크롤 sentinel + 다음 페이지 로딩 표시 */}
          <div ref={loadMoreRef} />
          {isFetchingNextPage && (
            <div className="flex items-center justify-center py-3 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
