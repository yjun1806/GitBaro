import { useCallback, useMemo } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { buildCountInputs, useReviewSeenStore } from "@/stores/review-seen";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useReviewStatus } from "@/hooks/useReviewStatus";
import { useNewCommitIdsMany, useStatusMany, useWorkspaceHistories } from "@/api/queries";
import {
  buildRepoLaneRows,
  type LaneRepo,
  type LaneWip,
  type RepoLaneGraph,
} from "@/components/graph/repo-lanes";
import type { NewCommitIds, ReviewWorktree, WorkspaceRepoHistory } from "@/types";
import { baseName, splitReviewRepos, type ReviewRepoPaths, type ReviewRepoSignals } from "./review-model";

/** 리뷰 화면의 저장소 하나. */
export interface ReviewRepo extends ReviewRepoSignals {
  path: string;
  name: string;
  worktrees: ReviewWorktree[];
  history: WorkspaceRepoHistory | undefined;
  /** 메인 작업 트리의 새 커밋 응답. 아직 못 셌으면 undefined. */
  counted: NewCommitIds | undefined;
}

export interface WorkspaceReviewData {
  /** 워크스페이스의 모든 저장소(워크스페이스에 적힌 순서). */
  repos: ReviewRepo[];
  /** 지금 보이는 저장소(숨김 규칙 적용 뒤). 레인 순서다. */
  visible: ReviewRepo[];
  hiddenCount: number;
  graph: RepoLaneGraph;
  /** 레인 순서대로의 저장소 경로(오류로 레인이 없는 저장소는 빠진다). */
  lanePaths: string[];
  /** 저장소 경로 → 워크트리 경로. 활동 이벤트를 저장소에 돌리는 데 쓴다. */
  repoPaths: ReviewRepoPaths[];
  /** 보이는 저장소의 새 커밋 수 합. */
  newCount: number;
  seenAt: number | null;
  baseTime: number | null;
  baseBranchLabel: string;
  isLoading: boolean;
  /** 보이는 저장소의 새 커밋을 모두 확인함으로 표시한다. */
  markSeen: () => void;
}

const DEFAULT_BRANCH_FALLBACK = "main";

/**
 * 워크스페이스 리뷰 화면의 데이터. 저장소마다 따로 부른다.
 * - 워크트리 목록·HEAD: `review_status`(사이드바와 같은 키라 캐시를 같이 쓴다)
 * - 커밋: `get_workspace_history`(저장소마다 한 쿼리, HEAD가 바뀌면 다시 읽음)
 * - 커밋하지 않은 변경: 워크트리마다 `status`
 * - 새 커밋: 메인 작업 트리마다 `list_new_commit_ids`(단일 저장소 그래프와 같은 키)
 */
