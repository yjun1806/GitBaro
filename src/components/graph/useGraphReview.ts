import { useCallback, useEffect, useMemo } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { buildCountInputs, useReviewSeenStore } from "@/stores/review-seen";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useReviewStatus } from "@/hooks/useReviewStatus";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import {
  useCommitHistoryInfinite,
  useNewCommitIdsQuery,
  useRepoSyncStatuses,
  useStatus,
} from "@/api/queries";
import { syncStatusPaths } from "@/components/sidebar/tree-model";
import { normalizePath, orderWipRows, type GraphWip } from "./graph-model";

/** 그래프가 보이는 워크트리를 활동 감시 대상으로 더할 때 쓰는 키. */
export const GRAPH_WATCH_KEY = "graph";

export interface GraphReview {
  /** 맨 위 WIP 행. 다른 워크트리가 먼저, 지금 연 워크트리가 맨 아래(`orderWipRows`). */
  wips: GraphWip[];
  /**
   * 지금 연 워크트리의 새 커밋 수와 새 커밋으로 센 커밋. 아직 모르거나 다시 세는 중이면 null.
   * 버튼의 N, 새 커밋 점, 구분선이 모두 이 한 응답에서 나온다.
   */
  newCommits: { newCount: number; ids: string[] } | null;
  /** 지금 연 워크트리를 확인한 시각(epoch ms). 기록이 없으면 null. */
  seenAt: number | null;
  /** 「새 커밋 N개 확인함으로 표시」. 기준선을 N을 센 HEAD로 옮긴다. */
  markSeen: () => void;
}

const EMPTY: string[] = [];

/**
 * 커밋 그래프에 필요한 리뷰 상태를 모은다.
 * - 워크트리 목록: `review_status`(사이드바와 같은 조회 키라 캐시를 같이 쓴다).
 * - 워크트리별 커밋하지 않은 파일 수·마지막 수정 시각: `repo_sync_status`. 사이드바와 같은
 *   경로 목록(`syncStatusPaths`)으로 물어 같은 조회를 함께 쓴다. 지금 연 워크트리의 파일 수는
 *   파일 감시로 바로 갱신되는 `useStatus` 결과를 쓴다(아래 파일 목록과 같은 숫자).
 * - 새 커밋: `list_new_commit_ids`. 개수와 커밋 목록을 한 번에 받는다.
 * 그래프에 보이는 워크트리 경로는 `registerWatchPaths("graph", …)`로 활동 감시 대상에 더한다.
 */
