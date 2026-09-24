import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { getBranches, getStatus } from "@/api/commands";
import { getErrorMessage } from "@/lib/utils";
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
 *
 * 열지 못하면(폴더가 사라졌거나 git이 읽지 못하면) 이전 위치로 되돌리고 이유를
 * 알린다. 그대로 두면 없는 경로를 가리킨 채 모든 조회가 실패해 빈 화면만 남는다.
 */
export function useOpenWorktree(
  activeRepoPath: string | null,
  worktrees: WorktreeInfo[],
) {
  const { mainWorktree } = useWorktreeContext(activeRepoPath, worktrees);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useCallback(
    async (path: string) => {
      const parentPath = mainWorktree?.path ?? activeRepoPath ?? path;
      const { setActiveRepo, rememberWorktree } = useRepositoryStore.getState();
      const { setSwitchingBranch } = useUIStore.getState();
      const { addToast } = useToastStore.getState();
      const name = path.split("/").pop() || path;

      // 목록에서 이미 사라진 것으로 알려진 워크트리는 전환하지 않는다.
      if (worktrees.some((w) => w.path === path && w.isPrunable)) {
        addToast(t("worktree.openFailed", { path: name, error: t("worktree.missingHint") }), "error");
        return;
      }

      const before = useRepositoryStore.getState();
      const previousPath = before.activeRepoPath;
      const previousOwner = before.activeRepo?.path;
      const previousRemembered = before.activeWorktrees[parentPath] ?? null;

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
      } catch (err) {
        // 기다리는 사이 사용자가 다른 곳으로 옮겼다면 그 선택을 덮어쓰지 않는다.
        if (useRepositoryStore.getState().activeRepoPath === path && previousPath) {
          setActiveRepo(previousPath, previousOwner);
          rememberWorktree(parentPath, previousRemembered);
        }
        // 폴더가 사라진 경우 목록이 prunable로 다시 그려지도록 새로 읽는다.
        queryClient.invalidateQueries({ queryKey: ["worktrees"] });
        addToast(t("worktree.openFailed", { path: name, error: getErrorMessage(err) }), "error");
      } finally {
        setSwitchingBranch(false);
      }
    },
    [mainWorktree, activeRepoPath, worktrees, queryClient, t],
  );
}
