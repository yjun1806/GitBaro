import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useSeenMarkerMode, useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useToastStore } from "@/stores/toast";
import { useFollowStore, type FollowMode } from "@/stores/follow";
import { FollowBadge } from "@/components/live/FollowPanel";
import { WorkingChangesButton } from "@/components/commit/WorkingChangesButton";
import {
  useBranches,
  useCommitAvatars,
  useChangesVsDefaultOnHead,
  useCommitHistoryInfinite,
  useRemoteTags,
  useWorktreeHeadHistories,
} from "@/api/queries";
import { createBranch, type ResetMode } from "@/api/commands";
import { useCommitActions } from "@/hooks/useCommitActions";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { computeGraphLanes } from "@/lib/graph-lanes";
import { formatRelativeTime, getErrorMessage, gitHubRepoUrl } from "@/lib/utils";
import { CommitContextMenu } from "@/components/history/CommitContextMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { useWipRowMenu } from "./useWipRowMenu";
import { useRefLabelMenu } from "./useRefLabelMenu";
import { ResetCommitDialog } from "@/components/history/ResetCommitDialog";
import { CommitBranchDialog } from "@/components/history/CommitBranchDialog";
import type { CommitInfo, HistoryTarget } from "@/types";
import type { GraphRowLayout } from "@/lib/graph-lanes";
import {
  edgePath,
  ForkPointRow,
  GRAPH_COLUMNS,
  GraphRow,
  GraphWipRow,
  useSeenLabel,
  type CommitDot,
} from "./GraphRow";
import {
  edgesThroughBottom,
  forkPointIndex,
  GRAPH_ROW_HEIGHT,
  graphColumnWidth,
  laneColor,
  laneX,
  markNewCommits,
  normalizePath,
  visibleWipRows,
  wipTarget,
  type GraphWip,
} from "./graph-model";
import { repoLaneColor, type LaneWip, type RepoLaneGraph } from "./repo-lanes";
import { mergeHistories, wipLaneOid, withWipLanes, worktreeColor } from "./worktree-history";
import {
  branchColors,
  mutedChainNames,
  remoteBoundaryIndex,
  worktreeChainColors,
  type ShownWorktree,
} from "./graph-paint";
import { branchColorOf, MUTED_LANE } from "./lane-style";
import { BranchRangeGraph } from "@/components/branch/BranchRangeGraph";
import { activeRange, isStaleRange, useBranchRangeStore } from "@/components/branch/branch-range";

export interface CommitGraphProps {
  /** 맨 위 WIP 행(`useGraphReview`가 순서까지 정한 목록). */
  wips: GraphWip[];
  /** 지금 연 워크트리의 새 커밋 수와 새 커밋으로 센 커밋. 모르면 null. */
  newCommits: { newCount: number; ids: readonly string[] } | null;
  /** 지금 연 워크트리를 확인한 시각(epoch ms). */
  seenAt: number | null;
  /**
   * 칩 줄에서 고른 다른 워크트리의 HEAD(D5). 그 이력의 첫 페이지를 지금 연 워크트리의
   * 이력과 합쳐 한 그래프에 그린다. 없으면 지금 연 워크트리의 이력만.
   */
  worktreeHeads?: readonly WorktreeHead[];
  /**
   * 커밋 목록의 시작점. 기본은 HEAD(지금 체크아웃). 다른 브랜치나 모든 브랜치를 보면
   * 체크아웃하지 않고 그 이력을 그린다 — 그때는 main에서 갈라진 지점 행을 그리지 않고,
   * 커밋 메뉴의 reset·revert(체크아웃한 브랜치를 바꾸는 일)를 막는다.
   */
  historyTarget?: HistoryTarget;
}

/** 그래프에 함께 그릴 다른 워크트리. */
export interface WorktreeHead {
  path: string;
  /** HEAD 커밋. 바뀌면 이력을 다시 읽는다. */
  head: string;
}

const NO_WORKTREE_HEADS: readonly WorktreeHead[] = [];

