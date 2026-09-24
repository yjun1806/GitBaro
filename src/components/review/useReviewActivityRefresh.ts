import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import type { ActivityEvent } from "@/types";
import { activityInvalidationKeys, activityTargetOf, type ReviewRepoPaths } from "./review-model";

/**
 * 워크스페이스 리뷰 화면의 갱신 신호. `repo:activity`를 받으면 그 경로의 워크트리의
 * 커밋하지 않은 변경·상태 쿼리만 무효화한다(`activityInvalidationKeys`). 다른 저장소와
 * 같은 저장소의 다른 워크트리는 다시 읽지 않는다. 감시 대상 등록은 `useWorkspaceWatchPaths`(App)가 맡는다.
 */
export function useReviewActivityRefresh(repos: readonly ReviewRepoPaths[]): void {
  const queryClient = useQueryClient();
  const reposRef = useRef(repos);
  useEffect(() => {
    reposRef.current = repos;
  });

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    listen<ActivityEvent>("repo:activity", (event) => {
      if (!mounted) return;
      const target = activityTargetOf(event.payload.path, reposRef.current);
      if (!target) return;
      for (const queryKey of activityInvalidationKeys(target.root)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* 이벤트를 못 받아도 쿼리의 주기적 갱신이 대신한다 */
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [queryClient]);
}
