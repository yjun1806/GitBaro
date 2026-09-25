import { useEffect, useMemo } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useReviewStatus } from "@/hooks/useReviewStatus";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { useRepoSyncStatuses, useStatus } from "@/api/queries";
import { syncStatusPaths } from "@/components/sidebar/tree-model";
import { normalizePath, orderWipRows, type GraphWip } from "./graph-model";

/** 그래프가 보이는 워크트리를 활동 감시 대상으로 더할 때 쓰는 키. */
export const GRAPH_WATCH_KEY = "graph";

export interface GraphReview {
  /** 맨 위 WIP 행. 다른 워크트리가 먼저, 지금 연 워크트리가 맨 아래(`orderWipRows`). */
  wips: GraphWip[];
}

const EMPTY: string[] = [];

/**
 * 커밋 그래프에 필요한 리뷰 상태를 모은다.
 * - 워크트리 목록: `review_status`(사이드바와 같은 조회 키라 캐시를 같이 쓴다).
 * - 워크트리별 커밋하지 않은 파일 수·마지막 수정 시각: `repo_sync_status`. 사이드바와 같은
 *   경로 목록(`syncStatusPaths`)으로 물어 같은 조회를 함께 쓴다. 지금 연 워크트리의 파일 수는
 *   파일 감시로 바로 갱신되는 `useStatus` 결과를 쓴다(아래 파일 목록과 같은 숫자).
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

  const registerWatchPaths = useActivityTargetsStore((s) => s.registerWatchPaths);
  const unregisterWatchPaths = useActivityTargetsStore((s) => s.unregisterWatchPaths);
  const watchKey = worktreePaths.join("\u0000");
  useEffect(() => {
    registerWatchPaths(GRAPH_WATCH_KEY, worktreePaths);
    // watchKey가 내용을 대신 비교한다(20초마다 새 배열이 와도 같은 목록이면 다시 등록하지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, registerWatchPaths]);
  useEffect(() => () => unregisterWatchPaths(GRAPH_WATCH_KEY), [unregisterWatchPaths]);

  return { wips };
}
