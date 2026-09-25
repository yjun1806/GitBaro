import { useMemo } from "react";
import { useReviewStatusQuery } from "@/api/queries";
import type { RepoReviewStatus, ReviewWorktree } from "@/types";

/** 워크트리 하나와 그 워크트리가 속한 저장소. */
export interface WorktreeReviewStatus extends ReviewWorktree {
  repoPath: string;
}

/** 스캔 결과를 워크트리 경로별로 편다. */
function mergeReviewStatus(repos: RepoReviewStatus[]): Record<string, WorktreeReviewStatus> {
  const out: Record<string, WorktreeReviewStatus> = {};
  for (const repo of repos) {
    for (const wt of repo.worktrees) out[wt.path] = { ...wt, repoPath: repo.repoPath };
  }
  return out;
}

/** 등록된 저장소들의 워크트리 목록과 각 워크트리의 브랜치·HEAD. 20초마다 다시 읽는다. */
export function useReviewStatus(repoPaths: string[]) {
  const scan = useReviewStatusQuery(repoPaths);
  const repos = useMemo(() => scan.data ?? [], [scan.data]);
  const byPath = useMemo(() => mergeReviewStatus(repos), [repos]);
  return { repos, byPath, isLoading: scan.isLoading };
}