export function useGraphReview(): GraphReview {
  const repos = useRepositoryStore((s) => s.repos);
  const ownerPath = useRepositoryStore((s) => s.activeRepo?.path ?? null);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);

  const repoPaths = useMemo(() => repos.map((r) => r.path), [repos]);
  const review = useReviewStatus(repoPaths);
  const { data: statusEntries } = useStatus(activeRepoPath);
  const lastChangedAt = useLiveChangesStore((s) => s.lastChangedAt);
  const currentBranch = useCurrentBranch();

  const worktrees = useMemo(
    () => review.repos.find((r) => r.repoPath === ownerPath)?.worktrees ?? [],
    [review.repos, ownerPath],
  );
  const worktreePaths = useMemo(
    () => (worktrees.length > 0 ? worktrees.map((w) => w.path) : EMPTY),
    [worktrees],
  );
  const statusPaths = useMemo(() => syncStatusPaths(repoPaths, review.repos), [repoPaths, review.repos]);
  const { data: syncByPath } = useRepoSyncStatuses(statusPaths);

  const currentKey = activeRepoPath ? normalizePath(activeRepoPath) : null;
  const currentWt = worktrees.find((w) => normalizePath(w.path) === currentKey) ?? null;
  const currentPath = currentWt?.path ?? activeRepoPath;
  const currentCount = statusEntries ? statusEntries.length : null;

  const wips = useMemo(() => {
    if (!activeRepoPath) return [];
    const changedAtOf = (path: string): number | null => {
      const polled = syncByPath?.[path]?.dirtyLatestMtime ?? null;
      const live = lastChangedAt[path] ?? null;
      if (polled === null) return live;
      return live === null ? polled : Math.max(polled, live);
    };
    const rows: GraphWip[] = worktrees.map((w) => {
      const isCurrent = normalizePath(w.path) === currentKey;
      return {
        path: w.path,
        branch: w.branch,
        count: isCurrent ? currentCount : (syncByPath?.[w.path]?.dirtyCount ?? null),
        changedAt: changedAtOf(w.path),
        isCurrent,
        isMain: w.isMain,
        headOid: w.headOid,
      };
    });
    // 워크트리 목록을 아직 못 읽었거나 지금 연 경로가 목록에 없으면(막 만든 워크트리 등)
    // 지금 연 워크트리의 행만이라도 둔다.
    if (!rows.some((r) => r.isCurrent)) {
      rows.push({
        path: activeRepoPath,
        branch: currentBranch,
        count: currentCount,
        changedAt: changedAtOf(activeRepoPath),
        isCurrent: true,
        isMain: ownerPath !== null && normalizePath(ownerPath) === normalizePath(activeRepoPath),
        headOid: null,
      });
    }
    return orderWipRows(rows);
  }, [activeRepoPath, ownerPath, currentBranch, worktrees, currentKey, currentCount, syncByPath, lastChangedAt]);

  // 새 커밋: 사이드바의 개수와 같은 입력(`buildCountInputs`)으로 지금 연 워크트리 하나만 센다.
  // 첫 기준선을 잡기 전에는 세지 않는다(잡힐 기준선 대신 갈라진 지점부터 세어 버리지 않게).
  const entries = useReviewSeenStore((s) => s.entries);
  const initialScanDone = useReviewSeenStore((s) => s.initialScanDone);
  const scannedRepos = useReviewSeenStore((s) => s.scannedRepos);
  const markSeenInStore = useReviewSeenStore((s) => s.markSeen);
  const countInput = useMemo(() => {
    if (!initialScanDone || !currentWt?.headOid) return null;
    return (
      buildCountInputs(review.repos, entries, scannedRepos).find((i) => i.path === currentWt.path) ??
      null
    );
  }, [initialScanDone, currentWt, review.repos, entries, scannedRepos]);
  // 그래프에 그린 HEAD(커밋 이력의 첫 행)가 바뀌면 20초 스캔을 기다리지 않고 바로 다시 센다.
  const { data: history } = useCommitHistoryInfinite(activeRepoPath);
  const drawnHead = history?.pages[0]?.[0]?.id ?? currentWt?.headOid ?? null;
  const { data: counted } = useNewCommitIdsQuery(countInput, drawnHead);

  const registerWatchPaths = useActivityTargetsStore((s) => s.registerWatchPaths);
  const unregisterWatchPaths = useActivityTargetsStore((s) => s.unregisterWatchPaths);
  const watchKey = worktreePaths.join("\u0000");
  useEffect(() => {
    registerWatchPaths(GRAPH_WATCH_KEY, worktreePaths);
    // watchKey가 내용을 대신 비교한다(20초마다 새 배열이 와도 같은 목록이면 다시 등록하지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, registerWatchPaths]);
  useEffect(() => () => unregisterWatchPaths(GRAPH_WATCH_KEY), [unregisterWatchPaths]);

  // 사용자가 본 N을 센 HEAD로 기준선을 옮긴다. 그 사이 들어온 커밋은 다음 개수에 남는다.
  const countedPath = counted?.path ?? null;
  const countedHead = counted?.headOid ?? null;
  const branch = currentWt?.branch ?? null;
  const markSeen = useCallback(() => {
    if (countedPath && countedHead) markSeenInStore(countedPath, countedHead, branch);
  }, [countedPath, countedHead, branch, markSeenInStore]);

  const newCommits = useMemo(
    () => (counted ? { newCount: counted.newCount, ids: counted.ids } : null),
    [counted],
  );

  return {
    wips,
    newCommits,
    seenAt: currentPath ? (entries[currentPath]?.seenAt ?? null) : null,
    markSeen,
  };
}
