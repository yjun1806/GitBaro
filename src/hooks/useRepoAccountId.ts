import { useRepositoryStore, findOwnerRepo } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";

/**
 * 현재 저장소에 지정된 계정 ID. 워크트리를 보는 중이면 소유 저장소의 계정을 쓴다.
 * 저장소에 지정된 계정이 없을 때만 전역 활성 계정으로 돌아간다.
 * fetch·pull·push와 커밋을 만드는 명령이 같은 계정을 쓰도록 한곳에서 정한다.
 */
export function useRepoAccountId(): string | null {
  const repoAccountId = useRepositoryStore(
    (s) => findOwnerRepo(s.repos, s.activeRepoPath, s.activeWorktrees)?.accountId ?? null,
  );
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  return repoAccountId ?? activeAccountId;
}
