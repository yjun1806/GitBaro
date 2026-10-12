import { useMemo } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useReviewStatus } from "@/hooks/useReviewStatus";
import { useRepoSyncStatuses, useStatusMany, useWorkspaceHistories, useWorktrees } from "@/api/queries";
import { buildRepoLaneRows, repoLaneColor, type LaneRepo, type LaneWip, type RepoLaneGraph } from "@/components/graph/repo-lanes";
import type { WorktreeChip } from "@/components/graph/WorktreeLaneChips";
import { useScopeStore } from "@/components/scope/scope-store";
import { sharedRemoteName, visibleLaneSources, type LaneSource } from "@/components/scope/scope-lanes";
import { countChangedFiles, trimTrailingSlash } from "@/lib/utils";
import type { ReviewWorktree, WorkspaceRepoHistory } from "@/types";
import { baseName, type ReviewRepoPaths } from "./review-model";
import { commitKey } from "./useWorkspaceReview";

/** 저장소 단계 레인 하나 = 워크트리 하나. */
export interface RepoWorktreeLane extends ReviewWorktree {
  /** 지금 연 워크트리. 늘 보이고 칩을 끌 수 없다. */
  isCurrent: boolean;
  /** 레인 이름표(체크아웃한 브랜치, detached면 폴더 이름). */
  label: string;
  history: WorkspaceRepoHistory | undefined;
}

export interface RepoWorktreeReviewData {
  /** 저장소의 모든 워크트리(메인 먼저, 그다음 경로순). 칩이 이 목록이다. */
  worktrees: RepoWorktreeLane[];
  /** 지금 그리는 워크트리(칩이 켜진 것). 레인 순서다. */
  visible: RepoWorktreeLane[];
  chips: WorktreeChip[];
  graph: RepoLaneGraph;
  /** 레인 순서대로의 워크트리 경로(오류로 레인이 없는 워크트리는 빠진다). */
  lanePaths: string[];
  /** 활동 이벤트를 워크트리에 돌리는 데 쓴다. */
  repoPaths: ReviewRepoPaths[];
  baseTime: number | null;
  baseBranchLabel: string;
  remoteName: string | null;
  isLoading: boolean;
  /** 워크트리 경로 → 이름표. */
  labelOf: (path: string) => string;
  toggle: (path: string) => void;
  /** 이 워크트리만 함께 본다(지금 연 워크트리는 늘 보인다). */
  showOnly: (path: string) => void;
}

const DEFAULT_BRANCH_FALLBACK = "main";
const NO_REMOTES: readonly string[] = [];
const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

/** 메인 작업 트리 먼저, 그다음 경로순(칩과 WIP 행 순서). */
function worktreeOrder(a: ReviewWorktree, b: ReviewWorktree): number {
  return Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path);
}

/**
 * 저장소 단계(5.1)의 데이터: 레인 하나가 워크트리 하나인 `useWorkspaceReview`의 짝이다. 커밋은 워크트리
 * 경로로 `get_workspace_history`를 불러 기본 브랜치에서 갈라진 뒤의 것만 받는다(워크스페이스 레인과 같다).
 * 칩을 건드리지 않은 워크트리는 조용한 레인 규칙(`visibleLaneSources`)을 따르고, 건드린 것은
 * `useScopeStore.laneShown`이 기억한다. 지금 연 워크트리는 늘 보인다.
 *
 * @param repoPath 소유 저장소 경로(메인 작업 트리). null이면 아무것도 조회하지 않는다(저장소 단계가 아닐 때).
 * @param activeWorktreePath 지금 연 워크트리 경로(`activeRepoPath`).
 */
