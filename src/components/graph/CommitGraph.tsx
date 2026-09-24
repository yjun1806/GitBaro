import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useToastStore } from "@/stores/toast";
import {
  useBranches,
  useCommitAvatars,
  useCommitHistoryInfinite,
  useRemoteTags,
  useWorktrees,
} from "@/api/queries";
import { createBranch, type ResetMode } from "@/api/commands";
import { useCommitActions } from "@/hooks/useCommitActions";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { computeGraphLanes } from "@/lib/graph-lanes";
import { getErrorMessage } from "@/lib/utils";
import { BranchCompareSelector } from "@/components/history/BranchCompareSelector";
import { HistoryView } from "@/components/history/HistoryView";
import { CommitContextMenu } from "@/components/history/CommitContextMenu";
import { ResetCommitDialog } from "@/components/history/ResetCommitDialog";
import { CommitBranchDialog } from "@/components/history/CommitBranchDialog";
import type { CommitInfo } from "@/types";
import { GRAPH_COLUMNS, GraphRow, GraphWipRow, SeenDivider } from "./GraphRow";
import {
  edgesThroughBottom,
  graphColumnWidth,
  laneColor,
  markNewCommits,
  normalizePath,
  type GraphWip,
} from "./graph-model";

export interface CommitGraphProps {
  /** 맨 위 WIP 행(`useGraphReview`가 순서까지 정한 목록). */
  wips: GraphWip[];
  /** 지금 연 워크트리의 새 커밋 수와 새 커밋으로 센 커밋. 모르면 null. */
  newCommits: { newCount: number; ids: readonly string[] } | null;
  /** 지금 연 워크트리를 확인한 시각(epoch ms). */
  seenAt: number | null;
}

/**
 * 위 패널의 커밋 그래프(단일 저장소). 전체 폭 레인 그래프로 HEAD의 이력을 그리고,
 * 맨 위에 워크트리마다 WIP 행, 새 커밋 점, 「여기까지 확인함」 구분선을 둔다.
 * 브랜치 비교를 켜면 WIP 행 아래가 기존 비교 화면(`HistoryView`)으로 바뀐다.
 */
export function CommitGraph(props: CommitGraphProps) {
  const compareBranch = useUIStore((s) => s.compareBranch);
  const selection = useGraphSelection();
  // 비교 화면(선택기의 비교 해제 버튼, merge 패널 포함)은 기존 화면을 그대로 쓴다.
  // WIP 행은 남겨 비교 중에도 스테이징 목록으로 갈 수 있게 한다.
  if (compareBranch) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <WipRows wips={props.wips} selection={selection} graphWidth={graphColumnWidth(1)} headChain={null} />
        <HistoryView />
      </div>
    );
  }
  return <CommitGraphList {...props} selection={selection} />;
}

type GraphSelection = ReturnType<typeof useGraphSelection>;

/**
 * 그래프에서 고른 것(WIP 행 또는 커밋)을 아래 칸에 연다. 다른 워크트리의 WIP 행은 그
 * 워크트리를 연 다음에 스테이징 목록을 연다. 기다리는 사이 사용자가 다른 것을 골랐거나
 * 열기에 실패해 이전 위치로 돌아갔으면 스테이징 목록으로 넘기지 않는다.
 */
function useGraphSelection() {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const selectCommitInStore = useSelectionStore((s) => s.selectCommit);
  const { data: worktreeList = [] } = useWorktrees(activeRepoPath);
  const openWorktree = useOpenWorktree(activeRepoPath, worktreeList);
  // 고를 때마다 늘린다. 비동기 전환이 끝났을 때 그 뒤에 다른 것을 골랐는지 본다.
  const intent = useRef(0);

  const selectCommit = useCallback(
    (id: string) => {
      intent.current += 1;
      selectCommitInStore(id);
    },
    [selectCommitInStore],
  );

  const selectWip = useCallback(
    async (wip: GraphWip) => {
      const mine = ++intent.current;
      if (!wip.isCurrent) {
        await openWorktree(wip.path);
        const now = useRepositoryStore.getState().activeRepoPath;
        const opened = now !== null && normalizePath(now) === normalizePath(wip.path);
        if (!opened || intent.current !== mine) return;
      }
      setActiveTab("changes");
    },
    [openWorktree, setActiveTab],
  );

  return { selectCommit, selectWip };
}

interface WipRowsProps {
  wips: GraphWip[];
  selection: GraphSelection;
  graphWidth: number;
  /** 지금 연 워크트리의 HEAD 커밋이 있는 줄기. 그 행과 점선으로 잇는다. 없으면 null. */
  headChain: number | null;
}

