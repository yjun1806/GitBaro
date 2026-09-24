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
import { useFollowStore, type FollowMode } from "@/stores/follow";
import { FollowBadge } from "@/components/live/FollowPanel";
import {
  useBranches,
  useCommitAvatars,
  useCommitHistoryInfinite,
  useRemoteTags,
} from "@/api/queries";
import { createBranch, type ResetMode } from "@/api/commands";
import { useCommitActions } from "@/hooks/useCommitActions";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { computeGraphLanes } from "@/lib/graph-lanes";
import { formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { BranchCompareSelector } from "@/components/history/BranchCompareSelector";
import { HistoryView } from "@/components/history/HistoryView";
import { CommitContextMenu } from "@/components/history/CommitContextMenu";
import { ResetCommitDialog } from "@/components/history/ResetCommitDialog";
import { CommitBranchDialog } from "@/components/history/CommitBranchDialog";
import type { CommitInfo } from "@/types";
import { edgePath, GRAPH_COLUMNS, GraphRow, GraphWipRow, SeenDivider } from "./GraphRow";
import {
  edgesThroughBottom,
  GRAPH_ROW_HEIGHT,
  graphColumnWidth,
  laneColor,
  laneX,
  markNewCommits,
  normalizePath,
  type GraphWip,
} from "./graph-model";
import { repoLaneColor, type LaneWip, type RepoLaneGraph } from "./repo-lanes";
import { BranchRangeGraph } from "@/components/branch/BranchRangeGraph";
import { activeRange, isStaleRange, useBranchRangeStore } from "@/components/branch/branch-range";

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
  const range = useActiveBranchRange();
  // 범위 모드(브랜치 패널의 「비교」): `base..target` 커밋만 그린다. WIP 행은 남긴다.
  if (range) {
    return (
      <BranchRangeGraph
        range={range.range}
        currentBranch={range.currentBranch}
        top={<WipRows wips={props.wips} selection={selection} graphWidth={graphColumnWidth(1)} headChain={null} />}
        onSelectCommit={selection.selectCommit}
      />
    );
  }
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
 * 지금 연 저장소의 범위 모드. 다른 저장소로 옮기거나, base·target 브랜치가 없어지거나,
 * 워크트리가 다른 브랜치로 바뀌면 범위를 지운다(`isStaleRange`).
 */
function useActiveBranchRange() {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const stored = useBranchRangeStore((s) => s.range);
  const clearRange = useBranchRangeStore((s) => s.clear);
  const { data: branches } = useBranches(stored ? activeRepoPath : null);
  const range = activeRange(stored, activeRepoPath);
  const stale = range !== null && isStaleRange(range, branches);
  useEffect(() => {
    if (stored && (stored.repoPath !== activeRepoPath || stale)) clearRange();
  }, [stored, activeRepoPath, stale, clearRange]);
  if (!range || stale) return null;
  const currentBranch = branches?.find((b) => b.isHead && !b.isRemote)?.name ?? null;
  return { range, currentBranch };
}

/**
 * 그래프에서 고른 것(WIP 행 또는 커밋)을 아래 칸에 연다. WIP 행은 그 워크트리를 따라가기
 * 시작한다(D4). 다른 워크트리여도 열지 않고 그 자리에서 따라간다. 그 워크트리를 열어
 * 스테이징하려면 따라가기 칸의 「이 워크트리 열기」를 쓴다.
 */
function useGraphSelection() {
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const startFollow = useFollowStore((s) => s.start);

  const selectWip = useCallback(
    (wip: GraphWip) => {
      startFollow(wip.path);
      setActiveTab("changes");
    },
    [startFollow, setActiveTab],
  );

  return { selectCommit, selectWip };
}

/** 경로 → 그 WIP 행을 따라가는 중이면 그 상태(따라가는 중·멈춤), 아니면 null. */
function useFollowModeOf(): (path: string) => FollowMode | null {
  const target = useFollowStore((s) => s.target);
  const mode = useFollowStore((s) => s.mode);
  return useCallback(
    (path: string) => (target !== null && normalizePath(target) === normalizePath(path) ? mode : null),
    [target, mode],
  );
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
  const followTarget = useFollowStore((s) => s.target);
  const followModeOf = useFollowModeOf();
  return (
    <>
      {wips.map((wip) => {
        const followed = activeTab === "changes" ? followModeOf(wip.path) : null;
        return (
          <GraphWipRow
            key={wip.path}
            leading={followed ? <FollowBadge mode={followed} /> : undefined}
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
            selected={activeTab === "changes" && (followTarget !== null ? followed !== null : wip.isCurrent)}
            connectDown={wip.isCurrent && headChain !== null}
            onSelect={() => selection.selectWip(wip)}
          />
        );
      })}
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

/* --- 저장소별 레인 모드(워크스페이스 리뷰, W4-T3) --- */

export interface RepoLaneCommitGraphProps {
  graph: RepoLaneGraph;
  /** 레인 순서대로의 저장소 경로. 레인 번호 → 색을 고르는 데 쓴다. */
  lanePaths: readonly string[];
  /** 저장소 경로 → 행 앞에 붙일 짧은 이름. */
  repoLabel: (repoPath: string) => string;
  /** 고른 행의 `key`(`RepoLaneRow.key`). */
  selectedKey: string | null;
  /** 가장 최근에 확인한 시각(epoch ms). 구분선 문구에 쓴다. */
  seenAt: number | null;
  /** 가장 가까운 갈라진 지점 커밋의 시각(epoch s). 모르면 null. */
  baseTime: number | null;
  /** 맨 아래 행의 기본 브랜치 표시(`main`, 저장소마다 다르면 `main, trunk`). */
  baseBranchLabel: string;
  isLoading: boolean;
  /** 그릴 행이 없을 때의 문구. 없으면 「갈라진 뒤 커밋 없음」. */
  emptyMessage?: string;
  onSelectCommit: (repoPath: string, commit: CommitInfo, key: string) => void;
  onSelectWip: (wip: LaneWip, key: string) => void;
}

/** 저장소 이름 표시. 레인 색의 옅은 배경에 레인 색 글자. */
export function RepoLaneTag({ repoPath, label }: { repoPath: string; label: string }) {
  const color = repoLaneColor(repoPath);
  return (
    <span
      className="shrink-0 max-w-[140px] truncate px-[7px] py-px rounded-[6px] text-[10.5px] font-bold"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      title={repoPath}
    >
      {label}
    </span>
  );
}

/**
 * 워크스페이스의 커밋 그래프. 레인 하나가 저장소 하나이고, 레인 색은 저장소 색으로 고정이다.
 * 맨 위에 커밋하지 않은 변경(WIP) 행, 새 커밋 점과 「여기까지 확인함」 구분선, 맨 아래에
 * 각 저장소가 main에서 갈라진 지점을 둔다. 행 계산은 `buildRepoLaneRows`가 한다.
 */
export function RepoLaneCommitGraph({
  graph,
  lanePaths,
  repoLabel,
  selectedKey,
  seenAt,
  baseTime,
  baseBranchLabel,
  isLoading,
  emptyMessage,
  onSelectCommit,
  onSelectWip,
}: RepoLaneCommitGraphProps) {
  const { t } = useTranslation();
  const accounts = useAccountStore((s) => s.accounts);
  const startFollow = useFollowStore((s) => s.start);
  const followModeOf = useFollowModeOf();
  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );
  const graphWidth = graphColumnWidth(graph.laneCount);
  const colorOf = useCallback(
    (chain: number) => (lanePaths[chain] ? repoLaneColor(lanePaths[chain]) : "var(--faint)"),
    [lanePaths],
  );

  const commitRows = useMemo(
    () => graph.rows.filter((r) => r.kind === "commit"),
    [graph.rows],
  );
  const selectedIdx = commitRows.findIndex((r) => r.key === selectedKey);
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: commitRows,
    onSelect: (r) => onSelectCommit(r.repoPath, r.commit, r.key),
    selectedIndex: selectedIdx,
  });
  const navIndex = new Map(commitRows.map((r, i) => [r.key, i]));

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
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
      <div className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        {isLoading && graph.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("history.loadingHistory")}</p>
        ) : graph.rows.length === 0 ? (
          <p className="py-6 px-4 text-center text-sm text-muted-foreground">{emptyMessage ?? t("review.noCommits")}</p>
        ) : (
          graph.rows.map((row) => {
            switch (row.kind) {
              case "wip": {
                const wt = row.wip.isMain ? null : worktreeName({ ...row.wip, isCurrent: false });
                const followed = selectedKey === row.key ? followModeOf(row.wip.path) : null;
                return (
                  <GraphWipRow
                    key={row.key}
                    wipLabel={t("review.wipLabel", { repo: repoLabel(row.repoPath), count: row.wip.count })}
                    worktreeName={wt}
                    count={row.wip.count}
                    changedAt={row.wip.changedAt}
                    color={repoLaneColor(row.repoPath)}
                    graphWidth={graphWidth}
                    selected={selectedKey === row.key}
                    connectDown={false}
                    layout={row.layout}
                    colorOf={colorOf}
                    leading={
                      <>
                        <RepoLaneTag repoPath={row.repoPath} label={repoLabel(row.repoPath)} />
                        {followed && <FollowBadge mode={followed} />}
                      </>
                    }
                    onSelect={() => {
                      startFollow(row.wip.path);
                      onSelectWip(row.wip, row.key);
                    }}
                  />
                );
              }
              case "commit": {
                const idx = navIndex.get(row.key) ?? -1;
                const emailKey = row.commit.author.email?.toLowerCase() ?? "";
                return (
                  <GraphRow
                    key={row.key}
                    ref={itemRef(idx)}
                    commit={row.commit}
                    layout={row.layout}
                    graphWidth={graphWidth}
                    colorOf={colorOf}
                    remoteTags={null}
                    avatarUrl={accountAvatarMap.get(emailKey) || undefined}
                    isSelected={selectedKey === row.key}
                    isHighlighted={activeIndex === idx}
                    isNew={row.isNew}
                    isSeen={row.isSeen}
                    wipAbove={false}
                    leading={<RepoLaneTag repoPath={row.repoPath} label={repoLabel(row.repoPath)} />}
                    onClick={() => onSelectCommit(row.repoPath, row.commit, row.key)}
                  />
                );
              }
              case "seen":
                return (
                  <SeenDivider
                    key={row.key}
                    seenAt={seenAt}
                    graphWidth={graphWidth}
                    through={row.through}
                    colorOf={colorOf}
                  />
                );
              case "base":
                return (
                  <BaseRow
                    key={row.key}
                    row={row}
                    graphWidth={graphWidth}
                    colorOf={colorOf}
                    baseTime={baseTime}
                    branchLabel={baseBranchLabel}
                  />
                );
            }
          })
        )}
      </div>
    </div>
  );
}

