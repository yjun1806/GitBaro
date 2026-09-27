import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { ask } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useToastStore } from "@/stores/toast";
import { useFollowStore, type FollowMode } from "@/stores/follow";
import { WorkingChangesButton } from "@/components/commit/WorkingChangesButton";
import { useNow } from "@/hooks/useNow";
import {
  commitStatsAcrossReposKey,
  useBranches,
  useCommitAvatars,
  useCommitStats,
  useCommitStatsAcrossRepos,
  useDivergencePoint,
  useCommitHistoryInfinite,
  useRemoteTags,
  useWorktreeHeadHistories,
} from "@/api/queries";
import { createBranch, type ResetMode } from "@/api/commands";
import { useCommitActions } from "@/hooks/useCommitActions";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { computeGraphLanes } from "@/lib/graph-lanes";
import { formatRelativeTime, getErrorMessage, gitHubRepoUrl, trimTrailingSlash } from "@/lib/utils";
import { CommitContextMenu } from "@/components/history/CommitContextMenu";
import { summarizeCi, type CiSummary } from "@/components/history/CommitDetail";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { useWipRowMenu } from "./useWipRowMenu";
import { useRefLabelMenu } from "./useRefLabelMenu";
import { useNewCommits } from "./useNewCommits";
import { ResetCommitDialog } from "@/components/history/ResetCommitDialog";
import { CommitBranchDialog } from "@/components/history/CommitBranchDialog";
import type { CommitInfo, CommitStats, HistoryTarget, RefLabel, WorkflowRun } from "@/types";
import type { GraphRowLayout } from "@/lib/graph-lanes";
import {
  BaseHeaderRow,
  edgePath,
  followRowParts,
  GRAPH_COLUMNS,
  GraphRow,
  GraphWipRow,
  NowHeaderRow,
  RemoteHeaderRow,
  UnpushedHeaderRow,
  type CommitDot,
} from "./GraphRow";
import {
  edgesThroughBottom,
  forkPointIndex,
  GRAPH_ROW_HEIGHT,
  graphColumnWidth,
  laneColor,
  laneX,
  visibleWipRows,
  wipTarget,
  type GraphWip,
} from "./graph-model";
import { repoLaneColor, type LaneWip, type RepoLaneGraph, type RepoLaneRow } from "./repo-lanes";
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
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { RefLabel as RefLabelMark, StatusChip } from "@/components/ui/marks";

export interface CommitGraphProps {
  /** 맨 위 WIP 행(`useGraphReview`가 순서까지 정한 목록). */
  wips: GraphWip[];
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
  /**
   * 커밋 줄 「CI」 칸(3.15)의 재료. 이미 불러온 워크플로 실행 목록을 그대로 받는다 — 이 컴포넌트는
   * 새로 조회하지 않는다(`GraphPanel`이 Actions 탭과 같은 조회를 공유한다). 없으면 CI 칸은 비운다.
   */
  ciRuns?: readonly WorkflowRun[];
}

/** 그래프에 함께 그릴 다른 워크트리. */
export interface WorktreeHead {
  path: string;
  /** HEAD 커밋. 바뀌면 이력을 다시 읽는다. */
  head: string;
}

const NO_WORKTREE_HEADS: readonly WorktreeHead[] = [];
const NO_CI_RUNS: readonly WorkflowRun[] = [];