export function useWorkspaceReview(memberPaths: readonly string[], showAll: boolean): WorkspaceReviewData {
  const allRepos = useRepositoryStore((s) => s.repos);
  const allRepoPaths = useMemo(() => allRepos.map((r) => r.path), [allRepos]);
  const review = useReviewStatus(allRepoPaths);

  const members = useMemo(() => {
    const scanByRepo = new Map(review.repos.map((r) => [r.repoPath, r]));
    const nameByPath = new Map(allRepos.map((r) => [r.path, r.name]));
    return memberPaths.map((path) => {
      const scanned = scanByRepo.get(path)?.worktrees;
      const worktrees: ReviewWorktree[] =
        scanned && scanned.length > 0 ? scanned : [{ path, branch: null, headOid: null, isMain: true }];
      const main = worktrees.find((w) => w.isMain) ?? worktrees[0];
      return { path, name: nameByPath.get(path) ?? baseName(path), worktrees, main };
    });
  }, [memberPaths, review.repos, allRepos]);

  const histories = useWorkspaceHistories(
    useMemo(() => members.map((m) => ({ path: m.path, headOid: m.main.headOid })), [members]),
  );

  const worktreePaths = useMemo(
    () => [...new Set(members.flatMap((m) => m.worktrees.map((w) => w.path)))],
    [members],
  );
  const statuses = useStatusMany(worktreePaths);

  const entries = useReviewSeenStore((s) => s.entries);
  const initialScanDone = useReviewSeenStore((s) => s.initialScanDone);
  const scannedRepos = useReviewSeenStore((s) => s.scannedRepos);
  const markSeenInStore = useReviewSeenStore((s) => s.markSeen);
  const countEntries = useMemo(() => {
    if (!initialScanDone) return [];
    const wanted = new Map(members.map((m) => [m.path, m.main.headOid]));
    return buildCountInputs(review.repos, entries, scannedRepos)
      .filter((entry) => wanted.has(entry.path))
      .map((entry) => ({ entry, headOid: wanted.get(entry.path) ?? null }));
  }, [initialScanDone, members, review.repos, entries, scannedRepos]);
  const countedByPath = useNewCommitIdsMany(countEntries);

  const lastChangedAt = useLiveChangesStore((s) => s.lastChangedAt);

  const repos: ReviewRepo[] = members.map((m, i) => {
    const history = histories[i];
    const counted = countedByPath[m.path];
    const wipCount = m.worktrees.reduce(
      (sum, w) => sum + new Set((statuses[w.path] ?? []).map((e) => e.path)).size,
      0,
    );
    return {
      path: m.path,
      name: m.name,
      worktrees: m.worktrees,
      history,
      counted,
      branch: history ? history.branch : m.main.branch,
      defaultBranch: history?.defaultBranch ?? null,
      newCount: counted ? counted.newCount : null,
      wipCount,
      error: history?.error ?? null,
    };
  });

  const { visible, hiddenCount } = splitReviewRepos(repos, showAll);

  const laneRepos: LaneRepo[] = visible
    .filter((r) => r.error === null)
    .map((r) => ({
      path: r.path,
      commits: r.history?.commits ?? [],
      hasBase: r.history?.baseStatus === "found",
    }));
  const lanePathKey = laneRepos.map((r) => r.path).join("\u0000");
  const lanePaths = useMemo(() => (lanePathKey ? lanePathKey.split("\u0000") : []), [lanePathKey]);

  const wips: LaneWip[] = visible
    .filter((r) => r.error === null)
    .flatMap((r) =>
      r.worktrees.map((w) => ({
        repoPath: r.path,
        path: w.path,
        branch: w.branch,
        isMain: w.isMain,
        count: new Set((statuses[w.path] ?? []).map((e) => e.path)).size,
        changedAt: lastChangedAt[w.path] ?? null,
      })),
    )
    .filter((w) => w.count > 0);

  const newIds = new Map(
    visible.map((r) => [r.path, new Set(r.counted && r.counted.newCount > 0 ? r.counted.ids : [])]),
  );

  // 행 계산은 저장소·커밋·WIP·새 커밋이 바뀔 때만 다시 한다.
  const graphKey = [
    lanePathKey,
    ...laneRepos.map((r) => `${r.path}@${r.commits[0]?.id ?? ""}:${r.commits.length}:${r.hasBase}`),
    ...wips.map((w) => `${w.path}:${w.count}:${w.changedAt ?? ""}`),
    ...[...newIds].map(([p, ids]) => `${p}:${[...ids].join(",")}`),
  ].join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => buildRepoLaneRows(laneRepos, wips, newIds), [graphKey]);

  const withNew = visible.filter((r) => (r.newCount ?? 0) > 0);
  const newCount = withNew.reduce((sum, r) => sum + (r.newCount ?? 0), 0);
  const seenTimes = withNew
    .map((r) => entries[r.path]?.seenAt)
    .filter((t): t is number => typeof t === "number");
  const seenAt = seenTimes.length > 0 ? Math.max(...seenTimes) : null;

  const baseTimes = visible
    .map((r) => r.history?.mergeBaseCommit?.timestamp)
    .filter((t): t is number => typeof t === "number");
  const baseTime = baseTimes.length > 0 ? Math.max(...baseTimes) : null;
  const baseBranches = [
    ...new Set(
      visible
        .filter((r) => r.history?.baseStatus === "found")
        .map((r) => r.defaultBranch ?? DEFAULT_BRANCH_FALLBACK),
    ),
  ];
  const baseBranchLabel = baseBranches.length > 0 ? baseBranches.join(", ") : DEFAULT_BRANCH_FALLBACK;

  const seenTargets = withNew.flatMap((r) =>
    r.counted ? [{ path: r.counted.path, headOid: r.counted.headOid, branch: r.branch }] : [],
  );
  const seenKey = seenTargets.map((s) => `${s.path}@${s.headOid}`).join("\n");
  const markSeen = useCallback(
    () => seenTargets.forEach((s) => markSeenInStore(s.path, s.headOid, s.branch)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seenKey, markSeenInStore],
  );

  const repoPaths: ReviewRepoPaths[] = members.map((m) => ({
    repoPath: m.path,
    worktreePaths: m.worktrees.map((w) => w.path),
  }));

  return {
    repos,
    visible,
    hiddenCount,
    graph,
    lanePaths,
    repoPaths,
    newCount,
    seenAt,
    baseTime,
    baseBranchLabel,
    isLoading: histories.some((h) => h === undefined),
    markSeen,
  };
}
