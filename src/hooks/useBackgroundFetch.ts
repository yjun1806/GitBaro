import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRepositoryStore } from "@/stores/repository";
import { gitFetch } from "@/api/commands";

/** 백그라운드 fetch 주기 (5분). 실시간이 아니라 "가끔 최신화" 용도. */
const FETCH_INTERVAL_MS = 5 * 60 * 1000;
/** 앱 시작 직후 첫 fetch까지의 지연. 초기 로딩과 겹치지 않도록 짧게 둔다. */
const INITIAL_DELAY_MS = 8 * 1000;

/**
 * 열려 있는 모든 레포의 원격을 주기적으로 fetch해, 사이드바의 push/pull
 * 인디케이터(behind)가 실제 원격 상태를 반영하도록 한다.
 *
 * - accountId와 remote가 있는 레포만 대상으로 한다(인증·원격 없으면 스킵).
 * - 순차 실행으로 동시 네트워크 요청 폭주를 피한다.
 * - 창이 숨겨져 있으면 건너뛴다(불필요한 백그라운드 트래픽 방지).
 * - 개별 실패는 무시한다(오프라인·일시 오류 등).
 *
 * MainLayout에서 한 번만 마운트한다.
 */
export function useBackgroundFetch() {
  const queryClient = useQueryClient();
  const runningRef = useRef(false);

  useEffect(() => {
    const runFetchAll = async () => {
      if (runningRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const repos = useRepositoryStore
        .getState()
        .repos.filter((r) => r.accountId && r.remotes.length > 0);
      if (repos.length === 0) return;

      runningRef.current = true;
      try {
        for (const repo of repos) {
          try {
            await gitFetch(repo.path, repo.accountId!);
          } catch {
            // 개별 레포 fetch 실패는 무시 (네트워크·인증 일시 오류 등)
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] }),
          queryClient.invalidateQueries({ queryKey: ["branches"] }),
        ]);
      } finally {
        runningRef.current = false;
      }
    };

    const initialTimer = setTimeout(runFetchAll, INITIAL_DELAY_MS);
    const interval = setInterval(runFetchAll, FETCH_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [queryClient]);
}