/** 맨 아래 행: 각 저장소 레인이 모이는 「main에서 갈라진 지점」. */
function BaseRow({
  row,
  graphWidth,
  colorOf,
  baseTime,
  branchLabel,
}: {
  branchLabel: string;
  row: Extract<RepoLaneGraph["rows"][number], { kind: "base" }>;
  graphWidth: number;
  colorOf: (chain: number) => string;
  baseTime: number | null;
}) {
  const { t } = useTranslation();
  const H = GRAPH_ROW_HEIGHT;
  return (
    <div
      className="flex items-center border-b border-(--line)"
      style={{ height: H }}
      data-testid="repo-lane-base"
    >
      <svg width={graphWidth} height={H} viewBox={`0 0 ${graphWidth} ${H}`} aria-hidden="true" className="shrink-0">
        {row.layout.edges.map((edge, i) => (
          <path
            key={i}
            d={edgePath(edge, 0)}
            stroke={colorOf(edge.chain)}
            strokeWidth={2}
            strokeOpacity={0.9}
            fill="none"
          />
        ))}
        <circle cx={laneX(0)} cy={H / 2} r={5} fill="var(--card)" stroke="var(--muted)" strokeWidth={2} />
      </svg>
      <span className={GRAPH_COLUMNS + " flex-1 min-w-0 pl-2 pr-3 text-[12.5px]"}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 shrink-0" />
          <span className="shrink-0 px-[7px] py-px rounded-[6px] bg-(--chip) text-[10.5px] font-bold text-(--fg2)">
            {branchLabel}
          </span>
          <span className="truncate text-(--fg2)">{t("review.baseRow")}</span>
        </span>
        <span />
        <span className="truncate text-[12px] text-muted-foreground">
          {baseTime !== null ? formatRelativeTime(baseTime) : null}
        </span>
        <span />
      </span>
    </div>
  );
}
