import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRepositoryStore } from "@/stores/repository";
import { gitFetch } from "@/api/commands";

/** 주기적 백그라운드 fetch 간격 (3분). 실시간이 아니라 "가끔 최신화" 용도. */
const FETCH_INTERVAL_MS = 3 * 60 * 1000;
/** 앱 시작 직후 첫 fetch까지의 지연. 초기 로딩과 겹치지 않도록 짧게 둔다. */
const INITIAL_DELAY_MS = 8 * 1000;
/** 창 포커스 fetch의 최소 간격. 앱을 자주 오갈 때 과도한 fetch를 막는다. */
const FOCUS_THROTTLE_MS = 60 * 1000;

/**
 * 열려 있는 모든 레포의 원격을 fetch해, 사이드바의 push/pull 인디케이터(behind)가
 * 실제 원격 상태를 반영하도록 한다. 트리거는 세 가지:
 *  - 시작 직후 1회, 이후 3분 주기
 *  - 창이 다시 포커스될 때 (최소 60초 간격으로 throttle)
 *
 * 규칙:
 *  - accountId·remote가 있는 레포만 대상 (인증·원격 없으면 스킵)
 *  - 순차 실행으로 동시 네트워크 요청 폭주를 피한다
 *  - 창이 숨겨져 있으면 건너뛴다
 *  - 개별 실패는 무시한다 (오프라인·일시 오류 등)
 *
 * MainLayout에서 한 번만 마운트한다.
 */
export function useBackgroundFetch() {
  const queryClient = useQueryClient();
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  useEffect(() => {
    let mounted = true;

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
      lastRunRef.current = Date.now();
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

    // 창이 다시 포커스될 때 fetch (React Query 포커스 재조회는 오프라인 재계산만
    // 하므로, behind 갱신을 위해 실제 fetch를 별도로 트리거한다). 최소 간격 throttle.
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused && Date.now() - lastRunRef.current >= FOCUS_THROTTLE_MS) {
          runFetchAll();
        }
      })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      })
      .catch(() => {});

    return () => {
      mounted = false;
      clearTimeout(initialTimer);
      clearInterval(interval);
      unlisten?.();
    };
  }, [queryClient]);
}
