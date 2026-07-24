import { useMemo, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Loader2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useCommitHistoryInfinite, useCommitAvatars, useBranches, useBranchComparison, useStatus, useRemoteTags } from "@/api/queries";
import { createBranch, type ResetMode } from "@/api/commands";
import { useCommitActions } from "@/hooks/useCommitActions";
import { useToastStore } from "@/stores/toast";
import { BranchCompareSelector } from "@/components/history/BranchCompareSelector";
import { BranchCompareView } from "@/components/history/BranchCompareView";
import { MergeActionPanel } from "@/components/history/MergeActionPanel";
import { CommitItem } from "@/components/history/CommitItem";
import { CommitContextMenu } from "@/components/history/CommitContextMenu";
import { ResetCommitDialog } from "@/components/history/ResetCommitDialog";
import { CommitBranchDialog } from "@/components/history/CommitBranchDialog";
import { cn, getErrorMessage } from "@/lib/utils";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import type { CommitInfo } from "@/types";

export function HistoryView() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
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
  const { data: remoteTagNames } = useRemoteTags(activeRepoPath, activeAccountId);
  // null while the remote list is unknown (loading / no account) so tags aren't
  // falsely flagged as local-only; a Set once origin's tags are known.
  const remoteTags = useMemo(
    () => (remoteTagNames ? new Set(remoteTagNames) : null),
    [remoteTagNames],
  );
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

  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { checkout, reset, revert, cherryPick } = useCommitActions(activeRepoPath);
  // 우클릭 메뉴 대상 커밋 + 좌표
  const [menu, setMenu] = useState<{ commit: CommitInfo; x: number; y: number } | null>(null);
  // 모드 선택이 필요한 reset, 이름 입력이 필요한 브랜치 생성 다이얼로그 대상 커밋
  const [resetTarget, setResetTarget] = useState<CommitInfo | null>(null);
  const [branchTarget, setBranchTarget] = useState<CommitInfo | null>(null);

  const handleCheckout = async (commit: CommitInfo) => {
    const ok = await ask(t("history.checkoutConfirm", { shortId: commit.shortId }), {
      title: t("history.contextMenu.checkout"),
      kind: "warning",
    });
    if (ok) checkout(commit.id);
  };

  const handleRevert = async (commit: CommitInfo) => {
    const ok = await ask(t("history.revertConfirm", { shortId: commit.shortId }), {
      title: t("history.contextMenu.revert"),
      kind: "warning",
    });
    if (ok) revert(commit.id);
  };

  const handleCherryPick = async (commit: CommitInfo) => {
    const ok = await ask(t("history.cherryPickConfirm", { shortId: commit.shortId }), {
      title: t("history.contextMenu.cherryPick"),
      kind: "warning",
    });
    if (ok) cherryPick(commit.id);
  };

  const handleCreateBranchFromCommit = async (name: string) => {
    if (!activeRepoPath || !branchTarget) return;
    const oid = branchTarget.id;
    setBranchTarget(null);
    try {
      await createBranch(activeRepoPath, name, oid);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] }),
      ]);
      addToast(t("history.branchCreated", { name }), "success");
    } catch (err) {
      addToast(getErrorMessage(err), "error");
    }
  };

  const handleResetConfirm = (mode: ResetMode) => {
    if (resetTarget) reset(resetTarget.id, mode);
    setResetTarget(null);
  };

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
                remoteTags={remoteTags}
                isSelected={selectedCommitId === commit.id}
                isHighlighted={activeIndex === index}
                avatarUrl={avatarSrc}
                onClick={() => selectCommit(commit.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  selectCommit(commit.id);
                  setMenu({ commit, x: e.clientX, y: e.clientY });
                }}
                trailing={
                  isUnpushed ? (
                    <div
                      className={cn(
                        "shrink-0 self-center flex items-center justify-center w-5 h-5 rounded-full border border-primary/40",
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

      {/* 커밋 우클릭 메뉴 */}
      {menu && (
        <CommitContextMenu
          position={{ x: menu.x, y: menu.y }}
          onCopyHash={() => navigator.clipboard.writeText(menu.commit.id)}
          onCopyMessage={() => navigator.clipboard.writeText(menu.commit.message)}
          onCreateBranch={() => setBranchTarget(menu.commit)}
          onCheckout={() => handleCheckout(menu.commit)}
          onReset={() => setResetTarget(menu.commit)}
          onRevert={() => handleRevert(menu.commit)}
          onCherryPick={() => handleCherryPick(menu.commit)}
          onClose={() => setMenu(null)}
        />
      )}

      {resetTarget && (
        <ResetCommitDialog
          shortId={resetTarget.shortId}
          onConfirm={handleResetConfirm}
          onClose={() => setResetTarget(null)}
        />
      )}

      {branchTarget && (
        <CommitBranchDialog
          shortId={branchTarget.shortId}
          onCreate={handleCreateBranchFromCommit}
          onClose={() => setBranchTarget(null)}
        />
      )}
    </div>
  );
}
