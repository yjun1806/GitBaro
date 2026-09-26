import { useQueryClient } from "@tanstack/react-query";
import { TAURI_EVENTS } from "@/api/events";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { activityInvalidationKeys, activityTargetOf, type ReviewRepoPaths } from "./review-model";

/**
 * 워크스페이스 리뷰 화면의 갱신 신호. `repo:activity`를 받으면 그 경로의 워크트리의
 * 커밋하지 않은 변경·상태 쿼리만 무효화한다(`activityInvalidationKeys`). 커밋·브랜치 이동
 * (`kind: "git"`)이면 HEAD·원격 상태와 커밋 목록도 다시 읽는다. 다른 저장소와
 * 같은 저장소의 다른 워크트리는 다시 읽지 않는다. 감시 대상 등록은 `useWorkspaceWatchPaths`(App)가 맡는다.
 */
export function useReviewActivityRefresh(repos: readonly ReviewRepoPaths[]): void {
  const queryClient = useQueryClient();
  useTauriEvent(TAURI_EVENTS.repoActivity, (activity) => {
    const target = activityTargetOf(activity.path, repos);
    if (!target) return;
    for (const queryKey of activityInvalidationKeys(target.root)) {
      void queryClient.invalidateQueries({ queryKey });
    }
    if (activity.kind === "git") {
      for (const key of ["reviewStatus", "repoSyncStatus", "commitHistory"]) void queryClient.invalidateQueries({ queryKey: [key] });
      void queryClient.invalidateQueries({ queryKey: ["unpushedFileTouches", target.root] });
    }
  });
}
