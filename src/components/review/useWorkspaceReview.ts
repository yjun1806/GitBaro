import { useCallback, useMemo } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { buildCountInputs, useReviewSeenStore } from "@/stores/review-seen";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useReviewStatus } from "@/hooks/useReviewStatus";
import {
  useNewCommitIdsMany,
  useStatusMany,
  useWorkspaceHistories,
  useWorkspaceRecentCommits,
} from "@/api/queries";
import {
  buildRepoLaneRows,
  type LaneRepo,
  type LaneWip,
  type RepoLaneGraph,
} from "@/components/graph/repo-lanes";
import type { CommitInfo, NewCommitIds, ReviewWorktree, WorkspaceRepoHistory } from "@/types";
import {
  baseName,
  laneCommitsOf,
  splitReviewRepos,
  sumNewCounts,
  type LaneCommits,
  type ReviewRepoPaths,
  type ReviewRepoSignals,
} from "./review-model";

/** 리뷰 화면의 저장소 하나. */
export interface ReviewRepo extends ReviewRepoSignals {
  path: string;
  name: string;
  worktrees: ReviewWorktree[];
  history: WorkspaceRepoHistory | undefined;
  /** 메인 작업 트리의 새 커밋 응답. 아직 못 셌으면 undefined. 레인의 새 커밋 점은 이것만 그린다. */
  counted: NewCommitIds | undefined;
  /** 메인 작업 트리가 아닌 워크트리의 새 커밋 수 합. 그 커밋은 이 화면의 레인에 그리지 않는다. */
  worktreeNewCount: number;
  /** 레인에 그릴 커밋. 읽지 못했거나 아직 못 읽었으면 null. */
  lane: LaneCommits | null;
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
  /** 보이는 저장소 레인에 그린 새 커밋 수 합(메인 작업 트리). 「확인함으로 표시」가 옮기는 수다. */
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
 * - 새 커밋: 워크트리마다 `list_new_commit_ids`(단일 저장소 그래프와 같은 키). 숨김 규칙은
 *   모든 워크트리의 수를 보고, 레인의 점과 「확인함으로 표시」는 메인 작업 트리만 쓴다.
 * - 타임라인에 없는 새 커밋(main에서 pull로 받은 커밋 등): `get_commit_history`로 채운다.
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
    const heads = new Map(members.flatMap((m) => m.worktrees.map((w) => [w.path, w.headOid] as const)));
    return buildCountInputs(review.repos, entries, scannedRepos)
      .filter((entry) => heads.has(entry.path))
      .map((entry) => ({ entry, headOid: heads.get(entry.path) ?? null }));
  }, [initialScanDone, members, review.repos, entries, scannedRepos]);
  const countedByPath = useNewCommitIdsMany(countEntries);

  const lastChangedAt = useLiveChangesStore((s) => s.lastChangedAt);

  // 새 커밋이 타임라인에 다 들어 있는지 먼저 보고, 빠진 저장소만 최근 커밋을 더 읽는다.
  const firstPass = members.map((m, i) => {
    const history = histories[i];
    const counted = countedByPath[m.path];
    const ids = new Set(counted && counted.newCount > 0 ? counted.ids : []);
    const lane = history && !history.error ? laneCommitsOf(history, ids, undefined) : null;
    return { history, counted, ids, lane };
  });
  const recentRequests = firstPass.flatMap((p, i) =>
    p.lane?.needsRecent && p.history?.headOid ? [{ path: members[i].path, headOid: p.history.headOid }] : [],
  );
  const recentByPath = useWorkspaceRecentCommits(recentRequests);

  const repos: ReviewRepo[] = members.map((m, i) => {
    const { history, counted, ids } = firstPass[i];
    const recent: CommitInfo[] | undefined = recentByPath[m.path];
    const lane = history && !history.error ? laneCommitsOf(history, ids, recent) : null;
    const wipCount = m.worktrees.reduce(
      (sum, w) => sum + new Set((statuses[w.path] ?? []).map((e) => e.path)).size,
      0,
    );
    const others = m.worktrees.filter((w) => !w.isMain).map((w) => w.path);
    return {
      path: m.path,
      name: m.name,
      worktrees: m.worktrees,
      history,
      counted,
      worktreeNewCount: sumNewCounts(others, countedByPath) ?? 0,
      lane,
      branch: history ? history.branch : m.main.branch,
      defaultBranch: history?.defaultBranch ?? null,
      newCount: sumNewCounts(
        m.worktrees.map((w) => w.path),
        countedByPath,
      ),
      wipCount,
      error: history?.error ?? null,
    };
  });

  const { visible, hiddenCount } = splitReviewRepos(repos, showAll);

  const laneRepos: LaneRepo[] = visible
    .filter((r) => r.error === null)
    .map((r) => ({
      path: r.path,
      commits: r.lane?.commits ?? [],
      hasBase: r.lane?.hasBase ?? false,
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
        headOid: w.headOid,
        count: new Set((statuses[w.path] ?? []).map((e) => e.path)).size,
        changedAt: lastChangedAt[w.path] ?? null,
      })),
    )
    .filter((w) => w.count > 0);

  const newIds = new Map(
    visible.map((r) => [r.path, new Set(r.counted && r.counted.newCount > 0 ? r.counted.ids : [])]),
  );

  // 행 계산은 저장소·커밋(참조 표시 포함)·WIP·새 커밋이 바뀔 때만 다시 한다. push·fetch 뒤에는
  // HEAD가 그대로여도 커밋의 참조 표시가 바뀌므로 키에 넣는다.
  const graphKey = [
    lanePathKey,
    ...laneRepos.map((r) => `${r.path}:${r.hasBase}:${r.commits.map(commitKey).join(";")}`),
    ...wips.map((w) => `${w.path}:${w.count}:${w.changedAt ?? ""}`),
    ...[...newIds].map(([p, ids]) => `${p}:${[...ids].join(",")}`),
  ].join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => buildRepoLaneRows(laneRepos, wips, newIds), [graphKey]);

  const withNew = visible.filter((r) => (r.counted?.newCount ?? 0) > 0);
  const newCount = withNew.reduce((sum, r) => sum + (r.counted?.newCount ?? 0), 0);
  const seenTimes = withNew
    .map((r) => entries[r.path]?.seenAt)
    .filter((t): t is number => typeof t === "number");
  const seenAt = seenTimes.length > 0 ? Math.max(...seenTimes) : null;

  const withBase = visible.filter((r) => r.lane?.hasBase);
  const baseTimes = withBase
    .map((r) => r.history?.mergeBaseCommit?.timestamp)
    .filter((t): t is number => typeof t === "number");
  const baseTime = baseTimes.length > 0 ? Math.max(...baseTimes) : null;
  const baseBranches = [...new Set(withBase.map((r) => r.defaultBranch ?? DEFAULT_BRANCH_FALLBACK))];
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

/** 그래프 캐시 키에 넣는 커밋 하나: SHA와 참조 표시. */
function commitKey(c: CommitInfo): string {
  return `${c.id}|${c.refs.map((r) => `${r.kind}:${r.name}`).join(",")}`;
}