/**
 * 위 패널의 커밋 그래프(단일 저장소). 전체 폭 레인 그래프로 HEAD의 이력을 그리고,
 * 맨 위에 워크트리마다 WIP 행, 새 커밋 점, 「여기까지 확인함」 구분선을 둔다.
 */
export function CommitGraph({ wips: allWips, ...rest }: CommitGraphProps) {
  const followTarget = useFollowStore((s) => s.target);
  // 커밋하지 않은 파일이 없는 워크트리의 「커밋하지 않은 변경 · 파일 0」 행은 숨긴다.
  const wips = useMemo(() => visibleWipRows(allWips, followTarget), [allWips, followTarget]);
  const props = { ...rest, wips, shownWips: allWips };
  const selection = useGraphSelection();
  const range = useActiveBranchRange();
  // 범위 모드(브랜치 패널의 「비교」): `base..target` 커밋만 그린다. WIP 행은 남긴다.
  if (range) {
    return (
      <BranchRangeGraph
        range={range.range}
        currentBranch={range.currentBranch}
        top={<WipRows wips={props.wips} selection={selection} graphWidth={graphColumnWidth(1)} />}
        onSelectCommit={selection.selectCommit}
      />
    );
  }
  return <CommitGraphList {...props} selection={selection} />;
}

/** 커밋 목록 칸이 받는 것: 그릴 WIP 행과, 칠할 워크트리(파일이 없어 WIP 행을 숨긴 워크트리 포함). */
type CommitGraphListProps = CommitGraphProps & { shownWips: readonly GraphWip[]; selection: GraphSelection };

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
  /**
   * WIP 행마다의 레인(`wipLaneOid(path)` → 레인). 있으면 WIP 행이 제 레인에 놓이고 그 워크트리의
   * HEAD 커밋까지 선으로 이어진다(D5). 없으면(범위·비교 화면) 첫 레인에 원만 그린다.
   */
  lanes?: ReadonlyMap<string, GraphRowLayout>;
  colorOf?: (chain: number) => string;
  /** 그래프에 그린 지금 연 워크트리의 HEAD(스캔보다 새 값). 브랜치가 없을 때 SHA 표시에 쓴다. */
  currentHead?: string | null;
}

/** 맨 위 WIP 행들. 워크트리마다 한 행. */
function WipRows({ wips, selection, graphWidth, lanes, colorOf, currentHead = null }: WipRowsProps) {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const followTarget = useFollowStore((s) => s.target);
  const followModeOf = useFollowModeOf();
  const menu = useWipRowMenu(selection.selectWip);
  return (
    <>
      {wips.map((wip) => {
        const followed = activeTab === "changes" ? followModeOf(wip.path) : null;
        return (
          <GraphWipRow
            key={wip.path}
            trailing={followed ? <FollowBadge mode={followed} /> : undefined}
            wipLabel={t("shell.uncommitted")}
            target={wipTarget({ ...wip, headOid: (wip.isCurrent ? currentHead : null) ?? wip.headOid ?? null })}
            count={wip.count}
            changedAt={wip.changedAt}
            color={worktreeColor(wip.path)}
            graphWidth={graphWidth}
            selected={activeTab === "changes" && (followTarget !== null ? followed !== null : wip.isCurrent)}
            connectDown={false}
            layout={lanes?.get(wipLaneOid(wip.path))}
            colorOf={lanes ? colorOf : undefined}
            // 지금 연 워크트리는 여기서 바로 커밋한다. 다른 워크트리는 행을 눌러 따라간 뒤 그 워크트리를 연다.
            action={wip.isCurrent && (wip.count ?? 0) > 0 ? <WorkingChangesButton count={wip.count ?? 0} /> : undefined}
            onSelect={() => selection.selectWip(wip)}
            onContextMenu={(e) => menu.open(wip, contextMenuPoint(e))}
          />
        );
      })}
      {menu.element}
    </>
  );
}