export function useRepoWorktreeReview(repoPath: string | null, activeWorktreePath: string | null): RepoWorktreeReviewData {
  const allRepos = useRepositoryStore((s) => s.repos);
  const allRepoPaths = useMemo(() => allRepos.map((r) => r.path), [allRepos]);
  const review = useReviewStatus(allRepoPaths);
  const { data: worktreeInfos } = useWorktrees(repoPath);
  const laneShown = useScopeStore((s) => s.laneShown);
  const setLaneShown = useScopeStore((s) => s.setLaneShown);
  const setLanesShown = useScopeStore((s) => s.setLanesShown);
  const lastChangedAt = useLiveChangesStore((s) => s.lastChangedAt);

  const scanned = repoPath === null ? undefined : review.repos.find((r) => r.repoPath === repoPath)?.worktrees;
  const scannedKey = scanned?.map((w) => `${w.path}|${w.branch ?? ""}|${w.headOid ?? ""}|${w.isMain}`).join("\n") ?? "";
  const rawWorktrees = useMemo<ReviewWorktree[]>(() => {
    if (repoPath === null) return [];
    const found = scanned && scanned.length > 0 ? scanned : [{ path: repoPath, branch: null, headOid: null, isMain: true }];
    return [...found].sort(worktreeOrder);
    // scannedKey가 스캔 결과(20초마다 새 배열)의 내용을 대신 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedKey, repoPath]);

  const histories = useWorkspaceHistories(
    useMemo(() => rawWorktrees.map((w) => ({ path: w.path, headOid: w.headOid })), [rawWorktrees]),
  );
  const worktreePaths = useMemo(() => rawWorktrees.map((w) => w.path), [rawWorktrees]);
  const statuses = useStatusMany(worktreePaths);
  const { data: syncByPath } = useRepoSyncStatuses(worktreePaths);
  const remotes = allRepos.find((r) => r.path === repoPath)?.remotes.map((remote) => remote.name) ?? NO_REMOTES;

  const currentKey = trimTrailingSlash(activeWorktreePath ?? repoPath ?? "");
  const worktrees: RepoWorktreeLane[] = rawWorktrees.map((w, i) => {
    const history = histories[i];
    return {
      ...w,
      isCurrent: trimTrailingSlash(w.path) === currentKey,
      label: w.branch ?? history?.branch ?? baseName(w.path),
      history,
    };
  });

  const sources: LaneSource[] = worktrees.map((w) => ({
    id: w.path,
    repoPath: repoPath ?? "",
    worktreePath: w.path,
    isMain: w.isMain,
    branch: w.history ? w.history.branch : w.branch,
    defaultBranch: w.history?.defaultBranch ?? null,
    unpushedCount: syncByPath?.[w.path]?.unpushed ?? null,
    wipCount: countChangedFiles(statuses[w.path] ?? []),
    error: w.history?.error ?? null,
    remotes,
    color: repoLaneColor(w.path),
  }));
  const shownIds = new Set(
    visibleLaneSources({ kind: "repo", repoPath: repoPath ?? "" }, sources, NO_OVERRIDES, new Map(Object.entries(laneShown))).map(
      (s) => s.id,
    ),
  );
  const visible = worktrees.filter((w) => w.isCurrent || shownIds.has(w.path));

  const drawn = visible.filter((w) => w.history?.error == null);
  // 영역 머리(D48)는 모든 레인이 원격을 가질 때만 그린다 — 저장소 하나의 워크트리라 원격은 모두 같다.
  const byRegion = drawn.length > 0 && remotes.length > 0;
  const laneRepos: LaneRepo[] = drawn.map((w) => ({
    path: w.path,
    commits: w.history?.commits ?? [],
    hasBase: w.history?.baseStatus === "found",
    ...(byRegion ? { unpushedOids: new Set(w.history?.unpushedOids ?? []) } : {}),
  }));
  const lanePathKey = laneRepos.map((r) => r.path).join("\u0000");
  const lanePaths = useMemo(() => (lanePathKey ? lanePathKey.split("\u0000") : []), [lanePathKey]);

  const wips: LaneWip[] = drawn
    .map((w) => ({
      repoPath: w.path,
      path: w.path,
      branch: w.history ? w.history.branch : w.branch,
      isMain: w.isMain,
      headOid: w.headOid,
      count: countChangedFiles(statuses[w.path] ?? []),
      changedAt: lastChangedAt[w.path] ?? null,
    }))
    .filter((w) => w.count > 0);

  // 행 계산은 워크트리·커밋(참조 표시 포함)·WIP가 바뀔 때만 다시 한다(`useWorkspaceReview`와 같다).
  const graphKey = [
    lanePathKey,
    ...laneRepos.map(
      (r) =>
        `${r.path}:${r.hasBase}:${r.commits.map(commitKey).join(";")}:${r.unpushedOids ? [...r.unpushedOids].join(",") : "-"}`,
    ),
    ...wips.map((w) => `${w.path}:${w.count}:${w.changedAt ?? ""}`),
  ].join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- graphKey가 laneRepos·wips의 내용을 대신 비교한다
  const graph = useMemo(() => buildRepoLaneRows(laneRepos, wips), [graphKey]);

  const withBase = drawn.filter((w) => w.history?.baseStatus === "found");
  const baseTimes = withBase
    .map((w) => w.history?.mergeBaseCommit?.timestamp)
    .filter((t): t is number => typeof t === "number");
  const baseBranches = [...new Set(withBase.map((w) => w.history?.defaultBranch ?? DEFAULT_BRANCH_FALLBACK))];

  const infoByPath = new Map((worktreeInfos ?? []).map((w) => [trimTrailingSlash(w.path), w]));
  const chips: WorktreeChip[] = worktrees.map((w) => ({
    path: w.path,
    branch: w.branch ?? w.history?.branch ?? null,
    isMain: w.isMain,
    isCurrent: w.isCurrent,
    base: infoByPath.get(trimTrailingSlash(w.path))?.base ?? null,
    color: repoLaneColor(w.path),
  }));

  const visiblePaths = new Set(visible.map((w) => w.path));
  const toggle = (path: string) => setLaneShown(path, !visiblePaths.has(path));
  const showOnly = (path: string) =>
    setLanesShown(
      Object.fromEntries(
        rawWorktrees.filter((w) => trimTrailingSlash(w.path) !== currentKey).map((w) => [w.path, w.path === path]),
      ),
    );
  // 행의 `memo`가 깨지지 않게, 이름표가 실제로 바뀔 때만 새 함수를 만든다.
  const labelKey = worktrees.map((w) => `${w.path}\u0001${w.label}`).join("\u0002");
  const labelOf = useMemo(() => {
    const byPath = new Map(worktrees.map((w) => [w.path, w.label]));
    return (path: string) => byPath.get(path) ?? baseName(path);
    // labelKey가 worktrees의 이름표를 대신 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey]);

  const repoPaths = useMemo<ReviewRepoPaths[]>(
    () => (repoPath === null ? [] : [{ repoPath, worktreePaths }]),
    [repoPath, worktreePaths],
  );

  return {
    worktrees,
    visible,
    chips,
    graph,
    lanePaths,
    repoPaths,
    baseTime: baseTimes.length > 0 ? Math.max(...baseTimes) : null,
    baseBranchLabel: baseBranches.length > 0 ? baseBranches.join(", ") : DEFAULT_BRANCH_FALLBACK,
    remoteName: sharedRemoteName(drawn.map(() => ({ remotes }))),
    isLoading: histories.some((h) => h === undefined),
    labelOf,
    toggle,
    showOnly,
  };
}
