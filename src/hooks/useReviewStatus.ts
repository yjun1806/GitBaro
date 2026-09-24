import { useCallback, useEffect, useMemo } from "react";
import { useNewCommitCountsQuery, useReviewStatusQuery } from "@/api/queries";
import { buildCountInputs, useReviewSeenStore } from "@/stores/review-seen";
import type { NewCommitBasis, NewCommitCount, RepoReviewStatus, ReviewWorktree } from "@/types";

/** 워크트리 하나의 리뷰 상태. 새 커밋 수를 아직 못 셌으면 `newCount`가 null이다. */
export interface WorktreeReviewStatus extends ReviewWorktree {
  repoPath: string;
  newCount: number | null;
  basis: NewCommitBasis | null;
}

/** 스캔 결과와 개수를 워크트리 경로별로 합친다. */
export function mergeReviewStatus(
  repos: RepoReviewStatus[],
  counts: NewCommitCount[],
): Record<string, WorktreeReviewStatus> {
  const countByPath = new Map(counts.map((c) => [c.path, c]));
  const out: Record<string, WorktreeReviewStatus> = {};
  for (const repo of repos) {
    for (const wt of repo.worktrees) {
      const count = countByPath.get(wt.path);
      out[wt.path] = {
        ...wt,
        repoPath: repo.repoPath,
        newCount: count?.newCount ?? null,
        basis: count?.basis ?? null,
      };
    }
  }
  return out;
}

/**
 * 등록된 저장소들의 워크트리와 워크트리별 새 커밋 수.
 * 20초마다 워크트리 목록을 다시 읽고, 기준선이 없는 워크트리의 기준선을 잡은 뒤 개수를 센다.
 */
export function useReviewStatus(repoPaths: string[]) {
  const scan = useReviewStatusQuery(repoPaths);
  const entries = useReviewSeenStore((s) => s.entries);
  const initialScanDone = useReviewSeenStore((s) => s.initialScanDone);
  const scannedRepos = useReviewSeenStore((s) => s.scannedRepos);
  const applyScan = useReviewSeenStore((s) => s.applyScan);
  const markSeenInStore = useReviewSeenStore((s) => s.markSeen);

  useEffect(() => {
    if (scan.data) applyScan(scan.data);
  }, [scan.data, applyScan]);

  const repos = useMemo(() => scan.data ?? [], [scan.data]);
  const inputs = useMemo(
    () =>
      initialScanDone && scan.data ? buildCountInputs(scan.data, entries, scannedRepos) : null,
    [initialScanDone, scan.data, entries, scannedRepos],
  );
  const headsKey = useMemo(
    () =>
      repos
        .flatMap((r) => r.worktrees)
        .map((wt) => `${wt.path}@${wt.headOid ?? ""}`)
        .join("\n"),
    [repos],
  );
  const counts = useNewCommitCountsQuery(inputs, headsKey);

  const byPath = useMemo(
    () => mergeReviewStatus(repos, counts.data ?? []),
    [repos, counts.data],
  );

  /**
   * 「새 커밋 N개 확인함으로 표시」. 사용자가 본 개수를 센 HEAD로 기준선을 옮긴다.
   * 그 사이 들어온 커밋은 다음 개수에 남는다.
   */
  const markSeen = useCallback(
    (path: string) => {
      const wt = byPath[path];
      const counted = counts.data?.find((c) => c.path === path)?.headOid;
      const headOid = counted ?? wt?.headOid;
      if (!wt || !headOid) return;
      markSeenInStore(path, headOid, wt.branch);
    },
    [byPath, counts.data, markSeenInStore],
  );

  return {
    repos,
    byPath,
    markSeen,
    isLoading: scan.isLoading || counts.isLoading,
  };
}