/** 맨 위 WIP 행들. 워크트리마다 한 행. */
function WipRows({ wips, selection, graphWidth, headChain }: WipRowsProps) {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const colorSeed = useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath ?? "");
  return (
    <>
      {wips.map((wip) => (
        <GraphWipRow
          key={wip.path}
          wipLabel={
            wip.isCurrent
              ? t("shell.uncommittedCount", { count: wip.count ?? 0 })
              : t("graph.wipWorktreeLabel", { name: worktreeName(wip), count: wip.count ?? 0 })
          }
          worktreeName={wip.isCurrent ? null : worktreeName(wip)}
          count={wip.count}
          changedAt={wip.changedAt}
          color={wip.isCurrent ? laneColor(colorSeed, headChain ?? 0) : laneColor(wip.path, 0)}
          graphWidth={graphWidth}
          selected={wip.isCurrent && activeTab === "changes"}
          connectDown={wip.isCurrent && headChain !== null}
          onSelect={() => void selection.selectWip(wip)}
        />
      ))}
    </>
  );
}

function CommitGraphList({
  newCommits,
  seenAt,
  wips,
  selection,
}: CommitGraphProps & { selection: GraphSelection }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const colorSeed = useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath ?? "");
  const accounts = useAccountStore((s) => s.accounts);
  const compareBranch = useUIStore((s) => s.compareBranch);
  const setCompareBranch = useUIStore((s) => s.setCompareBranch);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const { selectCommit } = selection;
  const repoAccountId = useRepoAccountId();

  const { data: historyData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCommitHistoryInfinite(activeRepoPath);
  const { data: branchesData } = useBranches(activeRepoPath);
  const branches = useMemo(() => branchesData ?? [], [branchesData]);
  const currentBranchName = branches.find((b) => b.isHead)?.name ?? null;
  const { data: remoteTagNames } = useRemoteTags(activeRepoPath, repoAccountId);
  // 원격 태그 목록을 모르는 동안은 null로 둬 태그를 로컬 전용으로 잘못 표시하지 않는다.
  const remoteTags = useMemo(
    () => (remoteTagNames ? new Set(remoteTagNames) : null),
    [remoteTagNames],
  );
  const { data: githubAvatarMap = {} } = useCommitAvatars(activeRepoPath);

  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );

  // 레인은 불러온 전체 이력으로 계산한다(1만 행도 100ms 안, `graph-lanes` 테스트).
  // 페이지가 밀려 같은 커밋이 두 번 오면 레인 계산이 뺀 커밋을 목록에서도 뺀다.
  const { commits, layouts, graphWidth } = useMemo(() => {
    const all = historyData?.pages.flat() ?? [];
    const result = computeGraphLanes(all.map((c) => ({ oid: c.id, parentIds: c.parentIds })));
    const byOid = new Map(result.rows.map((r) => [r.oid, r]));
    const kept = new Set<string>();
    const drawn = all.filter((c) => {
      if (!byOid.has(c.id) || kept.has(c.id)) return false;
      kept.add(c.id);
      return true;
    });
    const maxLanes = result.rows.reduce((m, r) => Math.max(m, r.width), 1);
    return { commits: drawn, layouts: byOid, graphWidth: graphColumnWidth(maxLanes) };
  }, [historyData]);

  const marks = useMemo(
    () => markNewCommits(commits, newCommits),
    [commits, newCommits],
  );
  const colorOf = useCallback((chain: number) => laneColor(colorSeed, chain), [colorSeed]);

  const selectedIdx = useMemo(
    () => commits.findIndex((c) => c.id === selectedCommitId),
    [commits, selectedCommitId],
  );
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: commits,
    onSelect: (c) => selectCommit(c.id),
    selectedIndex: selectedIdx,
  });

  // 무한 스크롤: 맨 아래 표시가 보이면 다음 페이지를 불러온다.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadState = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  useEffect(() => {
    loadState.current = { hasNextPage, isFetchingNextPage, fetchNextPage };
  });
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const { hasNextPage: more, isFetchingNextPage: busy, fetchNextPage: load } = loadState.current;
        if (more && !busy) load();
      },
      { root, rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLoading, activeRepoPath]);

  const menu = useCommitMenu(activeRepoPath);

  const headId = commits[0]?.id;
  const headChain = headId ? (layouts.get(headId)?.chain ?? 0) : null;
  const currentWipShown = wips.some((w) => w.isCurrent);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {branches.length > 1 && (
        <div className="px-3 py-2 border-b border-(--line) shrink-0">
          <BranchCompareSelector
            branches={branches}
            activeRepoPath={activeRepoPath}
            currentBranch={currentBranchName}
            compareBranch={compareBranch}
            onSelect={setCompareBranch}
          />
        </div>
      )}

      <div
        className={GRAPH_COLUMNS + " h-6 shrink-0 pr-3 border-b border-(--line) text-[11px] font-semibold text-(--faint)"}
        style={{ paddingLeft: graphWidth + 8 }}
        aria-hidden="true"
      >
        <span className="pl-3.5">{t("graph.colDescription")}</span>
        <span>{t("graph.colAuthor")}</span>
        <span>{t("graph.colTime")}</span>
        <span>{t("graph.colCommit")}</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        <WipRows wips={wips} selection={selection} graphWidth={graphWidth} headChain={headChain} />

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("history.loadingHistory")}</p>
        ) : commits.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("history.noCommits")}</p>
        ) : (
          commits.map((commit, index) => {
            const layout = layouts.get(commit.id);
            if (!layout) return null;
            const emailKey = commit.author.email?.toLowerCase() ?? "";
            const prevLayout = index > 0 ? layouts.get(commits[index - 1].id) : undefined;
            return (
              <Fragment key={commit.id}>
                {marks.dividerBefore === index && (
                  <SeenDivider
                    seenAt={seenAt}
                    graphWidth={graphWidth}
                    through={prevLayout ? edgesThroughBottom(prevLayout.edges) : []}
                    colorOf={colorOf}
                  />
                )}
                <GraphRow
                  ref={itemRef(index)}
                  commit={commit}
                  layout={layout}
                  graphWidth={graphWidth}
                  colorOf={colorOf}
                  remoteTags={remoteTags}
                  avatarUrl={accountAvatarMap.get(emailKey) || githubAvatarMap[emailKey] || undefined}
                  isSelected={selectedCommitId === commit.id}
                  isHighlighted={activeIndex === index}
                  isNew={marks.newIds.has(commit.id)}
                  isSeen={marks.dividerBefore !== null && index >= marks.dividerBefore}
                  wipAbove={index === 0 && currentWipShown}
                  onClick={() => selectCommit(commit.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    selectCommit(commit.id);
                    menu.open(commit, e.clientX, e.clientY);
                  }}
                />
              </Fragment>
            );
          })
        )}
        {!isLoading && marks.dividerBefore !== null && marks.dividerBefore === commits.length && (
          <SeenDivider
            seenAt={seenAt}
            graphWidth={graphWidth}
            through={
              commits.length > 0
                ? edgesThroughBottom(layouts.get(commits[commits.length - 1].id)?.edges ?? [])
                : []
            }
            colorOf={colorOf}
          />
        )}
        <div ref={loadMoreRef} />
        {isFetchingNextPage && (
          <div className="flex items-center justify-center py-3 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
      </div>

      {menu.element}
    </div>
  );
}

