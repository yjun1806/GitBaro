import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useUIStore } from "@/stores/ui";
import { gitFetch } from "@/api/commands";

/* ─── Module-level fetch tracker (resets on app restart) ─── */
const fetchedRepos = new Set<string>();

/**
 * 저장소 선택 로직을 공유하는 훅.
 * 저장소를 활성화하고, 연결된 계정을 활성화하며, 최초 1회 백그라운드 fetch를
 * 수행한다. 사이드바 저장소 목록과 퀵 전환 레일에서 동일하게 사용한다.
 */
export function useSelectRepo() {
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const queryClient = useQueryClient();
  const [fetchingPath, setFetchingPath] = useState<string | null>(null);

  const selectRepo = useCallback(
    (path: string) => {
      setActiveRepo(path);
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
    [setActiveRepo, setActiveAccount, setRepoListOpen, queryClient],
  );

  return { selectRepo, fetchingPath };
}
