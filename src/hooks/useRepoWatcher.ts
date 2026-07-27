import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { startRepoWatch, stopRepoWatch } from "@/api/commands";

interface FsChangePayload {
  repoPath: string;
}

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
    startRepoWatch(repoPath).catch(() => {});

    return () => {
      stopRepoWatch().catch(() => {
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
      // V13은 "본 뒤에 바뀌면 자동으로 미검토로 되돌린다"가 핵심이므로 워킹트리
      // 스캔·검토 상태·테스트 증거 신선도를 파일 변경과 함께 무효화한다.
      queryClient.invalidateQueries({ queryKey: ["verifyWorkingTree"] });
      queryClient.invalidateQueries({ queryKey: ["fileReviewStates"] });
      queryClient.invalidateQueries({ queryKey: ["testEvidence"] });
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