/**
 * 위 패널의 커밋 그래프(단일 저장소). 전체 폭 레인 그래프로 HEAD의 이력을 그리고,
 * 맨 위에 워크트리마다 WIP 행을 둔다.
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
    (path: string) => (target !== null && trimTrailingSlash(target) === trimTrailingSlash(path) ? mode : null),
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
  const stopFollow = useFollowStore((s) => s.stop);
  const menu = useWipRowMenu(selection.selectWip);
  // 「N초 전 바뀜」 안내가 흐르도록 1초마다 다시 그린다.
  const now = useNow(1_000);
  return (
    <>
      {wips.map((wip) => {
        const followed = activeTab === "changes" ? followModeOf(wip.path) : null;
        const following = followed === "following";
        const { trailing, followButton, live } = followRowParts(t, now, wip.changedAt, wip.count, following, () =>
          following ? stopFollow() : selection.selectWip(wip),
        );
        return (
          <GraphWipRow
            key={wip.path}
            trailing={trailing}
            live={live}
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
            action={
              <>
                {followButton}
                {wip.isCurrent && (wip.count ?? 0) > 0 && <WorkingChangesButton />}
              </>
            }
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
  wips,
  shownWips,
  worktreeHeads = NO_WORKTREE_HEADS,
  historyTarget,
  ciRuns = NO_CI_RUNS,
  selection,
}: CommitGraphListProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const hasRemote = useRepositoryStore((s) => (s.activeRepo?.remotes.length ?? 0) > 0);
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
  const { data: githubAvatarMap } = useCommitAvatars(activeRepoPath);

  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );

  // 레인은 불러온 전체 이력으로 계산한다(1만 행 속도는 `graph-lanes` 테스트가 잰다).
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

  // 기본 브랜치 머리(「main」, D4). `divergencePointKey`와 같은 조회(HEAD가 바뀔 때만 다시 읽음)를 쓴다.
  // 보는 중이면 그리지 않는다 — 그 기준(main 대비)은 체크아웃한 HEAD의 것이다.
  const { data: changes } = useDivergencePoint(activeRepoPath && !viewing ? activeRepoPath : null, ownHead);
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
  // 한 번도 fetch하지 않은 저장소: 원격은 있지만 원격 추적 브랜치가 하나도 없으면 모든 커밋이
  // isUnpushed=true로 온다 — 판정은 맞아도 전체가 칠해져 강조 효과가 사라지므로 tint·머리를 모두 끈다
  // (점 모양만 「원격 없음」과 같은 plain으로 둔다). `useBranches`는 사이드바 등과 같은 키를 쓴다.
  const { data: branches } = useBranches(activeRepoPath);
  const neverFetched = hasRemote && branches !== undefined && !branches.some((b) => b.isRemote);
  // 원격이 있고 fetch한 적 있을 때만 「원격에 있는지」를 그린다: 원격에 없는 커밋은 옅은 띠 행, 그
  // 위(WIP 행 아래)에 「올리지 않은 작업」 머리, 원격에 있는 첫 커밋 위에 「origin에 있음」 머리.
  // 점 모양은 모두 같다(채운 점). 개수는 사이드바의 ↑N과 Push 버튼이 맡는다.
  const markRemote = hasRemote && !neverFetched;
  const dotOf = (commit: CommitInfo): CommitDot =>
    !markRemote || commit.isUnpushed === undefined ? "plain" : commit.isUnpushed ? "unpushed" : "pushed";
  // 경계 위치는 지금 연 워크트리 자신의 이력만 보고 정한다(graph-paint.ts). `ownIds`로 어느 행이
  // 자신의 커밋인지 표시한다.
  const boundaryIdx = useMemo(
    () =>
      markRemote
        ? remoteBoundaryIndex(commits.map((c) => ({ isUnpushed: c.isUnpushed, isOwn: ownIds.has(c.id) })))
        : null,
    [markRemote, commits, ownIds],
  );
  // 「올리지 않은 작업」 머리 자리: 경계(boundaryIdx)를 그릴 수 있을 때만, 첫 미반영 커밋 위. 저장소
  // 단계에서 함께 그리는 다른 워크트리의 커밋도 센다 — 그 레인의 올리지 않은 커밋이 머리 위로 올라가지 않게.
  // 경계를 그리지 못하면(교정 규칙) 이 머리도 그리지 않는다 — 행 바탕 틴트만 남는다.
  const unpushedIdx = useMemo(
    () => (boundaryIdx !== null ? commits.findIndex((c) => c.isUnpushed === true) : -1),
    [boundaryIdx, commits],
  );
  // 머리 행의 이름표: 「원격에 없음」은 어느 원격에도 없다는 뜻이라, 원격이 여럿이면 이름을 고르지 않는다.
  const remotes = useRepositoryStore((s) => s.activeRepo?.remotes);
  const remoteLabel = remotes?.length === 1 ? remotes[0].name : t("graph.anyRemote");
  // 「origin에 있음」 머리의 브랜치 표시: 체크아웃/보는 브랜치(`changes.branch`)가 아니라 경계
  // 커밋 자신에게 실제로 달린 원격 브랜치 이름표를 쓴다 — 체크아웃한 브랜치가 원격에 없어도(#6)
  // 엉뚱하게 「그 브랜치가 원격에 있다」고 보이지 않는다. 원격이 하나면 그 원격의 이름표만 본다.
  const boundaryRemoteRef = useMemo(() => {
    if (boundaryIdx === null) return undefined;
    const remoteRefs = (commits[boundaryIdx]?.refs ?? []).filter((r) => r.kind === "remoteBranch");
    if (remotes?.length === 1) {
      return remoteRefs.find((r) => r.name.startsWith(`${remotes[0].name}/`))?.name;
    }
    return remoteRefs[0]?.name;
  }, [boundaryIdx, commits, remotes]);


  // 줄기 강조(D6): 고른 커밋의 줄기, 없으면 마우스 올린 커밋의 줄기. 미리보기는 선택보다 앞선다.
  const [hoveredCommitId, setHoveredCommitId] = useState<string | null>(null);
  const selectedChain = selectedCommitId ? (layouts.get(selectedCommitId)?.chain ?? null) : null;
  const hoveredChain = hoveredCommitId ? (layouts.get(hoveredCommitId)?.chain ?? null) : null;
  const highlightChain = hoveredChain ?? selectedChain;
  // 강조 칩의 이름: 그 줄기에 브랜치 이름표가 달린 커밋이 있으면 그 이름, 없으면(merge된 줄기)
  // `laneTitle`이 이미 계산해 둔 이름. 선택이 바뀔 때만 다시 찾는다(가상화 없이도 값싸게 유지).
  const chainLabel = useMemo(() => {
    if (highlightChain === null) return undefined;
    const named = commits.find(
      (c) => layouts.get(c.id)?.chain === highlightChain && c.refs.some((r) => r.kind !== "tag"),
    );
    const ref = named?.refs.find((r) => r.kind !== "tag");
    return ref?.name ?? laneTitle(highlightChain) ?? t("graph.laneMerged");
  }, [highlightChain, commits, layouts, laneTitle, t]);
  // 이름 칩을 붙일 행: 마우스로 미리보기 중이면 그 행, 아니면 고른 행(#3) — 둘을 뒤섞지 않는다.
  const chainLabelAnchorId = hoveredCommitId ?? selectedCommitId;

  // WIP 행부터 첫 커밋까지 이어지는 선(머리 행이 WIP 바로 아래에 낄 때 쓴다).
  const currentWipOid = useMemo(() => {
    const current = wips.find((w) => w.isCurrent);
    return current ? wipLaneOid(current.path) : null;
  }, [wips]);
  const throughAt = useCallback(
    (index: number): readonly { lane: number; chain: number }[] => {
      if (index > 0) {
        const prev = layouts.get(commits[index - 1].id);
        return prev ? edgesThroughBottom(prev.edges) : [];
      }
      if (viewing || currentWipOid === null) return [];
      const wipLayout = layouts.get(currentWipOid);
      return wipLayout ? edgesThroughBottom(wipLayout.edges) : [];
    },
    [commits, layouts, viewing, currentWipOid],
  );

  const selectedIdx = useMemo(
    () => commits.findIndex((c) => c.id === selectedCommitId),
    [commits, selectedCommitId],
  );
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: commits,
    // 방향키로 옮기면 마우스 미리보기를 지운다(#3) — 강조가 고른 행을 따라가게 한다.
    onSelect: (c) => {
      setHoveredCommitId(null);
      selectCommit(c.id);
    },
    selectedIndex: selectedIdx,
  });

  // 따라가는 중에 새로 나타난 커밋(에이전트가 커밋함)을 한 번 비춘다. 다른 저장소·다른 브랜치 보기·
  // 함께 그리는 워크트리가 바뀌어 목록이 통째로 바뀔 때는 비추지 않는다(경로만 비교한다 — HEAD가
  // 바뀌어 그 워크트리의 이력을 다시 읽는 것은 「새 커밋」이다).
  const followTarget = useFollowStore((s) => s.target);
  const commitIds = useMemo(() => commits.map((c) => c.id), [commits]);
  // 커밋 줄 「변경」 칸(3.15). 보이는(불러온) 커밋의 oid만 넘긴다 — 아직 모르는 커밋은 빠지고, 그
  // 자리는 `ChangeCell`이 빈 칸으로 둔다.
  const commitStats = useCommitStats(activeRepoPath, commitIds);
  // 「CI」 칸. 이미 불러온 실행 목록에서 커밋마다 최신 상태만 뽑는다(`CommitDetail`과 같은 규칙).
  const ciByCommit = useMemo(() => {
    if (ciRuns.length === 0) return new Map<string, CiSummary | null>();
    return new Map(commitIds.map((id) => [id, summarizeCi(ciRuns as WorkflowRun[], id)]));
  }, [commitIds, ciRuns]);
  const shownPathsKey = worktreeHeads
    .map((h) => h.path)
    .sort()
    .join("\u0001");
  // 자신의 이력은 먼저, 함께 그리는 다른 워크트리의 이력(`useWorktreeHeadHistories`)은 나중에 올 수
  // 있다 — 그 사이에 목록에 끼어드는 커밋을 「방금 생긴 커밋」으로 잘못 비추지 않으려면, 다 불러올
  // 때까지는 기록만 하게 한다(useNewCommits.ts).
  const otherHistoriesReady = otherHistories.every((q) => q.isSuccess);
  const newCommits = useNewCommits(
    commitIds,
    `${activeRepoPath ?? ""}\u0000${JSON.stringify(historyTarget ?? null)}\u0000${shownPathsKey}`,
    followTarget !== null,
    otherHistoriesReady,
  );

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
  const openCommitMenu = menu.open;
  const openRefMenu = refMenu.open;
  // 행은 `memo`라, 콜백이 렌더마다 바뀌지 않아야 고른 행·강조 행만 다시 그린다.
  const handleRowContextMenu = useCallback(
    (commit: CommitInfo, e: MouseEvent) => {
      e.preventDefault();
      selectCommit(commit.id);
      const point = contextMenuPoint(e);
      openCommitMenu(commit, point.x, point.y, !viewing && ownIds.has(commit.id));
    },
    [selectCommit, openCommitMenu, viewing, ownIds],
  );
  const handleRefContextMenu = useCallback(
    (label: RefLabel, e: MouseEvent) => openRefMenu(label, contextMenuPoint(e)),
    [openRefMenu],
  );

  return (
    <div className="@container/graph flex flex-col flex-1 min-h-0 overflow-hidden">
      <div
        className={GRAPH_COLUMNS + " h-6 shrink-0 pr-3 border-b border-(--line) text-[11.5px] font-semibold text-muted-foreground"}
        style={{ paddingLeft: graphWidth + 8 }}
        aria-hidden="true"
      >
        <span className="pl-3.5">{t("graph.colDescription")}</span>
        <span>{t("graph.colChange")}</span>
        <span title={t("graph.colCi")}>{t("graph.colCi")}</span>
        <span>{t("graph.colAuthor")}</span>
        <span>{t("graph.colTime")}</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        {viewing ? (
          <ViewingNote />
        ) : (
          <>
            {/* 「지금」 영역 머리(D48): 보일 WIP 행이 있을 때만 그 위에 둔다. */}
            {wips.length > 0 && <NowHeaderRow graphWidth={graphWidth} through={[]} colorOf={colorOf} />}
            <WipRows
              wips={wips}
              selection={selection}
              graphWidth={graphWidth}
              lanes={layouts}
              colorOf={colorOf}
              currentHead={ownHead}
            />
          </>
        )}

        {isLoading ? (
          <LoadingState label={t("history.loadingHistory")} />
        ) : commits.length === 0 ? (
          <EmptyState layout="row" title={t("history.noCommits")} />
        ) : (
          commits.map((commit, index) => {
            const layout = layouts.get(commit.id);
            if (!layout) return null;
            const emailKey = commit.author.email?.toLowerCase() ?? "";
            const through = throughAt(index);
            return (
              <Fragment key={commit.id}>
                {/* 영역 머리는 그 영역 맨 위에 둔다: 올리지 않은 작업 → origin에 있음 → 기본 브랜치.
                    두 머리가 같은 커밋 위에 오면(새 브랜치를 아직 push 안 함) origin이 위, 기본 브랜치가 아래다. */}
                {unpushedIdx === index && (
                  <UnpushedHeaderRow
                    remote={remoteLabel}
                    graphWidth={graphWidth}
                    through={through}
                    colorOf={colorOf}
                  />
                )}
                {boundaryIdx === index && (
                  <RemoteHeaderRow
                    remote={remoteLabel}
                    branch={boundaryRemoteRef}
                    graphWidth={graphWidth}
                    through={through}
                    colorOf={colorOf}
                  />
                )}
                {forkIdx === index && changes?.defaultBranch && (
                  <BaseHeaderRow
                    branch={changes.defaultBranch}
                    timestamp={commit.timestamp}
                    graphWidth={graphWidth}
                    through={through}
                    colorOf={colorOf}
                  />
                )}
                <HistoryGraphRow
                  index={index}
                  itemRef={itemRef}
                  commit={commit}
                  layout={layout}
                  graphWidth={graphWidth}
                  colorOf={colorOf}
                  remoteTags={remoteTags}
                  avatarUrl={accountAvatarMap.get(emailKey) || githubAvatarMap?.[emailKey] || undefined}
                  stats={commitStats.get(commit.id)}
                  ci={ciByCommit.get(commit.id) ?? null}
                  isSelected={selectedCommitId === commit.id}
                  isHighlighted={activeIndex === index}
                  dot={dotOf(commit)}
                  laneTitle={laneTitle}
                  refColor={refColor}
                  flash={newCommits.has(commit.id)}
                  highlightChain={highlightChain}
                  chainLabel={chainLabel}
                  chainLabelHere={commit.id === chainLabelAnchorId}
                  onSelect={selectCommit}
                  onRowContextMenu={handleRowContextMenu}
                  onRefContextMenu={handleRefContextMenu}
                  onHoverChange={setHoveredCommitId}
                />
              </Fragment>
            );
          })
        )}
        <div ref={loadMoreRef} />
        {isFetchingNextPage && (
          <LoadingState layout="row" className="justify-center" />
        )}
      </div>

      {menu.element}
      {refMenu.element}
    </div>
  );
}


