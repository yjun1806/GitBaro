import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { reviewStatus } from "@/api/commands";
import { REVIEW_POLL_MS } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";

/**
 * 등록된 저장소 전체의 워크트리 목록과 각 워크트리의 브랜치·HEAD. 알림이 쓴다.
 * 다른 화면의 `useReviewStatusQuery`와 같은 키라 결과를 함께 쓰고, 이 관찰자만 창이 뒤에 있어도
 * 20초마다 읽는다 — 알림은 그때 쓸모 있다.
 */
export function useBackgroundReviewStatus(enabled: boolean) {
  const repos = useRepositoryStore((s) => s.repos);
  const repoPaths = useMemo(() => repos.map((r) => r.path), [repos]);
  return useQuery({
    queryKey: ["reviewStatus", repoPaths],
    queryFn: () => reviewStatus(repoPaths),
    enabled: enabled && repoPaths.length > 0,
    refetchInterval: REVIEW_POLL_MS,
    refetchIntervalInBackground: true,
  });
}
