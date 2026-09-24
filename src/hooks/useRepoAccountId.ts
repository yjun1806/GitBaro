import { useCallback } from "react";
import { useRepositoryStore, findOwnerRepo } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import type { RepoInfo } from "@/types";

/**
 * 계정 ID를 고른다. 저장소가 열려 있으면 그 저장소에 지정된 계정만 쓴다.
 * 지정된 계정이 없으면 null이다. 직전 저장소의 계정(전역 활성 계정)으로 돌아가지 않는다.
 * 열린 저장소가 없을 때만 전역 활성 계정을 쓴다.
 */
export function pickRepoAccountId(
  ownerRepo: RepoInfo | null,
  activeAccountId: string | null,
): string | null {
  if (ownerRepo) return ownerRepo.accountId ?? null;
  return activeAccountId;
}

/**
 * 현재 저장소에 지정된 계정 ID. 워크트리를 보는 중이면 소유 저장소의 계정을 쓴다.
 * fetch·pull·push, 커밋을 만드는 명령, 툴바 계정 표시가 모두 이 값을 쓴다.
 */
export function useRepoAccountId(): string | null {
  const ownerRepo = useRepositoryStore((s) =>
    findOwnerRepo(s.repos, s.activeRepoPath, s.activeWorktrees),
  );
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  return pickRepoAccountId(ownerRepo, activeAccountId);
}

/**
 * 툴바에서 계정을 고르면 열린 저장소(워크트리면 소유 저장소)에 그 계정을 지정한다.
 * 전역 활성 계정도 함께 바꿔 새 저장소 추가·클론의 기본값으로 쓴다.
 */
export function useAssignRepoAccount(): (accountId: string) => void {
  const updateRepoAccount = useRepositoryStore((s) => s.updateRepoAccount);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  return useCallback(
    (accountId: string) => {
      const { repos, activeRepoPath, activeWorktrees } = useRepositoryStore.getState();
      const ownerRepo = findOwnerRepo(repos, activeRepoPath, activeWorktrees);
      if (ownerRepo) updateRepoAccount(ownerRepo.path, accountId);
      setActiveAccount(accountId);
    },
    [updateRepoAccount, setActiveAccount],
  );
}