/**
 * 보는 중에 WIP 행 자리에 두는 안내. 커밋 안 한 변경은 체크아웃한 작업 트리의 것이다.
 * `Notice`(3.7)의 `neutral banner` 모양을 그대로 쓰되, `Notice`는 항상 `role="status"`를
 * 붙인다 — 이 줄 위의 `GitStatusLine`이 이미 그 role을 쓰고 있어(보는 중 띠) 겹치면 화면
 * 읽기 프로그램과 테스트의 `getByRole("status")`가 둘을 구분하지 못한다. 그래서 컴포넌트
 * 대신 같은 모양만 손으로 그린다.
 */
function ViewingNote() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 px-3 py-2 border-b border-(--line) bg-(--chip) text-[11.5px] text-(--fg2)">
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

  const open = useCallback(
    (commit: CommitInfo, x: number, y: number, inHistory = true) => setTarget({ commit, x, y, inHistory }),
    [],
  );

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
    open,
    element,
  };
}

interface HistoryGraphRowProps {
  index: number;
  itemRef: (index: number) => (el: HTMLElement | null) => void;
  commit: CommitInfo;
  layout: GraphRowLayout;
  graphWidth: number;
  colorOf: (chain: number) => string;
  remoteTags: Set<string> | null;
  avatarUrl: string | undefined;
  /** 「변경」 칸(3.15). 아직 모르면 비워 둔다. */
  stats: CommitStats | undefined;
  /** 「CI」 칸. 실행 기록이 없으면 null. */
  ci: CiSummary | null;
  isSelected: boolean;
  isHighlighted: boolean;
  dot: CommitDot;
  laneTitle: (chain: number) => string | undefined;
  refColor: (label: RefLabel) => string | null;
  /** 따라가는 중에 새로 나타난 커밋이면 한 번 비춘다. */
  flash: boolean;
  /** 지금 강조 중인 줄기(고른 커밋의 줄기, 없으면 마우스 올린 줄기). 없으면 강조 없음. */
  highlightChain: number | null;
  /** 강조 중인 줄기의 브랜치 이름. 미리보기 중이면 마우스 올린 행에, 아니면 고른 행에 붙인다. */
  chainLabel?: string;
  /** 이 행이 이름 칩을 붙일 행인지(#3, 미리보기·선택을 뒤섞지 않는다). */
  chainLabelHere: boolean;
  onSelect: (commitId: string) => void;
  onRowContextMenu: (commit: CommitInfo, e: MouseEvent) => void;
  onRefContextMenu: (label: RefLabel, e: MouseEvent) => void;
  /** 마우스를 올리면 그 커밋의 id, 떼면 null(줄기 강조 미리보기). */
  onHoverChange: (commitId: string | null) => void;
}

