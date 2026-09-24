import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import { useVerifyWorktree } from "@/hooks/useVerifyWorktree";
import { workspaceAccountId, workspaceMemberRepos } from "@/hooks/useActiveScope";
import { gitFetch } from "@/api/commands";

/* ─── Module-level fetch tracker (resets on app restart) ─── */
const fetchedRepos = new Set<string>();

/**
 * 저장소 선택 로직을 공유하는 훅.
 * 저장소를 활성화하고, 연결된 계정을 활성화하며, 최초 1회 백그라운드 fetch를
 * 수행한다. 사이드바 저장소 목록과 퀵 전환 레일에서 동일하게 사용한다.
 *
 * 마지막에 워크트리를 보고 있었다면 그 워크트리로 복원한다(activateRepo).
 *
 * `selectWorkspace`는 워크스페이스를 고른다. 저장소 선택은 풀리고(스토어가 둘 중 하나만
 * 잡는다), 활성 계정은 저장소를 고를 때와 같은 규칙으로 워크스페이스의 계정으로 바꾼다.
 */
export function useSelectRepo() {
  const activateRepo = useRepositoryStore((s) => s.activateRepo);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const verifyWorktree = useVerifyWorktree();
  const queryClient = useQueryClient();
  const [fetchingPath, setFetchingPath] = useState<string | null>(null);

  const selectRepo = useCallback(
    (path: string) => {
      const restoredWorktree = useRepositoryStore.getState().activeWorktrees[path];
      activateRepo(path);
      if (restoredWorktree) {
        verifyWorktree(path, restoredWorktree);
      }
      const latestRepos = useRepositoryStore.getState().repos;
      const repo = latestRepos.find((r) => r.path === path);
      if (repo?.accountId) {
        setActiveAccount(repo.accountId);
      }
      setRepoListOpen(false);

      const repoHasRemote = repo?.remotes && repo.remotes.length > 0;
      if (repo?.accountId && repoHasRemote && !fetchedRepos.has(path)) {
        setFetchingPath(path);
        gitFetch(path, repo.accountId, true)
          .then(() => {
            fetchedRepos.add(path);
            queryClient.invalidateQueries({ queryKey: ["branches"] });
            queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] });
            queryClient.invalidateQueries({ queryKey: ["commitHistory"] });
            queryClient.invalidateQueries({ queryKey: ["status"] });
          })
          .catch(() => {
            // fetch 실패는 무시 (네트워크 문제 등)
          })
          .finally(() => {
            setFetchingPath(null);
          });
      }
    },
    [activateRepo, verifyWorktree, setActiveAccount, setRepoListOpen, queryClient],
  );

  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const selectWorkspace = useCallback(
    (id: string) => {
      const result = setActiveWorkspace(id);
      if (!result.ok) return;
      const { workspaces } = useWorkspaceStore.getState();
      const ws = workspaces.find((w) => w.id === id);
      if (ws) {
        const { accounts } = useAccountStore.getState();
        const members = workspaceMemberRepos(
          id,
          workspaces,
          useRepositoryStore.getState().repos,
          accounts,
        );
        const accountId = workspaceAccountId(ws, members, accounts);
        if (accountId) setActiveAccount(accountId);
      }
      setRepoListOpen(false);
    },
    [setActiveWorkspace, setActiveAccount, setRepoListOpen],
  );

  return { selectRepo, selectWorkspace, fetchingPath };
}
