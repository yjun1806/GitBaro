import { useQuery } from "@tanstack/react-query";
import {
  getStatus,
  getBranches,
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
  getWorktrees,
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
