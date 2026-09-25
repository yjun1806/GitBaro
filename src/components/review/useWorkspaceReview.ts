import { useMemo } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useReviewStatus } from "@/hooks/useReviewStatus";
import { useRepoSyncStatuses, useStatusMany, useWorkspaceHistories } from "@/api/queries";
import {
  buildRepoLaneRows,
  type LaneRepo,
  type LaneWip,
  type RepoLaneGraph,
} from "@/components/graph/repo-lanes";
import type { CommitInfo, ReviewWorktree, WorkspaceRepoHistory } from "@/types";
import {
  baseName,
  dedupeReviewMembers,
  splitReviewRepos,
  type ReviewRepoPaths,
  type ReviewRepoSignals,
} from "./review-model";

/** 리뷰 화면의 저장소 하나. */
export interface ReviewRepo extends ReviewRepoSignals {
  path: string;
  name: string;
  worktrees: ReviewWorktree[];
  history: WorkspaceRepoHistory | undefined;
  /** 레인에 그릴 커밋(main과 갈라진 뒤). 읽지 못했거나 아직 못 읽었으면 null. */
  lane: { commits: CommitInfo[]; hasBase: boolean } | null;
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
  baseTime: number | null;
  baseBranchLabel: string;
  isLoading: boolean;
}

const DEFAULT_BRANCH_FALLBACK = "main";

/**
 * 워크스페이스 리뷰 화면의 데이터. 저장소마다 따로 부른다.
 * - 워크트리 목록·HEAD: `review_status`(사이드바와 같은 키라 캐시를 같이 쓴다)
 * - 커밋: `get_workspace_history`(저장소마다 한 쿼리, HEAD가 바뀌면 다시 읽음)
 * - 커밋하지 않은 변경: 워크트리마다 `status`
 * - 원격에 없는 커밋 수: 워크트리마다 `repo_sync_status`. 숨김 규칙은 모든 워크트리의 수를 본다.
 */
export function useWorkspaceReview(memberPaths: readonly string[], showAll: boolean): WorkspaceReviewData {
  const allRepos = useRepositoryStore((s) => s.repos);
  const allRepoPaths = useMemo(() => allRepos.map((r) => r.path), [allRepos]);
  const review = useReviewStatus(allRepoPaths);

  const members = useMemo(() => {
    const scanByRepo = new Map(review.repos.map((r) => [r.repoPath, r]));
    const nameByPath = new Map(allRepos.map((r) => [r.path, r.name]));
    const scanned = memberPaths.map((path) => {
      const found = scanByRepo.get(path)?.worktrees;
      const worktrees: ReviewWorktree[] =
        found && found.length > 0 ? found : [{ path, branch: null, headOid: null, isMain: true }];
      return { path, name: nameByPath.get(path) ?? baseName(path), worktrees };
    });
    // 링크된 워크트리를 저장소로도 등록했으면 그 워크트리를 한 번만 센다.
    return dedupeReviewMembers(scanned).map((m) => ({
      ...m,
      main: m.worktrees.find((w) => w.isMain) ?? m.worktrees[0],
    }));
  }, [memberPaths, review.repos, allRepos]);

  const histories = useWorkspaceHistories(
    useMemo(() => members.map((m) => ({ path: m.path, headOid: m.main.headOid })), [members]),
  );

  const worktreePaths = useMemo(
    () => [...new Set(members.flatMap((m) => m.worktrees.map((w) => w.path)))],
    [members],
  );
  const statuses = useStatusMany(worktreePaths);
  const { data: syncByPath } = useRepoSyncStatuses(worktreePaths);
  const lastChangedAt = useLiveChangesStore((s) => s.lastChangedAt);

  const repos: ReviewRepo[] = members.map((m, i) => {
    const history = histories[i];
    const lane =
      history && !history.error ? { commits: history.commits, hasBase: history.baseStatus === "found" } : null;
    const wipCount = m.worktrees.reduce(
      (sum, w) => sum + new Set((statuses[w.path] ?? []).map((e) => e.path)).size,
      0,
    );
    const unpushed = m.worktrees.flatMap((w) => {
      const n = syncByPath?.[w.path]?.unpushed;
      return n === undefined ? [] : [n];
    });
    return {
      path: m.path,
      name: m.name,
      worktrees: m.worktrees,
      history,
      lane,
      branch: history ? history.branch : m.main.branch,
      defaultBranch: history?.defaultBranch ?? null,
      unpushedCount: unpushed.length > 0 ? unpushed.reduce((a, b) => a + b, 0) : null,
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

  // 행 계산은 저장소·커밋(참조 표시 포함)·WIP가 바뀔 때만 다시 한다. push·fetch 뒤에는
  // HEAD가 그대로여도 커밋의 참조 표시가 바뀌므로 키에 넣는다.
  const graphKey = [
    lanePathKey,
    ...laneRepos.map((r) => `${r.path}:${r.hasBase}:${r.commits.map(commitKey).join(";")}`),
    ...wips.map((w) => `${w.path}:${w.count}:${w.changedAt ?? ""}`),
  ].join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => buildRepoLaneRows(laneRepos, wips), [graphKey]);

  const withBase = visible.filter((r) => r.lane?.hasBase);
  const baseTimes = withBase
    .map((r) => r.history?.mergeBaseCommit?.timestamp)
    .filter((t): t is number => typeof t === "number");
  const baseTime = baseTimes.length > 0 ? Math.max(...baseTimes) : null;
  const baseBranches = [...new Set(withBase.map((r) => r.defaultBranch ?? DEFAULT_BRANCH_FALLBACK))];
  const baseBranchLabel = baseBranches.length > 0 ? baseBranches.join(", ") : DEFAULT_BRANCH_FALLBACK;

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
    baseTime,
    baseBranchLabel,
    isLoading: histories.some((h) => h === undefined),
  };
}

/** 그래프 캐시 키에 넣는 커밋 하나: SHA와 참조 표시. */
function commitKey(c: CommitInfo): string {
  return `${c.id}|${c.refs.map((r) => `${r.kind}:${r.name}`).join(",")}`;
}
