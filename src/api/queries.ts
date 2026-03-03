import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStatus,
  getBranches,
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
} from "./commands";

export function useStatus(repoPath: string | null) {
  return useQuery({
    queryKey: ["status", repoPath],
    queryFn: () => getStatus(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
}

export function useBranches(repoPath: string | null) {
  return useQuery({
    queryKey: ["branches", repoPath],
    queryFn: () => getBranches(repoPath!),
    enabled: repoPath !== null,
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
