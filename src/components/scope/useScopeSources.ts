import { useMemo } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useReviewStatus } from "@/hooks/useReviewStatus";
import { useDefaultBranches, useRepoSyncStatuses, useWorkingBranches } from "@/api/queries";
import { dedupeReviewMembers } from "@/components/review/review-model";
import { useScope } from "./useScope";
import type { Scope } from "./scope";
import { branchLaneId, laneColorsFor, type LaneSource } from "./scope-lanes";

export interface ScopeSourcesResult {
  scope: Scope | null;
  /** 레인 목록(색 포함). 저장소 순서 → 그 안에서 워크트리 목록 순서(메인 작업 트리가 먼저다). */
  sources: LaneSource[];
  isLoading: boolean;
}

const EMPTY: readonly string[] = [];

/**
 * 저장소 경로 목록에 딸린 모든 워크트리를 레인 하나씩으로 편다. 워크스페이스·저장소 단계가
 * 함께 쓴다 — 저장소 단계는 이 목록을 그 저장소 하나로만 부른 것과 같다.
 *
 * 아직 조회하지 못한 워크트리별 커밋 이력(메인 아닌 워크트리의 그래프 레인, W6-T2)은
 * 담지 않는다. 신호(브랜치·원격에 없는 커밋 수·커밋하지 않은 파일 수)만 담으므로, 조용한
 * 레인 판단과 칩 표시에는 바로 쓸 수 있다.
 */
function useRepoLaneSources(repoPaths: readonly string[]): { sources: LaneSource[]; isLoading: boolean } {
  const allRepos = useRepositoryStore((s) => s.repos);
  const review = useReviewStatus([...repoPaths]);
  const scanByRepo = useMemo(() => new Map(review.repos.map((r) => [r.repoPath, r])), [review.repos]);
  const members = useMemo(
    () =>
      dedupeReviewMembers(
        repoPaths.map((path) => ({
          path,
          worktrees: scanByRepo.get(path)?.worktrees ?? [{ path, branch: null, headOid: null, isMain: true }],
        })),
      ),
    [repoPaths, scanByRepo],
  );
  const worktreePaths = useMemo(() => members.flatMap((m) => m.worktrees.map((w) => w.path)), [members]);
  const { data: syncByPath } = useRepoSyncStatuses(worktreePaths);
  const { data: defaultByRepo } = useDefaultBranches([...repoPaths]);
  const remotesByRepo = useMemo(() => {
    const map = new Map<string, readonly string[]>();
    for (const r of allRepos) map.set(r.path, r.remotes.map((remote) => remote.name));
    return map;
  }, [allRepos]);

  const sources: LaneSource[] = members.flatMap((m) => {
    const defaultBranch = defaultByRepo?.[m.path]?.name ?? null;
    const remotes = remotesByRepo.get(m.path) ?? [];
    return m.worktrees.map((w) => {
      const sync = syncByPath?.[w.path];
      const lane: LaneSource = {
        id: w.path,
        repoPath: m.path,
        worktreePath: w.path,
        isMain: w.isMain,
        branch: w.branch,
        defaultBranch,
        unpushedCount: sync?.unpushed ?? null,
        wipCount: sync?.dirtyCount ?? 0,
        error: null,
        remotes,
        color: "",
      };
      return lane;
    });
  });

  return { sources, isLoading: review.isLoading };
}

/**
 * 브랜치 단계인데 그 브랜치가 어느 워크트리에도 체크아웃되지 않았을 때(보는 브랜치 고르기로
 * 로컬 브랜치를 체크아웃 없이 보는 중) 쓸 레인 하나. 원격에 없는 커밋 수는 사이드바 「작업 중인
 * 브랜치」 줄과 같은 조회(`get_working_branches`)의 정확한 `unpushed` 값을 쓴다 — 추적 브랜치가
 * 없어도 세고, 체크아웃 여부와 상관없이 저장소마다 한 번만 조회한다(5.2).
 */
function useUncheckedBranchLane(scope: Scope | null): { lane: LaneSource | null; isLoading: boolean } {
  const needed = scope?.kind === "branch" && scope.worktreePath === null;
  const repoPath = needed && scope ? scope.repoPath : null;
  const [repoBranches] = useWorkingBranches(repoPath ? [repoPath] : []);
  const allRepos = useRepositoryStore((s) => s.repos);

  if (!needed || !scope || scope.kind !== "branch") return { lane: null, isLoading: false };
  const info = repoBranches?.branches.find((b) => b.name === scope.branch);
  const repo = allRepos.find((r) => r.path === scope.repoPath);
  const lane: LaneSource = {
    id: branchLaneId(scope.repoPath, scope.branch),
    repoPath: scope.repoPath,
    worktreePath: null,
    isMain: false,
    branch: scope.branch,
    defaultBranch: repoBranches?.defaultBranch ?? null,
    unpushedCount: info?.unpushed ?? null,
    wipCount: 0,
    error: null,
    remotes: repo?.remotes.map((r) => r.name) ?? [],
    color: "",
  };
  return { lane, isLoading: repoBranches === undefined };
}

/**
 * 지금 범위와 그 레인 목록. 화면이 셋으로 나뉘어도 이 훅 하나로 같은 모양(`LaneSource[]`)을
 * 얻는다 — 단계가 바뀌는 것은 무엇을 조회하느냐일 뿐, 결과의 모양은 같다(시안 `scope-unify.html`
 * 「단계 계약」).
 */
export function useScopeSources(): ScopeSourcesResult {
  const scope = useScope();
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const memberPaths = useMemo((): readonly string[] => {
    if (scope?.kind === "workspace") {
      return workspaces.find((w) => w.id === scope.workspaceId)?.repoPaths ?? EMPTY;
    }
    if (scope?.kind === "repo" || scope?.kind === "branch") return [scope.repoPath];
    return EMPTY;
  }, [scope, workspaces]);

  const { sources: repoSources, isLoading: loadingRepos } = useRepoLaneSources(memberPaths);
  const { lane: extraLane, isLoading: loadingExtra } = useUncheckedBranchLane(scope);

  const sources = useMemo(() => {
    if (!scope) return [];
    let list: LaneSource[];
    if (scope.kind === "branch") {
      const own =
        scope.worktreePath !== null
          ? repoSources.find((s) => s.worktreePath === scope.worktreePath)
          : (extraLane ?? repoSources.find((s) => s.branch === scope.branch));
      list = own ? [own] : [];
    } else {
      list = repoSources;
    }
    const colors = laneColorsFor(scope, list);
    return list.map((s) => ({ ...s, color: colors.get(s.id) ?? s.color }));
  }, [scope, repoSources, extraLane]);

  return { scope, sources, isLoading: loadingRepos || loadingExtra };
}