function CommitGraphList({
  newCommits,
  seenAt,
  wips,
  shownWips,
  worktreeHeads = NO_WORKTREE_HEADS,
  historyTarget,
  selection,
}: CommitGraphListProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const hasRemote = useRepositoryStore((s) => (s.activeRepo?.remotes.length ?? 0) > 0);
  // 검토 기준이 「원격에 없는 커밋」이면 커밋 점으로 원격에 있는지 보여 준다.
  const unpushedMode = !useSeenMarkerMode();
  const seenLabel = useSeenLabel();
  const colorSeed = useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath ?? "");
  const accounts = useAccountStore((s) => s.accounts);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const { selectCommit } = selection;
  const repoAccountId = useRepoAccountId();

  const { data: historyData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCommitHistoryInfinite(activeRepoPath, historyTarget);
  const viewing = historyTarget !== undefined && historyTarget.kind !== "head";
  const otherHistories = useWorktreeHeadHistories(worktreeHeads);
  // 결과 배열은 렌더마다 새로 오므로, 받은 데이터 묶음이 바뀔 때만 다시 합친다.
  const otherData = otherHistories.map((q) => q.data);
  const otherKey = otherHistories.map((q) => q.dataUpdatedAt).join(",");
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
  // WIP 행마다 제 레인을 연다(D5). 부모는 그 워크트리의 HEAD — 지금 연 워크트리는 제 이력의 첫 커밋.
  const ownHead = historyData?.pages[0]?.[0]?.id ?? null;
  const wipLanes = useMemo(() => {
    const headOf = new Map(worktreeHeads.map((h) => [h.path, h.head]));
    return wips.map((w) => ({ path: w.path, head: w.isCurrent ? ownHead : (headOf.get(w.path) ?? null) }));
  }, [wips, worktreeHeads, ownHead]);
  const wipLaneKey = wipLanes.map((w) => `${w.path}\u0000${w.head ?? ""}`).join("\u0001");

  // 그래프에 함께 그리는 워크트리(지금 연 워크트리가 먼저). 그 워크트리의 줄기와 브랜치 이름표를 그 색으로 칠한다.
  const shown = useMemo<ShownWorktree[]>(() => {
    const headOf = new Map(worktreeHeads.map((h) => [h.path, h.head]));
    return [...shownWips]
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
      .map((w) => ({ path: w.path, branch: w.branch, head: w.isCurrent ? ownHead : (headOf.get(w.path) ?? null) }));
  }, [shownWips, worktreeHeads, ownHead]);
  const shownKey = shown.map((w) => `${w.path}\u0000${w.branch ?? ""}\u0000${w.head ?? ""}`).join("\u0001");

  const { commits, layouts, graphWidth, ownIds, chainColors, mutedNames } = useMemo(() => {
    const own = historyData?.pages.flat() ?? [];
    // 다른 워크트리의 커밋을 시간순으로 끼워 넣는다(D5). 각 이력 안의 순서는 그대로다.
    const all = mergeHistories(
      own,
      otherData.map((d) => d ?? []),
      hasNextPage !== true,
    );
    const result = computeGraphLanes(withWipLanes(wipLanes, all));
    const byOid = new Map(result.rows.map((r) => [r.oid, r]));
    const kept = new Set<string>();
    const drawn = all.filter((c) => {
      if (!byOid.has(c.id) || kept.has(c.id)) return false;
      kept.add(c.id);
      return true;
    });
    const maxLanes = result.rows.reduce((m, r) => Math.max(m, r.width), 1);
    // 워크트리 하나에 색 하나: 그 워크트리의 WIP 행과 HEAD 줄기는 칩 견본과 같은 색, 나머지는 회색이다.
    const colors = worktreeChainColors(byOid, shown);
    return {
      commits: drawn,
      layouts: byOid,
      graphWidth: graphColumnWidth(maxLanes),
      ownIds: new Set(own.map((c) => c.id)),
      chainColors: colors,
      mutedNames: mutedChainNames(drawn, byOid, colors),
    };
    // otherKey·wipLaneKey·shownKey가 다른 워크트리 이력, WIP 행, 칠할 워크트리 목록의 내용을 대신 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyData, hasNextPage, otherKey, wipLaneKey, shownKey]);

  const marks = useMemo(
    () => markNewCommits(commits, newCommits),
    [commits, newCommits],
  );
  // 「main에서 갈라진 지점」 행(D4). 「파일별 변경」 배지와 같은 조회(HEAD가 바뀔 때만 다시 읽음)를 쓴다.
  // 보는 중이면 그리지 않는다 — 그 기준(main 대비)은 체크아웃한 HEAD의 것이다.
  const forkEntries = useMemo(
    () => (activeRepoPath && !viewing ? [{ path: activeRepoPath, headOid: ownHead }] : []),
    [activeRepoPath, ownHead, viewing],
  );
  const changes = useChangesVsDefaultOnHead(forkEntries)[0]?.data;
  const forkIdx = forkPointIndex(commits, changes);
  // 체크아웃하지 않고 다른 브랜치를 보는 중이면 워크트리와 상관없는 이력이라 예전처럼 저장소 색조로 칠한다.
  const colorOf = useCallback(
    (chain: number) => chainColors.get(chain) ?? (viewing ? laneColor(colorSeed, chain) : MUTED_LANE),
    [colorSeed, chainColors, viewing],
  );
  const laneTitle = useCallback(
    (chain: number) => {
      if (viewing || !mutedNames.has(chain)) return undefined;
      return mutedNames.get(chain) ?? t("graph.laneMerged");
    },
    [viewing, mutedNames, t],
  );
  const colorByBranch = useMemo(() => branchColors(viewing ? [] : shown), [viewing, shown]);
  const refColor = useCallback(
    (label: { name: string; kind: string }) =>
      label.kind === "tag" ? null : branchColorOf(label.name, label.kind === "remoteBranch", colorByBranch),
    [colorByBranch],
  );
  const markRemote = unpushedMode && hasRemote;
  const dotOf = (commit: CommitInfo): CommitDot =>
    !markRemote || commit.isUnpushed === undefined ? "plain" : commit.isUnpushed ? "unpushed" : "pushed";
  const boundaryIdx = useMemo(
    () => (markRemote ? remoteBoundaryIndex(commits, (id) => ownIds.has(id)) : null),
    [markRemote, commits, ownIds],
  );

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
  const refMenu = useRefLabelMenu();


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

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        {viewing ? (
          <ViewingNote />
        ) : (
          <WipRows
            wips={wips}
            selection={selection}
            graphWidth={graphWidth}
            lanes={layouts}
            colorOf={colorOf}
            currentHead={ownHead}
          />
        )}

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
                {forkIdx === index && changes?.defaultBranch && (
                  <ForkPointRow
                    branch={changes.defaultBranch}
                    timestamp={commit.timestamp}
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
                  wipAbove={false}
                  dot={dotOf(commit)}
                  laneTitle={laneTitle}
                  refColor={refColor}
                  remoteBoundary={boundaryIdx === index}
                  // 「여기까지 확인함」은 전체 폭 줄 대신 확인한 첫 커밋의 레인에 눈금으로 단다.
                  seenTick={marks.dividerBefore === index ? seenLabel(seenAt) : null}
                  onClick={() => selectCommit(commit.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    selectCommit(commit.id);
                    const point = contextMenuPoint(e);
                    menu.open(commit, point.x, point.y, !viewing && ownIds.has(commit.id));
                  }}
                  onRefContextMenu={(label, e) => refMenu.open(label, contextMenuPoint(e))}
                />
              </Fragment>
            );
          })
        )}
        <div ref={loadMoreRef} />
        {isFetchingNextPage && (
          <div className="flex items-center justify-center py-3 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
      </div>

      {menu.element}
      {refMenu.element}
    </div>
  );
}


