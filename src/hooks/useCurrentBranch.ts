import { useRepositoryStore } from "@/stores/repository";
import { useBranches } from "@/api/queries";

/**
 * 활성 저장소(worktree 포함)의 현재 체크아웃된 브랜치명을 반환한다.
 * `useBranches`(activeRepoPath 기준 React Query)의 HEAD 브랜치를 소스로 삼아,
 * worktree 경로에서도 올바른 브랜치를 가리킨다. 없으면 null.
 */
export function useCurrentBranch(): string | null {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  return branches.find((b) => b.isHead)?.name ?? null;
}
