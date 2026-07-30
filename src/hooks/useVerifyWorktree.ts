import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { getWorktrees } from "@/api/commands";

/**
 * 복원한 워크트리가 아직 살아있는지 확인하고, 사라졌으면 메인 워크트리로 되돌린다.
 *
 * 앱 밖에서 워크트리 폴더를 지워도 git은 `git worktree prune` 전까지 관리 파일을
 * 남겨두므로 목록에는 계속 나타난다. 그래서 "목록에 있는지"가 아니라
 * "prunable이 아닌지"를 봐야 한다. 확인하지 않으면 그 저장소를 고를 때마다 없는
 * 경로로 되돌아가 빠져나올 수 없다.
 *
 * 조회는 소유 저장소 경로로 한다. 현재 워크트리가 끊긴 상태에서도 읽을 수 있고,
 * useWorktrees와 같은 캐시 키를 써서 중복 조회를 피한다.
 */
export function useVerifyWorktree() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const rememberWorktree = useRepositoryStore((s) => s.rememberWorktree);
  const addToast = useToastStore((s) => s.addToast);

  return useCallback(
    (repoPath: string, worktreePath: string) => {
      queryClient
        .fetchQuery({
          queryKey: ["worktrees", repoPath],
          queryFn: () => getWorktrees(repoPath),
        })
        .then((worktrees) => {
          const live = worktrees.find((w) => w.path === worktreePath);
          if (live && !live.isPrunable) return;
          // 확인이 끝나기 전에 사용자가 다른 곳으로 옮겼다면 건드리지 않는다.
          if (useRepositoryStore.getState().activeRepoPath !== worktreePath) return;
          setActiveRepo(repoPath);
          rememberWorktree(repoPath, null);
          addToast(
            t("worktree.missingFallback", {
              path: worktreePath.split("/").pop() || worktreePath,
            }),
            "warning",
          );
        })
        .catch(() => {
          // 목록 조회 실패(일시적 오류 등)로 멀쩡한 워크트리를 되돌리지는 않는다.
        });
    },
    [queryClient, setActiveRepo, rememberWorktree, addToast, t],
  );
}
