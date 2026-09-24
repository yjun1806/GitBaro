import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { startRepoWatch, stopRepoWatch } from "@/api/commands";

interface FsChangePayload {
  repoPath: string;
}

/**
 * 감시 세대 번호. 저장소를 전환하면 이전 세대의 정리(stop)와 새 세대의 시작(start)이
 * await 없이 함께 나가는데, 두 IPC 의 도착 순서는 보장되지 않는다. 경로로 짝을 맞추면
 * 같은 저장소를 오갈 때(A → B → A) 오래된 stop 이 새 감시자를 죽인다.
 */
let watchGeneration = 0;

const GIT_DIR_DEBOUNCE_MS = 250;

/**
 * Per-repo queries that depend on HEAD, the index, refs, merge/rebase state or
 * linked worktrees. recentBranches reads the reflog, which git writes together
 * with HEAD, so a HEAD change covers it.
 */
const GIT_DIR_QUERY_KEYS = [
  "status",
  "branches",
  "branchDivergence",
  "commitHistory",
  "mergeState",
  "stashList",
  "recentBranches",
  "worktrees",
] as const;

/**
 * Watches the active repository via the backend FS watcher. Working-tree
 * changes invalidate the status query; git-dir changes (commit, checkout,
 * stage, merge/rebase, worktree add/remove made anywhere) also refresh
 * branches, recent branches, history, merge state, stashes and worktrees. Replaces tight status polling
 * with event-driven refresh; the query keeps a slow poll as a safety net.
 */
export function useRepoWatcher(repoPath: string | null) {
  const queryClient = useQueryClient();

  // Start/stop the backend watcher as the active repo changes.
  useEffect(() => {
    if (!repoPath) return;

    // Best-effort: if the watcher fails to start, the status query's slow poll
    // still keeps the working tree in sync.
    const token = ++watchGeneration;
    startRepoWatch(repoPath, token).catch(() => {});

    return () => {
      stopRepoWatch(token).catch(() => {
        /* best-effort teardown */
      });
    };
  }, [repoPath]);

  // Listen for debounced FS change events and refresh the affected repo's status.
  useEffect(() => {
    let mounted = true;
    const unlisteners: (() => void)[] = [];
    // A commit or rebase touches the git dir many times; refetch history and
    // branches once the burst settles instead of on every step.
    let gitDirTimer: ReturnType<typeof setTimeout> | undefined;

    const track = (promise: Promise<() => void>) => {
      promise.then((fn) => {
        if (mounted) {
          unlisteners.push(fn);
        } else {
          fn();
        }
      });
    };

    track(
      listen<FsChangePayload>("fs:change", (event) => {
        if (!mounted) return;
        queryClient.invalidateQueries({
          queryKey: ["status", event.payload.repoPath],
        });
        // rail/목록의 dirty·ahead/behind 인디케이터도 함께 갱신 (오프라인 계산)
        queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] });
      }),
    );

    // HEAD, index, refs, or merge/rebase state changed — e.g. a commit, `git add`
    // or checkout made in a terminal.
    track(
      listen<FsChangePayload>("fs:git-dir-change", (event) => {
        if (!mounted) return;
        const { repoPath: changedPath } = event.payload;
        clearTimeout(gitDirTimer);
        gitDirTimer = setTimeout(() => {
          for (const key of GIT_DIR_QUERY_KEYS) {
            queryClient.invalidateQueries({ queryKey: [key, changedPath] });
          }
          queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] });
        }, GIT_DIR_DEBOUNCE_MS);
      }),
    );

    return () => {
      mounted = false;
      clearTimeout(gitDirTimer);
      unlisteners.forEach((fn) => fn());
    };
  }, [queryClient]);
}
