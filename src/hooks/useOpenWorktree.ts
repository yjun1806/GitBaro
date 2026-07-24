import { useCallback } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import type { WorktreeInfo } from "@/types";

/**
 * 워크트리로 활성 저장소를 전환하는 공용 훅.
 * 워크트리 이동은 브랜치 전환이 아니라 "저장소 전환"이므로 setActiveRepo를 호출한다.
 * 부모 경로는 메인 워크트리 경로로 고정해 워크트리 간 이동 시에도 기준이 유지된다.
 * 호출부가 이미 구독 중인 worktrees를 넘겨 중복 구독을 피한다.
 */
export function useOpenWorktree(
  activeRepoPath: string | null,
  worktrees: WorktreeInfo[],
) {
  const { mainWorktree } = useWorktreeContext(activeRepoPath, worktrees);

  return useCallback(
    (path: string) => {
      const parentPath = mainWorktree?.path ?? activeRepoPath ?? path;
      useRepositoryStore.getState().setActiveRepo(path, parentPath);
    },
    [mainWorktree, activeRepoPath],
  );
}