function worktreeName(wip: GraphWip): string {
  return wip.branch ?? wip.path.split("/").pop() ?? wip.path;
}

/**
 * 커밋 우클릭 메뉴(`CommitContextMenu`)와 그 메뉴가 여는 확인 창·대화상자.
 * 동작은 기존 히스토리 목록(`HistoryView`)과 같다.
 */
function useCommitMenu(repoPath: string | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { checkout, reset, revert, cherryPick } = useCommitActions(repoPath);
  const [target, setTarget] = useState<{ commit: CommitInfo; x: number; y: number } | null>(null);
  const [resetTarget, setResetTarget] = useState<CommitInfo | null>(null);
  const [branchTarget, setBranchTarget] = useState<CommitInfo | null>(null);

  const confirmThen = async (message: string, title: string, run: () => void) => {
    const ok = await ask(message, { title, kind: "warning" });
    if (ok) run();
  };

  const handleCreateBranch = async (name: string) => {
    if (!repoPath || !branchTarget) return;
    const oid = branchTarget.id;
    setBranchTarget(null);
    try {
      await createBranch(repoPath, name, oid);
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

  const element = (
    <>
      {target && (
        <CommitContextMenu
          position={{ x: target.x, y: target.y }}
          onCopyHash={() => navigator.clipboard.writeText(target.commit.id)}
          onCopyMessage={() => navigator.clipboard.writeText(target.commit.message)}
          onCreateBranch={() => setBranchTarget(target.commit)}
          onCheckout={() =>
            void confirmThen(
              t("history.checkoutConfirm", { shortId: target.commit.shortId }),
              t("history.contextMenu.checkout"),
              () => checkout(target.commit.id),
            )
          }
          onReset={() => setResetTarget(target.commit)}
          onRevert={() =>
            void confirmThen(
              // 병합 커밋은 첫 번째 부모 기준으로 되돌린다(백엔드가 -m 1 사용).
              t(target.commit.parentIds.length > 1 ? "history.revertMergeConfirm" : "history.revertConfirm", {
                shortId: target.commit.shortId,
              }),
              t("history.contextMenu.revert"),
              () => revert(target.commit.id),
            )
          }
          onCherryPick={() =>
            void confirmThen(
              t("history.cherryPickConfirm", { shortId: target.commit.shortId }),
              t("history.contextMenu.cherryPick"),
              () => cherryPick(target.commit.id),
            )
          }
          isMergeCommit={target.commit.parentIds.length > 1}
          onClose={() => setTarget(null)}
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
          onCreate={handleCreateBranch}
          onClose={() => setBranchTarget(null)}
        />
      )}
    </>
  );

  return {
    open: (commit: CommitInfo, x: number, y: number) => setTarget({ commit, x, y }),
    element,
  };
}
