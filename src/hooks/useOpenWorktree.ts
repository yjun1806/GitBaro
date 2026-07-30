import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { getBranches, getStatus } from "@/api/commands";
import type { WorktreeInfo } from "@/types";

/**
 * 워크트리로 활성 저장소를 전환하는 공용 훅.
 * 워크트리 이동은 브랜치 전환이 아니라 "저장소 전환"이므로 setActiveRepo를 호출한다.
 * 부모 경로는 메인 워크트리 경로로 고정해 워크트리 간 이동 시에도 기준이 유지된다.
 * 호출부가 이미 구독 중인 worktrees를 넘겨 중복 구독을 피한다.
 *
 * 전환 후 새 경로의 브랜치·상태가 준비될 때까지 브랜치 전환과 동일한 로딩
 * 피드백(isSwitchingBranch)을 유지해, 큰 저장소에서 "멈춤"으로 보이지 않게 한다.
 *
 * 실제로 열리는 데 성공한 워크트리만 기억한다(rememberWorktree). 열지 못한 경로를
 * 기억하면 다음에 이 저장소를 고를 때 다시 그 경로로 복원되고, 저장까지 되어
 * 앱을 재시작해도 따라온다.
 */
export function useOpenWorktree(
  activeRepoPath: string | null,
  worktrees: WorktreeInfo[],
) {
  const { mainWorktree } = useWorktreeContext(activeRepoPath, worktrees);
  const queryClient = useQueryClient();

  return useCallback(
    async (path: string) => {
      const parentPath = mainWorktree?.path ?? activeRepoPath ?? path;
      const { setActiveRepo, rememberWorktree } = useRepositoryStore.getState();
      const { setSwitchingBranch } = useUIStore.getState();
      setSwitchingBranch(true);
      setActiveRepo(path, parentPath);
      rememberWorktree(parentPath, null);
      try {
        await Promise.all([
          queryClient.fetchQuery({
            queryKey: ["branches", path],
            queryFn: () => getBranches(path),
          }),
          queryClient.fetchQuery({
            queryKey: ["status", path],
            queryFn: () => getStatus(path),
          }),
        ]);
        if (path !== parentPath) {
          rememberWorktree(parentPath, path);
        }
      } finally {
        setSwitchingBranch(false);
      }
    },
    [mainWorktree, activeRepoPath, queryClient],
  );
}
