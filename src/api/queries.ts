import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStatus,
  getBranches,
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
  getMergeState,
  abortMergeOrRebase,
  continueMergeOrRebase,
} from "./commands";
import type { RepoSyncStatus } from "@/types";

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

/**
 * 여러 레포의 push/pull 필요 상태(ahead/behind)를 한 번에 조회한다.
 * 경로별 `RepoSyncStatus` 맵으로 반환하며, 마지막 fetch 시점 기준이므로
 * 백그라운드 fetch(useBackgroundFetch) 완료 시 `["repoSyncStatus"]` 무효화로
 * 갱신된다. 키를 정렬된 경로 목록으로 삼아 레포 목록 변화에만 반응한다.
 */
export function useRepoSyncStatuses(repoPaths: string[]) {
  const sortedPaths = [...repoPaths].sort();
  return useQuery({
    queryKey: ["repoSyncStatus", sortedPaths],
    queryFn: () => getRepoSyncStatus(sortedPaths),
    enabled: sortedPaths.length > 0,
    staleTime: 15_000,
    select: (statuses): Record<string, RepoSyncStatus> =>
      Object.fromEntries(statuses.map((s) => [s.path, s])),
  });
}

export function useCommitHistory(repoPath: string | null, limit = 50) {
  return useQuery({
    queryKey: ["commitHistory", repoPath, limit],
    queryFn: () => getCommitHistory(repoPath!, limit),
    enabled: repoPath !== null,
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

/** "merge" | "rebase" | null — the git operation currently in progress. */
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
    mutationFn: () => continueMergeOrRebase(repoPath!),
    onSuccess: invalidateAll,
  });

  return { abort, conclude };
}

export function useStashMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  const invalidateStashAndStatus = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stashList"] }),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
    ]);

  const applyMutation = useMutation({
    mutationFn: (index: number) => stashApply(repoPath!, index),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });

  const popMutation = useMutation({
    mutationFn: () => stashPop(repoPath!),
    onSuccess: () => invalidateStashAndStatus(),
  });

  const dropMutation = useMutation({
    mutationFn: (index: number) => stashDrop(repoPath!, index),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stashList"] }),
  });

  const pushMutation = useMutation({
    mutationFn: (message?: string) => stashPush(repoPath!, message),
    onSuccess: () => invalidateStashAndStatus(),
  });

  const pushPartialMutation = useMutation({
    mutationFn: ({ paths, message }: { paths: string[]; message?: string }) =>
      stashPushPartial(repoPath!, paths, message),
    onSuccess: () => invalidateStashAndStatus(),
  });

  return {
    apply: applyMutation,
    pop: popMutation,
    drop: dropMutation,
    push: pushMutation,
    pushPartial: pushPartialMutation,
  };
}
