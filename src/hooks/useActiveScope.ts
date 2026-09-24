import { useEffect, useMemo } from "react";
import { useReviewStatusQuery } from "@/api/queries";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { Workspace } from "@/lib/repo-tree";
import type { RepoInfo, RepoReviewStatus } from "@/types";

/**
 * 메인 칸이 지금 무엇을 보고 있는지.
 * - `repo`: 저장소 하나(워크트리를 보는 중이면 `path`는 워크트리 경로다. `activeRepoPath`와 같다).
 * - `workspace`: 워크스페이스 하나. `paths`는 그 워크스페이스에 든 저장소 경로(메인 작업 트리)다.
 * - null: 아무것도 고르지 않았다.
 */
export type ActiveScope =
  | { kind: "repo"; path: string }
  | { kind: "workspace"; id: string; paths: string[] }
  | null;

/**
 * 선택 상태에서 범위를 구한다. 저장소와 워크스페이스는 스토어가 둘 중 하나만 잡도록
 * 맞추지만, 저장값이 어긋나 둘 다 남아 있으면 저장소를 따른다(기존 화면이 그대로 뜬다).
 * 워크스페이스 id가 가리키는 워크스페이스가 없으면(지워짐) 선택이 없는 것으로 본다.
 */
export function resolveActiveScope(
  activeRepoPath: string | null,
  activeWorkspaceId: string | null,
  workspaces: Workspace[],
  repos: RepoInfo[],
): ActiveScope {
  if (activeRepoPath) return { kind: "repo", path: activeRepoPath };
  if (!activeWorkspaceId) return null;
  const ws = workspaces.find((w) => w.id === activeWorkspaceId);
  if (!ws) return null;
  // 저장소 목록에서 지운 저장소는 `forgetRepos`가 빼지만, 복원 순서 탓에 잠깐 남을 수 있다.
  const registered = new Set(repos.map((r) => r.path));
  return { kind: "workspace", id: ws.id, paths: ws.repoPaths.filter((p) => registered.has(p)) };
}

/** 지금 범위. 저장소 전용 화면은 `kind === "repo"`일 때만 마운트한다(`MainColumn`). */
export function useActiveScope(): ActiveScope {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const repos = useRepositoryStore((s) => s.repos);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  return useMemo(
    () => resolveActiveScope(activeRepoPath, activeWorkspaceId, workspaces, repos),
    [activeRepoPath, activeWorkspaceId, workspaces, repos],
  );
}

/**
 * 워크스페이스를 골랐을 때 활성으로 바꿀 계정 id. 저장소를 고를 때(`useSelectRepo`)처럼
 * 저장소에 지정된 계정(`accountId`)을 쓴다.
 * 1. 워크스페이스의 계정 키와 username이 같은 로그인 계정이 있고, 그 계정이 지정된 저장소가 있으면 그 계정
 * 2. 아니면 워크스페이스 순서대로 처음 나오는, 계정이 지정된 저장소의 계정
 * 3. 지정된 계정이 하나도 없으면 null(활성 계정을 바꾸지 않는다)
 */
export function workspaceAccountId(
  workspace: Workspace,
  repos: RepoInfo[],
  accounts: { id: string; username: string }[],
): string | null {
  const byPath = new Map(repos.map((r) => [r.path, r]));
  const known = new Set(accounts.map((a) => a.id));
  const assigned = workspace.repoPaths
    .map((p) => byPath.get(p)?.accountId ?? null)
    .filter((id): id is string => id !== null && known.has(id));
  const named = accounts.find((a) => a.username.toLowerCase() === workspace.accountKey);
  if (named && assigned.includes(named.id)) return named.id;
  return assigned[0] ?? null;
}

/** 워크스페이스 모드의 활동 감시 등록 키(`registerWatchPaths`). */
export const WORKSPACE_WATCH_KEY = "workspace";

/**
 * 워크스페이스의 저장소와 그 워크트리 경로. 워크트리 목록은 리뷰 스캔(`review_status`) 결과에서
 * 가져온다. 스캔에 아직 없는 저장소는 저장소 경로만 넣는다.
 */
export function workspaceWatchPaths(repoPaths: string[], scan: RepoReviewStatus[]): string[] {
  const byRepo = new Map(scan.map((r) => [r.repoPath, r]));
  const out = new Set<string>();
  for (const repoPath of repoPaths) {
    out.add(repoPath);
    for (const wt of byRepo.get(repoPath)?.worktrees ?? []) out.add(wt.path);
  }
  return [...out];
}

const NO_PATHS: string[] = [];

/**
 * 워크스페이스를 고른 동안 그 저장소와 워크트리를 활동 감시 대상에 더한다. 워크스페이스
 * 화면의 갱신 신호는 `repo:activity`다. 기존 활성 저장소 감시(`useRepoWatcher`)는 경로가
 * null이면 띄우지 않으므로 그대로 둔다. `App`에서 한 번 마운트한다.
 *
 * 리뷰 스캔은 사이드바와 같은 키(등록된 저장소 전체)로 불러 캐시를 함께 쓴다.
 */
export function useWorkspaceWatchPaths(scope: ActiveScope): void {
  const repos = useRepositoryStore((s) => s.repos);
  const allRepoPaths = useMemo(() => repos.map((r) => r.path), [repos]);
  const isWorkspace = scope?.kind === "workspace";
  const { data: scan } = useReviewStatusQuery(isWorkspace ? allRepoPaths : NO_PATHS);
  const members = isWorkspace ? scope.paths : NO_PATHS;
  const paths = useMemo(
    () => (isWorkspace ? workspaceWatchPaths(members, scan ?? []) : NO_PATHS),
    [isWorkspace, members, scan],
  );
  const pathsKey = paths.join("\u0000");

  const registerWatchPaths = useActivityTargetsStore((s) => s.registerWatchPaths);
  const unregisterWatchPaths = useActivityTargetsStore((s) => s.unregisterWatchPaths);
  useEffect(() => {
    if (paths.length === 0) {
      unregisterWatchPaths(WORKSPACE_WATCH_KEY);
      return;
    }
    registerWatchPaths(WORKSPACE_WATCH_KEY, paths);
    // pathsKey가 내용을 대신 비교한다(스캔이 20초마다 새 배열을 만들어도 같으면 다시 등록하지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, registerWatchPaths, unregisterWatchPaths]);
  useEffect(() => () => unregisterWatchPaths(WORKSPACE_WATCH_KEY), [unregisterWatchPaths]);
}