/**
 * 커밋 목록의 한 행. 활동 이벤트나 선택이 바뀔 때 불러온 모든 행이 다시 그려지지 않도록
 * `memo`로 감싸고, 행마다 다른 콜백은 커밋 id·커밋을 받는 공통 콜백으로 바꿔 넘긴다.
 */
const HistoryGraphRow = memo(function HistoryGraphRow({
  index,
  itemRef,
  commit,
  onSelect,
  onRowContextMenu,
  onHoverChange,
  ...rest
}: HistoryGraphRowProps) {
  const ref = useMemo(() => itemRef(index), [itemRef, index]);
  return (
    <GraphRow
      {...rest}
      ref={ref}
      commit={commit}
      wipAbove={false}
      onClick={() => onSelect(commit.id)}
      onContextMenu={(e) => onRowContextMenu(commit, e)}
      onMouseEnter={() => onHoverChange(commit.id)}
      onMouseLeave={() => onHoverChange(null)}
    />
  );
});

/* --- 저장소별 레인 모드(워크스페이스 리뷰, W4-T3) --- */

export interface RepoLaneCommitGraphProps {
  graph: RepoLaneGraph;
  /** 레인 순서대로의 저장소 경로. 레인 번호 → 색을 고르는 데 쓴다. */
  lanePaths: readonly string[];
  /** 저장소 경로 → 행 앞에 붙일 짧은 이름. */
  repoLabel: (repoPath: string) => string;
  /** 고른 행의 `key`(`RepoLaneRow.key`). */
  selectedKey: string | null;
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

/** 저장소 이름 표시. 레인 색의 옅은 배경에 레인 색 글자(`RefLabel`의 레인 색 채움을 그대로 쓴다). */
export function RepoLaneTag({ repoPath, label }: { repoPath: string; label: string }) {
  const color = repoLaneColor(repoPath);
  return <RefLabelMark name={label} kind="worktree" laneColor={color} className="max-w-[140px]" />;
}

/**
 * 워크스페이스의 커밋 그래프. 레인 하나가 저장소 하나이고, 레인 색은 저장소 색으로 고정이다.
 * 맨 위에 커밋하지 않은 변경(WIP) 행, 맨 아래에 각 저장소가 main에서 갈라진 지점을 둔다. 행 계산은 `buildRepoLaneRows`가 한다.
 */
export function RepoLaneCommitGraph({
  graph,
  lanePaths,
  repoLabel,
  selectedKey,
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
  const stopFollow = useFollowStore((s) => s.stop);
  const followModeOf = useFollowModeOf();
  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );
  const graphWidth = graphColumnWidth(graph.laneCount);
  const colorOf = useCallback(
    (chain: number) => (lanePaths[chain] ? repoLaneColor(lanePaths[chain]) : "var(--muted)"),
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
  // 커밋 줄 「변경」 칸(3.15). 저장소마다 다른 경로라 `useCommitStats`(단일 경로) 대신 경로+oid
  // 쌍으로 묻는 변형을 쓴다. CI 칸은 저장소마다 계정이 다를 수 있어 이 화면에서는 비워 둔다.
  const commitStats = useCommitStatsAcrossRepos(
    useMemo(() => commitRows.map((r) => ({ path: r.repoPath, oid: r.commit.id })), [commitRows]),
  );
  const selectedIdx = commitRows.findIndex((r) => r.key === selectedKey);
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: commitRows,
    onSelect: (r) => onSelectCommit(r.repoPath, r.commit, r.key),
    selectedIndex: selectedIdx,
  });
  const navIndex = new Map(commitRows.map((r, i) => [r.key, i]));
  // 커밋 행에 안정된 참조로 넘긴다(#4) — `.map()` 밖에서 한 번만 만들어야 `RepoLaneCommitRow`의
  // `memo`가 매 렌더 다시 그리지 않는다.
  const handleCommitContextMenu = useCallback(
    (row: Extract<RepoLaneRow, { kind: "commit" }>, e: MouseEvent) => {
      e.preventDefault();
      onSelectCommit(row.repoPath, row.commit, row.key);
      setCommitMenu({ commit: row.commit, repoPath: row.repoPath, ...contextMenuPoint(e) });
    },
    [onSelectCommit],
  );

