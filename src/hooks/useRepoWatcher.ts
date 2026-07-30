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

/**
 * Watches the active repository's working tree via the backend FS watcher and
 * invalidates the status query when files change. Replaces tight status polling
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
    let unlisten: (() => void) | undefined;

    listen<FsChangePayload>("fs:change", (event) => {
      if (!mounted) return;
      queryClient.invalidateQueries({
        queryKey: ["status", event.payload.repoPath],
      });
      // rail/목록의 dirty·ahead/behind 인디케이터도 함께 갱신 (오프라인 계산)
      queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] });
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [queryClient]);
}