/** 보는 중에 WIP 행 자리에 두는 안내. 커밋 안 한 변경은 체크아웃한 작업 트리의 것이다. */
function ViewingNote() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center h-7 px-3.5 border-b border-(--line) text-[11.5px] text-muted-foreground bg-(--acc-faint)">
      {t("historyView.wipHidden")}
    </p>
  );
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
  const [target, setTarget] = useState<{ commit: CommitInfo; x: number; y: number; inHistory: boolean } | null>(
    null,
  );
  const [resetTarget, setResetTarget] = useState<CommitInfo | null>(null);
  const [branchTarget, setBranchTarget] = useState<CommitInfo | null>(null);
  const gitHubUrl = useRepositoryStore((s) => gitHubRepoUrl(s.activeRepo?.remotes ?? []));

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
          commit={target.commit}
          gitHubUrl={gitHubUrl}
          git={{
            onCreateBranch: () => setBranchTarget(target.commit),
            onCheckout: () =>
              void confirmThen(
                t("history.checkoutConfirm", { shortId: target.commit.shortId }),
                t("history.contextMenu.checkout"),
                () => checkout(target.commit.id),
              ),
            onReset: () => setResetTarget(target.commit),
            onRevert: () =>
              void confirmThen(
                // 병합 커밋은 첫 번째 부모 기준으로 되돌린다(백엔드가 -m 1 사용).
                t(target.commit.parentIds.length > 1 ? "history.revertMergeConfirm" : "history.revertConfirm", {
                  shortId: target.commit.shortId,
                }),
                t("history.contextMenu.revert"),
                () => revert(target.commit.id),
              ),
            onCherryPick: () =>
              void confirmThen(
                t("history.cherryPickConfirm", { shortId: target.commit.shortId }),
                t("history.contextMenu.cherryPick"),
                () => cherryPick(target.commit.id),
              ),
          }}
          notInHistory={!target.inHistory}
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
    /**
     * `inHistory`: 지금 연 워크트리의 이력에 있는 커밋인지. 칩으로 함께 그린 다른 워크트리의
     * 커밋이면(D5) 이 워크트리를 그 커밋으로 옮기는 reset·revert를 막는다.
     */
    open: (commit: CommitInfo, x: number, y: number, inHistory = true) => setTarget({ commit, x, y, inHistory }),
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
  const seenLabel = useSeenLabel();
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
  // 커밋 우클릭: 복사·GitHub 보기만 있는 메뉴. 여러 저장소의 커밋이라 체크아웃·reset 같은 동작은
  // 그 저장소 화면에서 한다.
  const repos = useRepositoryStore((s) => s.repos);
  const [commitMenu, setCommitMenu] = useState<{ commit: CommitInfo; repoPath: string; x: number; y: number } | null>(
    null,
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
                const followed = selectedKey === row.key ? followModeOf(row.wip.path) : null;
                return (
                  <GraphWipRow
                    key={row.key}
                    wipLabel={t("shell.uncommitted")}
                    ariaContext={repoLabel(row.repoPath)}
                    target={wipTarget(row.wip)}
                    count={row.wip.count}
                    changedAt={row.wip.changedAt}
                    color={repoLaneColor(row.repoPath)}
                    graphWidth={graphWidth}
                    selected={selectedKey === row.key}
                    connectDown={false}
                    layout={row.layout}
                    colorOf={colorOf}
                    leading={<RepoLaneTag repoPath={row.repoPath} label={repoLabel(row.repoPath)} />}
                    trailing={followed ? <FollowBadge mode={followed} /> : undefined}
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
                    seenTick={row.seenTick ? seenLabel(seenAt) : null}
                    wipAbove={false}
                    leading={<RepoLaneTag repoPath={row.repoPath} label={repoLabel(row.repoPath)} />}
                    onClick={() => onSelectCommit(row.repoPath, row.commit, row.key)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onSelectCommit(row.repoPath, row.commit, row.key);
                      setCommitMenu({ commit: row.commit, repoPath: row.repoPath, ...contextMenuPoint(e) });
                    }}
                  />
                );
              }
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
      {commitMenu && (
        <CommitContextMenu
          commit={commitMenu.commit}
          gitHubUrl={gitHubRepoUrl(repos.find((r) => r.path === commitMenu.repoPath)?.remotes ?? [])}
          position={{ x: commitMenu.x, y: commitMenu.y }}
          onClose={() => setCommitMenu(null)}
        />
      )}
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
