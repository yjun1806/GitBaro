import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWorktrees } from "@/api/commands";
import type { WorktreeBase } from "@/types";

/** 기반 브랜치는 브랜치를 새로 갈라야 바뀌므로 오래 둔다. */
const BASES_STALE_MS = 5 * 60_000;

/**
 * 펼친 저장소의 워크트리가 「어디서 갈라졌는지」를 읽는다.
 *
 * `get_worktrees`는 워크트리마다 상태 검사까지 하는 무거운 호출이다. 툴바가 쓰는
 * `["worktrees", path]` 키에 붙으면 git 폴더가 바뀔 때마다(`useRepoWatcher`가 그 키를 무효화)
 * 펼친 저장소 수만큼 다시 불린다. 그래서 사이드바는 별도 키를 쓰고, 5분 동안 새로 읽지 않으며
 * 창 포커스로도 다시 읽지 않는다. 워크트리 목록(`worktreePaths`)이 바뀌면 키가 바뀌어 새로 읽는다.
 */
export function useWorktreeBases(
  repoPath: string | null,
  worktreePaths: readonly string[],
): Record<string, WorktreeBase> {
  const pathsKey = worktreePaths.join("\u0000");
  const { data } = useQuery({
    queryKey: ["sidebarWorktreeBases", repoPath, pathsKey],
    queryFn: () => getWorktrees(repoPath!),
    enabled: repoPath !== null && worktreePaths.length > 0,
    staleTime: BASES_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return useMemo(() => {
    const out: Record<string, WorktreeBase> = {};
    for (const wt of data ?? []) if (wt.base) out[wt.path] = wt.base;
    return out;
  }, [data]);
}
