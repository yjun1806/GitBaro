import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useWorkspaceStore } from "@/stores/workspace";
import { repoAccountsByPath, workspaceMembership, type RepoAccount, type Workspace } from "@/lib/repo-tree";
import type { RepoInfo } from "@/types";

export interface RepoWorkspace {
  /** 저장소가 든 계정. 모르면 undefined. */
  account: RepoAccount | undefined;
  /** 사이드바 트리와 같은 규칙으로 찾은, 저장소가 지금 실제로 든 워크스페이스. */
  current: Workspace | null;
  /** 옮길 수 있는 워크스페이스: 같은 계정의 다른 워크스페이스. 계정을 아직 모르면 비어 있다. */
  moveTargets: Workspace[];
}

/**
 * 저장소의 워크스페이스 소속. 워크스페이스는 한 계정 안에만 있어서, 같은 계정의 워크스페이스로만
 * 옮길 수 있다. 저장소 우클릭 메뉴와 저장소 설정이 같이 쓴다.
 */
export function useRepoWorkspace(repo: RepoInfo): RepoWorkspace {
  const repos = useRepositoryStore((s) => s.repos);
  const accounts = useAccountStore((s) => s.accounts);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const accountByPath = repoAccountsByPath(repos, accounts);
  const account = accountByPath.get(repo.path);
  const { membersById } = workspaceMembership(workspaces, repos, accountByPath);
  const current = workspaces.find((w) => membersById.get(w.id)?.some((r) => r.path === repo.path)) ?? null;
  const moveTargets =
    account && !account.pending
      ? workspaces.filter((w) => w.accountKey === account.key && w.id !== current?.id)
      : [];
  return { account, current, moveTargets };
}
