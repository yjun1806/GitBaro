import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  getStatus,
  getBranches,
  isHeadDetached,
  getBranchDivergence,
  getRepoSyncStatus,
  getRecentBranches,
  getCommitHistory,
  getCommitDetail,
  getCommitFileDiff,
  getAccounts,
  getRepoAccount,
  getSettings,
  getFileDiff,
  validateToken,
  checkGhStatus,
  resolveCommitAvatars,
  compareBranches,
  checkMergeConflicts,
  getWorktrees,
  stashList,
  stashShow,
  stashApply,
  stashDrop,
  stashPush,
  stashPop,
  stashPushPartial,
  listWorkflowRuns,
  getWorkflowRunJobs,
  listRemoteTags,
  getMergeState,
  abortMergeOrRebase,
  continueMergeOrRebase,
} from "./commands";
import type { RepoSyncStatus } from "@/types";
import { useSelectionStore } from "@/stores/selection";
import { selectionAfterStashPushed, selectionAfterStashRemoved } from "@/lib/stash-selection";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";

export function useStatus(repoPath: string | null) {
  return useQuery({
    queryKey: ["status", repoPath],
    queryFn: () => getStatus(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
    // The FS watcher (useRepoWatcher) invalidates this query on file changes,
    // so tight polling is unnecessary. Keep a slow, foreground-only poll as a
    // safety net for changes the watcher might miss (network drives, etc.).
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useBranches(repoPath: string | null) {
  return useQuery({
    queryKey: ["branches", repoPath],
    queryFn: () => getBranches(repoPath!),
    enabled: repoPath !== null,
  });
}

/** Keyed under "branches" so every branch-list invalidation refreshes it too. */
export function useHeadDetached(repoPath: string | null) {
  return useQuery({
    queryKey: ["branches", repoPath, "headDetached"],
    queryFn: () => isHeadDetached(repoPath!),
    enabled: repoPath !== null,
  });
}

/**
 * 각 브랜치의 현재 HEAD 대비 ahead/behind. 브랜치 수가 많은 저장소에서 비싼
 * 계산이라 `get_branches`에서 분리했고, 비교 셀렉터가 열릴 때(enabled)만 조회한다.
 *
 * 값이 HEAD에 의존하므로 캐시를 신선하게 유지하지 않는다(staleTime 0). 브랜치
 * 전환·커밋으로 HEAD가 바뀐 뒤 셀렉터를 다시 열면 항상 최신 HEAD 기준으로
 * 재계산된다. enabled=isOpen이라 열지 않으면 계산 자체가 일어나지 않는다.
 */
export function useBranchDivergence(repoPath: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["branchDivergence", repoPath],
    queryFn: () => getBranchDivergence(repoPath!),
    enabled: repoPath !== null && enabled,
  });
}

/**
 * fetch·pull·push 뒤 원격 상태와 작업 트리에 기대는 쿼리를 모두 무효화한다.
 * 툴바 동기화 버튼과 원격 자동 최신화가 함께 쓴다.
 *
 * `reviewStatus`·`workspaceHistory`도 포함한다. 워크스페이스 리뷰 화면의 그래프는
 * `reviewStatus`(HEAD oid)와 `["workspaceHistory", path, headOid]`로 만드는데, 빠지면
 * pull·push 뒤에도 `REVIEW_POLL_MS`(20초)까지 옛 HEAD·원격 라벨·병합 기준점을 그대로
 * 보여 준다(W5 리뷰에서 찾음).
 */
export function invalidateAfterSync(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [
      "branches",
      "repoSyncStatus",
      "commitHistory",
      "status",
      "mergeState",
      "fileDiff",
      "remoteTags",
      "reviewStatus",
      "workspaceHistory",
      // 「파일별 변경」(D7) 탭도 push·pull로 바뀐다 — 특히 push 뒤 "커밋 아직 안 올림" 안내와
      // pull 뒤의 파일 목록. 빠지면 최대 30초(staleTime) 동안 옛 목록이 남는다(W7 리뷰).
      "changesVsDefault",
      "fileDiffVsDefault",
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}

/**
 * 여러 레포의 push/pull 필요 상태(ahead/behind)를 한 번에 조회한다.
 * 경로별 `RepoSyncStatus` 맵으로 반환하며, 마지막 fetch 시점 기준이므로
 * 원격 자동 최신화(useAutoSync) 완료 시 `["repoSyncStatus"]` 무효화로
 * 갱신된다. 키를 정렬된 경로 목록으로 삼아 레포 목록 변화에만 반응한다.
 */
export function useRepoSyncStatuses(repoPaths: string[]) {
  const sortedPaths = [...repoPaths].sort();
  return useQuery({
    queryKey: ["repoSyncStatus", sortedPaths],
    queryFn: () => getRepoSyncStatus(sortedPaths),
    enabled: sortedPaths.length > 0,
    staleTime: 15_000,
    // 오프라인 libgit2 계산이라 저비용 — 전체 레포의 dirty/ahead가 이벤트 없이도
    // 주기적으로 갱신되도록 포그라운드 폴링을 둔다. behind는 원격 자동 최신화(useAutoSync)가 갱신.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    select: (statuses): Record<string, RepoSyncStatus> =>
      Object.fromEntries(statuses.map((s) => [s.path, s])),
  });
}

/** 커밋 히스토리 페이지 크기 — 스크롤 시 이 단위로 추가 로드한다. */
const COMMIT_HISTORY_PAGE_SIZE = 50;

/**
 * 커밋 히스토리를 무한 스크롤로 조회한다. 백엔드 get_commit_history의 offset을
 * 활용해 스크롤 시 다음 페이지를 이어 붙인다. 마지막 페이지가 페이지 크기보다
 * 적으면 끝으로 판단한다. 키 접두어를 ["commitHistory"]로 유지해 기존 무효화
 * (commit·switch·fetch 등)가 그대로 적용된다.
 */
export function useCommitHistoryInfinite(repoPath: string | null) {
  return useInfiniteQuery({
    queryKey: ["commitHistory", repoPath],
    queryFn: ({ pageParam }) => getCommitHistory(repoPath!, COMMIT_HISTORY_PAGE_SIZE, pageParam),
    enabled: repoPath !== null,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === COMMIT_HISTORY_PAGE_SIZE
        ? allPages.length * COMMIT_HISTORY_PAGE_SIZE
        : undefined,
  });
}

/**
 * origin에 존재하는 태그 이름 목록. 히스토리에서 로컬 전용 태그를 구분하는 데
 * 쓴다. 네트워크 호출이므로 저장소·계정이 모두 있을 때만 실행하고, push/fetch
 * 성공 시 ["remoteTags"] 키를 무효화해 갱신한다.
 */
export function useRemoteTags(repoPath: string | null, accountId: string | null) {
  return useQuery({
    queryKey: ["remoteTags", repoPath, accountId],
    queryFn: () => listRemoteTags(repoPath!, accountId!),
    enabled: repoPath !== null && accountId !== null,
    staleTime: 60_000,
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });
}

export function useRepoAccount(repoPath: string | null, remoteName: string) {
  return useQuery({
    queryKey: ["repoAccount", repoPath, remoteName],
    queryFn: () => getRepoAccount(repoPath!, remoteName),
    enabled: repoPath !== null,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });
}

export function useFileDiff(repoPath: string | null, filePath: string | null, staged: boolean) {
  return useQuery({
    queryKey: ["fileDiff", repoPath, filePath, staged],
    queryFn: () => getFileDiff(repoPath!, filePath!, staged),
    enabled: repoPath !== null && filePath !== null,
  });
}

export function useTokenValidation(accountId: string | null, repoPath: string | null) {
  return useQuery({
    queryKey: ["tokenValidation", accountId, repoPath],
    queryFn: () => validateToken(accountId!, repoPath!),
    enabled: accountId !== null && repoPath !== null,
    retry: false,
  });
}

export function useCommitDetail(repoPath: string | null, oid: string | null) {
  return useQuery({
    queryKey: ["commitDetail", repoPath, oid],
    queryFn: () => getCommitDetail(repoPath!, oid!),
    enabled: repoPath !== null && oid !== null,
  });
}

export function useCommitFileDiff(repoPath: string | null, oid: string | null, filePath: string | null) {
  return useQuery({
    queryKey: ["commitFileDiff", repoPath, oid, filePath],
    queryFn: () => getCommitFileDiff(repoPath!, oid!, filePath!),
    enabled: repoPath !== null && oid !== null && filePath !== null,
  });
}

export function useCommitAvatars(repoPath: string | null) {
  return useQuery({
    queryKey: ["commitAvatars", repoPath],
    queryFn: () => resolveCommitAvatars(repoPath!),
    enabled: repoPath !== null,
    staleTime: 5 * 60 * 1000, // 5min cache
    retry: false,
  });
}

export function useBranchComparison(
  repoPath: string | null,
  baseBranch: string | null,
  compareBranch: string | null,
) {
  return useQuery({
    queryKey: ["branchComparison", repoPath, baseBranch, compareBranch],
    queryFn: () => compareBranches(repoPath!, baseBranch!, compareBranch!),
    enabled: repoPath !== null && baseBranch !== null && compareBranch !== null,
  });
}

export function useMergeConflictCheck(
  repoPath: string | null,
  branch: string | null,
) {
  return useQuery({
    queryKey: ["mergeConflictCheck", repoPath, branch],
    queryFn: () => checkMergeConflicts(repoPath!, branch!),
    enabled: repoPath !== null && branch !== null,
    staleTime: 30_000,
    retry: false,
  });
}

export function useGhStatus() {
  return useQuery({
    queryKey: ["ghStatus"],
    queryFn: checkGhStatus,
    staleTime: 60_000,
  });
}

export function useWorktrees(repoPath: string | null) {
  return useQuery({
    queryKey: ["worktrees", repoPath],
    queryFn: () => getWorktrees(repoPath!),
    enabled: repoPath !== null,
  });
}

export function useRecentBranches(repoPath: string | null, limit = 5) {
  return useQuery({
    queryKey: ["recentBranches", repoPath, limit],
    queryFn: () => getRecentBranches(repoPath!, limit),
    enabled: repoPath !== null,
  });
}

// ── Stash ────────────────────────────────────────────────────────────────────

export function useStashList(repoPath: string | null) {
  return useQuery({
    queryKey: ["stashList", repoPath],
    queryFn: () => stashList(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

export function useStashShow(repoPath: string | null, index: number | null) {
  return useQuery({
    queryKey: ["stashShow", repoPath, index],
    queryFn: () => stashShow(repoPath!, index!),
    enabled: repoPath !== null && index !== null,
  });
}

// ── Actions (GitHub Actions) ────────────────────────────────────────────────

export function useWorkflowRuns(
  repoPath: string | null,
  accountId: string | null,
  options?: { polling?: boolean },
) {
  const polling = options?.polling ?? false;
  return useQuery({
    queryKey: ["workflowRuns", repoPath, accountId],
    queryFn: () => listWorkflowRuns(repoPath!, accountId!),
    enabled: repoPath !== null && accountId !== null,
    refetchInterval: polling ? 30_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

export function useWorkflowRunJobs(
  repoPath: string | null,
  accountId: string | null,
  runId: number | null,
) {
  return useQuery({
    queryKey: ["workflowRunJobs", repoPath, accountId, runId],
    queryFn: () => getWorkflowRunJobs(repoPath!, accountId!, runId!),
    enabled: repoPath !== null && accountId !== null && runId !== null,
  });
}

// ── Stash Mutations ─────────────────────────────────────────────────────────

/** The git operation currently in progress, or null. */
export function useMergeState(repoPath: string | null) {
  return useQuery({
    queryKey: ["mergeState", repoPath],
    queryFn: () => getMergeState(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

export function useMergeRecoveryMutations(repoPath: string | null) {
  const queryClient = useQueryClient();
  // merge를 마무리하며 만드는 커밋도 저장소 계정으로 기록한다.
  const accountId = useRepoAccountId();

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["status"] }),
      queryClient.invalidateQueries({ queryKey: ["mergeState"] }),
      queryClient.invalidateQueries({ queryKey: ["branches"] }),
      queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
    ]);

  const abort = useMutation({
    mutationFn: () => abortMergeOrRebase(repoPath!),
    onSuccess: invalidateAll,
  });

  const conclude = useMutation({
    mutationFn: () => continueMergeOrRebase(repoPath!, accountId),
    onSuccess: invalidateAll,
  });

  return { abort, conclude };
}

export function useStashMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  // stashShow is keyed by index, so any change to the list makes it stale.
  const invalidateStash = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stashList"] }),
      queryClient.invalidateQueries({ queryKey: ["stashShow"] }),
    ]);

  const invalidateStashAndStatus = () =>
    Promise.all([
      invalidateStash(),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
    ]);

  const onStashRemoved = (index: number) => {
    const { selectedStashIndex, selectStash } = useSelectionStore.getState();
    selectStash(selectionAfterStashRemoved(selectedStashIndex, index));
  };

  const onStashPushed = (oid: string | null) => {
    if (oid === null) return;
    const { selectedStashIndex, selectStash } = useSelectionStore.getState();
    selectStash(selectionAfterStashPushed(selectedStashIndex));
  };

  const applyMutation = useMutation({
    mutationFn: (index: number) => stashApply(repoPath!, index),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });

  const popMutation = useMutation({
    mutationFn: (index: number) => stashPop(repoPath!, index),
    onSuccess: (_data, index) => {
      onStashRemoved(index);
      return invalidateStashAndStatus();
    },
    // A conflicting pop applies the changes but keeps the entry.
    onError: () => invalidateStashAndStatus(),
  });

  const dropMutation = useMutation({
    mutationFn: (index: number) => stashDrop(repoPath!, index),
    onSuccess: (_data, index) => {
      onStashRemoved(index);
      return invalidateStash();
    },
  });

  const pushMutation = useMutation({
    mutationFn: (message?: string) => stashPush(repoPath!, message),
    onSuccess: (oid) => {
      onStashPushed(oid);
      return invalidateStashAndStatus();
    },
  });

  const pushPartialMutation = useMutation({
    mutationFn: ({ paths, message }: { paths: string[]; message?: string }) =>
      stashPushPartial(repoPath!, paths, message),
    onSuccess: (oid) => {
      onStashPushed(oid);
      return invalidateStashAndStatus();
    },
  });

  return {
    apply: applyMutation,
    pop: popMutation,
    drop: dropMutation,
    push: pushMutation,
    pushPartial: pushPartialMutation,
  };
}

// W1-T4 — 새 커밋 기준선

import { keepPreviousData } from "@tanstack/react-query";
import { reviewStatus, countNewCommits } from "./commands";
import type { SeenRecordInput } from "@/types";

/** 사이드바 펼침 여부와 상관없이 20초마다 워크트리 목록과 HEAD를 다시 읽는다. */
export const REVIEW_POLL_MS = 20_000;

export function useReviewStatusQuery(repoPaths: string[]) {
  return useQuery({
    queryKey: ["reviewStatus", repoPaths],
    queryFn: () => reviewStatus(repoPaths),
    enabled: repoPaths.length > 0,
    refetchInterval: REVIEW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/**
 * `inputs`가 null이면 멈춘다(첫 기준선을 잡기 전). 기준선이나 `headsKey`(워크트리 HEAD 목록)가
 * 바뀌면 키가 바뀌어 바로 다시 세고, 그 밖에는 20초마다 센다(기반 브랜치가 움직인 경우).
 */
export function useNewCommitCountsQuery(inputs: SeenRecordInput[] | null, headsKey: string) {
  return useQuery({
    queryKey: ["newCommitCounts", inputs, headsKey],
    queryFn: () => countNewCommits(inputs ?? []),
    enabled: inputs !== null && inputs.length > 0,
    refetchInterval: REVIEW_POLL_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

// W3-T3

import { listNewCommitIds } from "./commands";

/**
 * 커밋 그래프가 새 커밋 점을 찍을 커밋 목록. `entry`가 null이면 멈춘다(첫 기준선을 잡기 전).
 * 기준선이나 `headOid`가 바뀌면 키가 바뀌어 바로 다시 센다. 앞 결과를 이어서 보여 주지 않는다:
 * 「확인함으로 표시」를 누른 뒤 옛 개수와 점이 남아 있지 않게 한다.
 */
export function useNewCommitIdsQuery(entry: SeenRecordInput | null, headOid: string | null) {
  return useQuery({
    queryKey: ["newCommitIds", entry, headOid],
    queryFn: () => listNewCommitIds(entry as SeenRecordInput),
    enabled: entry !== null,
    refetchInterval: REVIEW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

// W3-T4
import { useCallback, useSyncExternalStore } from "react";
import type { InfiniteData, QueryState } from "@tanstack/react-query";
import type { BranchInfo, CommitInfo, WorkflowRun } from "@/types";

/**
 * Reads a value from the query cache without adding an observer, so reading
 * never starts a fetch. Re-renders when the cache changes. `read` must return
 * a primitive or an object that already lives in the cache, so the snapshot
 * stays stable between changes.
 */
function useQueryCacheValue<T>(read: (client: QueryClient) => T): T {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client],
  );
  return useSyncExternalStore(subscribe, () => read(client));
}

/**
 * `isUnpushed` of one commit from the history list other screens already
 * loaded. undefined when the commit is not in the loaded pages.
 */
export function useCachedCommitIsUnpushed(
  repoPath: string | null,
  commitId: string,
): boolean | undefined {
  return useQueryCacheValue((client) =>
    client
      .getQueryData<InfiniteData<CommitInfo[]>>(["commitHistory", repoPath])
      ?.pages.flat()
      .find((c) => c.id === commitId)?.isUnpushed,
  );
}

/**
 * Sync status of one repository, taken from whichever `repoSyncStatus` query
 * (sidebar, repo list, live changes) holds it, newest first. Adds no scan of
 * its own.
 */
export function useCachedRepoSyncStatus(repoPath: string | null): RepoSyncStatus | undefined {
  return useQueryCacheValue((client) => {
    if (!repoPath) return undefined;
    const queries = client
      .getQueryCache()
      .findAll({ queryKey: ["repoSyncStatus"] })
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    for (const query of queries) {
      const hit = (query.state.data as RepoSyncStatus[] | undefined)?.find(
        (s) => s.path === repoPath,
      );
      if (hit) return hit;
    }
    return undefined;
  });
}

/**
 * Upstream of the checked-out branch (for example "upstream/feat") from the
 * cached branch list. null when the branch has no upstream, undefined when
 * the list is not loaded.
 */
export function useCachedHeadUpstream(repoPath: string | null): string | null | undefined {
  return useQueryCacheValue((client) => {
    const branches = client.getQueryData<BranchInfo[]>(["branches", repoPath]);
    if (!branches) return undefined;
    return branches.find((b) => b.isHead && !b.isRemote)?.upstream ?? null;
  });
}

/** Cache state of the workflow run list that the graph panel loads. */
export function useCachedWorkflowRunsState(
  repoPath: string | null,
  accountId: string | null,
): QueryState<WorkflowRun[]> | undefined {
  return useQueryCacheValue((client) =>
    client.getQueryState<WorkflowRun[]>(["workflowRuns", repoPath, accountId]),
  );
}

// W4-T3 — 워크스페이스 리뷰 화면

import { hashKey, useQueries } from "@tanstack/react-query";
import { getWorkspaceHistory } from "./commands";
import type { NewCommitIds, StatusEntry, WorkspaceRepoHistory } from "@/types";

/** 워크스페이스 타임라인에서 저장소마다 불러올 커밋 수. */
export const WORKSPACE_HISTORY_LIMIT = 100;

/**
 * 조건에 맞는 캐시 중 가장 최근에 받은 데이터. `useQueries`에서는 키가 바뀌면 관찰자가 새로
 * 만들어져 `keepPreviousData`가 넘겨줄 이전 값이 없다. 그래서 키 앞부분이 같은 캐시에서
 * 직접 찾아 자리 표시 데이터로 쓴다(HEAD가 바뀔 때 레인이 잠깐 사라지지 않게).
 */
export function latestCachedData<T>(
  client: QueryClient,
  matches: (queryKey: readonly unknown[]) => boolean,
): T | undefined {
  let best: { at: number; data: T } | undefined;
  for (const q of client.getQueryCache().findAll({ predicate: (query) => matches(query.queryKey) })) {
    const data = q.state.data as T | undefined;
    if (data !== undefined && (!best || q.state.dataUpdatedAt > best.at)) {
      best = { at: q.state.dataUpdatedAt, data };
    }
  }
  return best?.data;
}

/**
 * 저장소마다 따로 부르는 워크스페이스 타임라인. 키 앞부분이 `["workspaceHistory", repoPath]`라
 * 저장소 하나만 무효화할 수 있다. `headOid`(리뷰 스캔의 HEAD)가 키에 들어 있어 커밋이 생기면
 * 바로 다시 읽는다. `.git/` 안쪽 변경(외부 push로 원격 추적 브랜치가 옮겨가거나, fetch로
 * origin/main이 옮겨가는 경우 등)은 활동 이벤트가 오지 않아 HEAD만으로는 못 잡으므로,
 * `REVIEW_POLL_MS`마다 폴링해 참조 라벨과 갈라진 지점을 최신으로 유지한다(리뷰 화면의 다른
 * 쿼리와 같은 주기). 다시 읽는 동안에는 같은 저장소의 마지막 결과를 그대로 보여 준다.
 * 결과는 `repos` 순서와 같고, 한 번도 못 읽은 저장소는 undefined다.
 */
export function useWorkspaceHistories(
  repos: readonly { path: string; headOid: string | null }[],
): (WorkspaceRepoHistory | undefined)[] {
  const client = useQueryClient();
  return useQueries({
    queries: repos.map(({ path, headOid }) => ({
      queryKey: ["workspaceHistory", path, headOid, WORKSPACE_HISTORY_LIMIT],
      queryFn: async () => (await getWorkspaceHistory([path], WORKSPACE_HISTORY_LIMIT))[0],
      refetchInterval: REVIEW_POLL_MS,
      refetchIntervalInBackground: false,
      placeholderData: (previous: WorkspaceRepoHistory | undefined) =>
        previous ??
        latestCachedData<WorkspaceRepoHistory>(
          client,
          (key) => key[0] === "workspaceHistory" && key[1] === path,
        ),
    })),
    combine: (results) => results.map((r) => r.data),
  });
}

/**
 * 저장소 HEAD부터의 최근 커밋(`get_commit_history`). 새 커밋 중 타임라인(main과 갈라진 뒤의
 * 커밋)에 없는 커밋을 그리려고 부른다. main에 있는 저장소에서 pull로 받았거나 원격이 없는
 * main에 바로 쌓인 커밋이 그렇다. 결과는 경로 → 커밋 목록(최신 순)이다.
 */
export function useWorkspaceRecentCommits(
  repos: readonly { path: string; headOid: string }[],
): Record<string, CommitInfo[]> {
  const client = useQueryClient();
  return useQueries({
    queries: repos.map(({ path, headOid }) => ({
      queryKey: ["workspaceRecentCommits", path, headOid, WORKSPACE_HISTORY_LIMIT],
      queryFn: () => getCommitHistory(path, WORKSPACE_HISTORY_LIMIT, 0),
      placeholderData: (previous: CommitInfo[] | undefined) =>
        previous ??
        latestCachedData<CommitInfo[]>(
          client,
          (key) => key[0] === "workspaceRecentCommits" && key[1] === path,
        ),
    })),
    combine: (results) => {
      const out: Record<string, CommitInfo[]> = {};
      results.forEach((r, i) => {
        if (r.data) out[repos[i].path] = r.data;
      });
      return out;
    },
  });
}

/**
 * 여러 워크트리의 커밋하지 않은 변경. 키가 `useStatus`와 같아(`["status", path]`) 캐시를 같이 쓴다.
 * 결과는 경로 → 목록이고, 아직 못 읽은 경로는 빠진다.
 */
export function useStatusMany(paths: readonly string[]): Record<string, StatusEntry[]> {
  return useQueries({
    queries: paths.map((path) => ({
      queryKey: ["status", path],
      queryFn: () => getStatus(path),
      staleTime: 0,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    })),
    combine: (results) => {
      const out: Record<string, StatusEntry[]> = {};
      results.forEach((r, i) => {
        if (r.data) out[paths[i]] = r.data;
      });
      return out;
    },
  });
}

/**
 * 여러 워크트리의 새 커밋. 키가 `useNewCommitIdsQuery`와 같아 단일 저장소 그래프와 캐시를 같이 쓴다.
 * HEAD가 바뀌어 다시 세는 동안에는 같은 기준선으로 센 마지막 결과를 보여 준다(기준선이 바뀌면,
 * 곧 「확인함」을 누른 뒤에는 옛 수를 다시 보이지 않는다).
 * 결과는 경로 → 응답이고, 아직 못 센 경로는 빠진다.
 */
export function useNewCommitIdsMany(
  entries: readonly { entry: SeenRecordInput; headOid: string | null }[],
): Record<string, NewCommitIds> {
  const client = useQueryClient();
  return useQueries({
    queries: entries.map(({ entry, headOid }) => {
      const entryHash = hashKey([entry]);
      return {
        queryKey: ["newCommitIds", entry, headOid],
        queryFn: () => listNewCommitIds(entry),
        refetchInterval: REVIEW_POLL_MS,
        refetchIntervalInBackground: false,
        placeholderData: (previous: NewCommitIds | undefined) =>
          previous ??
          latestCachedData<NewCommitIds>(
            client,
            (key) => key[0] === "newCommitIds" && hashKey([key[1]]) === entryHash,
          ),
      };
    }),
    combine: (results) => {
      const out: Record<string, NewCommitIds> = {};
      for (const r of results) if (r.data) out[r.data.path] = r.data;
      return out;
    },
  });
}

// W5-T3
import { getBranchBases } from "./commands";
import { createBatchLoader } from "@/lib/batch-loader";
import type { BranchBaseInfo } from "@/types";

/** 백엔드 `branch_bases`가 한 번에 계산하는 브랜치 수(`MAX_BRANCH_BASES`)와 맞춘다. */
const BRANCH_BASE_BATCH = 60;

/**
 * 같은 순간에 시작된 행들의 기반 브랜치 조회를 저장소별로 한 번의 `branch_bases` 호출로 묶는다.
 * 그래야 저장소 열기·기본 브랜치 찾기를 행마다 되풀이하지 않는다.
 */
const loadBranchBase = createBatchLoader<BranchBaseInfo>(async (repoPath, names) => {
  const infos = await getBranchBases(repoPath, names);
  return new Map(infos.map((info) => [info.name, info]));
}, BRANCH_BASE_BATCH);

/**
 * 브랜치 패널에 보이는 행의 기반 브랜치. 브랜치마다 따로 캐시해 스크롤해도 이미 받은
 * 값은 다시 묻지 않고, 한꺼번에 필요한 행은 한 번의 호출로 묻는다.
 * 키를 "branches" 아래에 두어 브랜치 목록을 무효화하는 곳(전환·커밋·merge·fetch·파일 감시)이
 * 기반 브랜치도 함께 새로 받게 한다.
 * 결과는 브랜치 이름 → 기반 정보(기반을 모르면 `base`가 null)이고, 아직 못 받은 이름은 빠진다.
 */
export function useBranchBases(
  repoPath: string | null,
  names: readonly string[],
): ReadonlyMap<string, BranchBaseInfo> {
  return useQueries({
    queries: names.map((name) => ({
      queryKey: ["branches", repoPath, "base", name],
      queryFn: async (): Promise<BranchBaseInfo> =>
        (await loadBranchBase(repoPath!, name)) ?? { name, base: null, mergedIntoBase: false },
      enabled: repoPath !== null,
      staleTime: 30_000,
    })),
    combine: (results) => {
      const out = new Map<string, BranchBaseInfo>();
      results.forEach((r, i) => {
        if (r.data !== undefined) out.set(names[i], r.data);
      });
      return out;
    },
  });
}

// W6-T1 — 따라가기(D4)
import { getWipFiles } from "@/api/commands";

/**
 * 워크트리 하나의 커밋하지 않은 변경 파일. 수정 시각이 늦은 순서다(`get_wip_files`).
 * 갱신 신호는 `repo:activity`다(따라가기가 쿼리를 무효화한다).
 */
export function useWipFiles(path: string | null) {
  return useQuery({
    queryKey: ["wipFiles", path],
    queryFn: () => getWipFiles(path!),
    enabled: path !== null,
  });
}

/**
 * `useFileDiff`와 같은 캐시 항목으로 diff 하나를 읽는다. 따라가기가 시작할 때 이미 바뀌어
 * 있던 파일의 내용을 비교 기준으로 기억해 두는 데 쓴다.
 */
export function fetchFileDiff(
  queryClient: QueryClient,
  repoPath: string,
  filePath: string,
  staged: boolean,
) {
  return queryClient.fetchQuery({
    queryKey: ["fileDiff", repoPath, filePath, staged],
    queryFn: () => getFileDiff(repoPath, filePath, staged),
  });
}

// W6-T2 — 워크트리 칩·겹침 경고(D5)

/** 같은 저장소의 다른 워크트리 파일 목록을 다시 읽는 주기. 따라가는 워크트리만 이벤트로 갱신한다. */
export const SIBLING_WIP_POLL_MS = 20_000;

/**
 * 워크트리 여러 곳의 커밋하지 않은 파일(`useWipFiles`와 같은 캐시 항목). 결과는 `paths` 순서다.
 * 따라가지 않는 워크트리는 감시 이벤트로 무효화되지 않으므로 주기적으로 다시 읽는다.
 */
export function useWipFilesMany(paths: readonly string[]) {
  return useQueries({
    queries: paths.map((path) => ({
      queryKey: ["wipFiles", path],
      queryFn: () => getWipFiles(path),
      refetchInterval: SIBLING_WIP_POLL_MS,
      refetchIntervalInBackground: false,
    })),
  });
}

/**
 * 같은 파일을 고치는 다른 워크트리들의 그 파일 diff(`useFileDiff`와 같은 캐시 항목). 결과는 `sides` 순서다.
 * 겹침 경고가 보고 있는 파일 하나에만 쓴다. 따라가지 않는 워크트리는 감시 이벤트로 갱신되지
 * 않으므로 파일 목록과 같은 주기로 다시 읽는다.
 */
export function useSiblingFileDiffs(
  sides: readonly { path: string; staged: boolean }[],
  filePath: string | null,
) {
  return useQueries({
    queries: sides.map(({ path, staged }) => ({
      queryKey: ["fileDiff", path, filePath, staged],
      queryFn: () => getFileDiff(path, filePath!, staged),
      enabled: filePath !== null,
      refetchInterval: SIBLING_WIP_POLL_MS,
      refetchIntervalInBackground: false,
    })),
  });
}

/**
 * 워크트리마다 HEAD 이력의 첫 페이지. 그래프에 다른 워크트리의 커밋을 함께 그릴 때 쓴다.
 * HEAD가 바뀌면 키가 바뀌어 다시 읽는다(HEAD는 워크트리 목록 조회에서 온다).
 */
export function useWorktreeHeadHistories(heads: readonly { path: string; head: string }[]) {
  return useQueries({
    queries: heads.map(({ path, head }) => ({
      queryKey: ["worktreeHeadHistory", path, head],
      queryFn: () => getCommitHistory(path, COMMIT_HISTORY_PAGE_SIZE, 0),
      staleTime: 30_000,
    })),
  });
}

// W7-T1 — 파일별 변경(D7)
import { getChangesVsDefault, getFileDiffVsDefault } from "@/api/commands";

/** 「파일별 변경」 목록을 다시 읽는 주기. `repo:activity`를 받으면 그 저장소는 바로 다시 읽는다. */
export const CHANGES_VS_DEFAULT_POLL_MS = 30_000;

/** 저장소마다 main 대비 변경(`get_changes_vs_default`). 결과는 `paths` 순서다. */
export function useChangesVsDefaultMany(paths: readonly string[]) {
  return useQueries({
    queries: paths.map((path) => ({
      queryKey: ["changesVsDefault", path],
      queryFn: () => getChangesVsDefault(path),
      refetchInterval: CHANGES_VS_DEFAULT_POLL_MS,
      refetchIntervalInBackground: false,
    })),
  });
}

/** 파일 여러 개의 main 대비 diff. 연결된 변경을 찾을 때 추가된 줄을 읽는 데 쓴다. 결과는 `files` 순서다. */
export function useFileDiffsVsDefault(
  files: readonly { repoPath: string; filePath: string; oldPath: string | null }[],
) {
  return useQueries({
    queries: files.map(({ repoPath, filePath, oldPath }) => ({
      queryKey: ["fileDiffVsDefault", repoPath, filePath, oldPath],
      queryFn: () => getFileDiffVsDefault(repoPath, filePath, oldPath),
      staleTime: 30_000,
    })),
  });
}
