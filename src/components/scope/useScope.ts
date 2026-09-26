import { findOwnerRepo, useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useHistoryViewStore, viewTargetFor } from "@/stores/history-view";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { useScopeStore } from "./scope-store";
import { resolveScope, type Scope } from "./scope";

/**
 * 지금 앱 상태의 범위(워크스페이스 · 저장소 · 브랜치). 사이드바·툴바 경로 등 범위 자체만
 * 있으면 되는 화면에 쓴다. 레인 목록까지 필요하면 `useScopeSources`.
 */
export function useScope(): Scope | null {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const repos = useRepositoryStore((s) => s.repos);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const activeWorktrees = useRepositoryStore((s) => s.activeWorktrees);
  const ownerRepoPath = findOwnerRepo(repos, activeRepoPath, activeWorktrees)?.path ?? null;
  const currentBranch = useCurrentBranch();
  const aggregateRepoPath = useScopeStore((s) => s.aggregateRepoPath);
  const historyViewRepoPath = useHistoryViewStore((s) => s.repoPath);
  const historyViewTarget = useHistoryViewStore((s) => s.target);
  const viewed = viewTargetFor({ repoPath: historyViewRepoPath, target: historyViewTarget }, activeRepoPath);
  const viewedBranch = viewed?.kind === "ref" && !viewed.isRemote ? viewed.name : null;

  return resolveScope({
    activeWorkspaceId,
    ownerRepoPath,
    activeWorktreePath: activeRepoPath,
    currentBranch,
    aggregateRepoPath,
    viewedBranch,
  });
}