  return (
    <div className="@container/graph flex flex-col flex-1 min-h-0 overflow-hidden">
      <div
        className={GRAPH_COLUMNS + " h-6 shrink-0 pr-3 border-b border-(--line) text-[11.5px] font-semibold text-muted-foreground"}
        style={{ paddingLeft: graphWidth + 8 }}
        aria-hidden="true"
      >
        <span className="pl-3.5">{t("graph.colDescription")}</span>
        <span>{t("graph.colChange")}</span>
        <span title={t("graph.colCi")}>{t("graph.colCi")}</span>
        <span>{t("graph.colAuthor")}</span>
        <span>{t("graph.colTime")}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        {isLoading && graph.rows.length === 0 ? (
          <LoadingState label={t("history.loadingHistory")} />
        ) : graph.rows.length === 0 ? (
          <EmptyState layout="row" title={emptyMessage ?? t("review.noCommits")} />
        ) : (
          graph.rows.map((row) => {
            switch (row.kind) {
              case "wip": {
                const followed = selectedKey === row.key ? followModeOf(row.wip.path) : null;
                return (
                  <RepoLaneWipRow
                    key={row.key}
                    row={row}
                    graphWidth={graphWidth}
                    colorOf={colorOf}
                    repoLabel={repoLabel}
                    selected={selectedKey === row.key}
                    following={followed === "following"}
                    onSelect={() => {
                      startFollow(row.wip.path);
                      onSelectWip(row.wip, row.key);
                    }}
                    onToggleFollow={() => {
                      if (followed === "following") {
                        stopFollow();
                        return;
                      }
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
                  <RepoLaneCommitRow
                    key={row.key}
                    row={row}
                    index={idx}
                    itemRef={itemRef}
                    graphWidth={graphWidth}
                    colorOf={colorOf}
                    avatarUrl={accountAvatarMap.get(emailKey) || undefined}
                    stats={commitStats.get(commitStatsAcrossReposKey(row.repoPath, row.commit.id))}
                    isSelected={selectedKey === row.key}
                    isHighlighted={activeIndex === idx}
                    repoLabel={repoLabel}
                    onSelect={onSelectCommit}
                    onContextMenu={handleCommitContextMenu}
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

/**
 * 저장소 레인 그래프의 WIP 행. 초 단위 갱신(`useNow`, 「N초 전 바뀜」 안내)을 이 컴포넌트 안에
 * 가둬, 1초마다 이 행만 다시 그리고 커밋 행은 그대로 둔다(#4).
 */
function RepoLaneWipRow({
  row,
  graphWidth,
  colorOf,
  repoLabel,
  selected,
  following,
  onSelect,
  onToggleFollow,
}: {
  row: Extract<RepoLaneRow, { kind: "wip" }>;
  graphWidth: number;
  colorOf: (chain: number) => string;
  repoLabel: (repoPath: string) => string;
  selected: boolean;
  following: boolean;
  onSelect: () => void;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();
  const now = useNow(1_000);
  const { trailing, followButton, live } = followRowParts(t, now, row.wip.changedAt, row.wip.count, following, onToggleFollow);
  return (
    <GraphWipRow
      wipLabel={t("shell.uncommitted")}
      ariaContext={repoLabel(row.repoPath)}
      target={wipTarget(row.wip)}
      count={row.wip.count}
      changedAt={row.wip.changedAt}
      color={repoLaneColor(row.repoPath)}
      graphWidth={graphWidth}
      selected={selected}
      connectDown={false}
      layout={row.layout}
      colorOf={colorOf}
      leading={<RepoLaneTag repoPath={row.repoPath} label={repoLabel(row.repoPath)} />}
      trailing={trailing}
      action={followButton}
      live={live}
      onSelect={onSelect}
    />
  );
}

interface RepoLaneCommitRowProps {
  row: Extract<RepoLaneRow, { kind: "commit" }>;
  index: number;
  itemRef: (index: number) => (el: HTMLElement | null) => void;
  graphWidth: number;
  colorOf: (chain: number) => string;
  avatarUrl: string | undefined;
  /** 「변경」 칸(3.15). 아직 모르면 비워 둔다. CI 칸은 이 화면에서는 늘 비운다(저장소마다 계정이 다를 수 있다). */
  stats: CommitStats | undefined;
  isSelected: boolean;
  isHighlighted: boolean;
  repoLabel: (repoPath: string) => string;
  onSelect: (repoPath: string, commit: CommitInfo, key: string) => void;
  onContextMenu: (row: Extract<RepoLaneRow, { kind: "commit" }>, e: MouseEvent) => void;
}

/**
 * 저장소 레인 그래프의 커밋 행. `memo`로 감싸(#4) WIP 행의 초 단위 갱신이나 다른 행의 선택
 * 변화가 이 행까지 다시 그리게 하지 않는다 — 단일 저장소 그래프의 `HistoryGraphRow`와 같은 패턴이다.
 */
const RepoLaneCommitRow = memo(function RepoLaneCommitRow({
  row,
  index,
  itemRef,
  graphWidth,
  colorOf,
  avatarUrl,
  stats,
  isSelected,
  isHighlighted,
  repoLabel,
  onSelect,
  onContextMenu,
}: RepoLaneCommitRowProps) {
  const ref = useMemo(() => itemRef(index), [itemRef, index]);
  return (
    <GraphRow
      ref={ref}
      commit={row.commit}
      layout={row.layout}
      graphWidth={graphWidth}
      colorOf={colorOf}
      remoteTags={null}
      avatarUrl={avatarUrl}
      stats={stats}
      isSelected={isSelected}
      isHighlighted={isHighlighted}
      wipAbove={false}
      leading={<RepoLaneTag repoPath={row.repoPath} label={repoLabel(row.repoPath)} />}
      onClick={() => onSelect(row.repoPath, row.commit, row.key)}
      onContextMenu={(e) => onContextMenu(row, e)}
    />
  );
});

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
          <StatusChip tone="neutral">{branchLabel}</StatusChip>
          <span className="truncate text-(--fg2)">{t("review.baseRow")}</span>
        </span>
        <span />
        <span className="truncate text-[11.5px] text-muted-foreground">
          {baseTime !== null ? formatRelativeTime(baseTime) : null}
        </span>
        <span />
      </span>
    </div>
  );
}
