import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n from "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useSyncStore } from "@/stores/sync";
import { useAutoSyncStore } from "@/stores/auto-sync";
import { useToastStore } from "@/stores/toast";
import { autoFastForward, getAutoSyncSnapshot, gitFetch } from "@/api/commands";
import { invalidateAfterSync } from "@/api/queries";
import { decideAutoSync, pickDueRepos, resolveAutoSync } from "@/lib/auto-sync";
import { getErrorMessage } from "@/lib/utils";
import type { AutoSyncSetting, RepoInfo } from "@/types";

/** 차례가 된 저장소가 있는지 확인하는 간격. 실제 실행 주기는 저장소별 설정을 따른다. */
const TICK_MS = 30 * 1000;
/** 앱 시작 직후 첫 확인까지의 지연. 초기 로딩과 겹치지 않도록 짧게 둔다. */
const INITIAL_DELAY_MS = 8 * 1000;
/** 창 포커스로 확인하는 최소 간격. 앱을 자주 오갈 때 확인이 몰리지 않게 한다. */
const FOCUS_THROTTLE_MS = 60 * 1000;

/** 마지막 실행 시각(ms): 자동 최신화 결과와 직접 누른 fetch 중 늦은 쪽. */
function lastRunTimes(): Record<string, number> {
  const results = useAutoSyncStore.getState().lastResultByRepo;
  const manual = useSyncStore.getState().lastFetchedByRepo;
  const paths = new Set([...Object.keys(results), ...Object.keys(manual)]);
  return Object.fromEntries(
    [...paths].map((path) => [
      path,
      Math.max(results[path]?.at ?? 0, (manual[path] ?? 0) * 1000),
    ]),
  );
}

/**
 * 저장소 하나를 자동 최신화한다. 실패는 알리지 않고 결과에만 남긴다.
 *
 * 자동으로 받기는 저장소에 등록된 경로(메인 작업 트리)에만 적용한다. 연결된
 * 워크트리는 이번 범위에서 자동으로 받지 않는다. 원격 추적 브랜치는 워크트리끼리
 * 공유하므로 fetch 결과(앞섬·뒤처짐)는 워크트리에도 그대로 보인다.
 */
async function autoSyncRepo(repo: RepoInfo, setting: AutoSyncSetting): Promise<number> {
  const mode = setting.mode === "pull" ? "pull" : "fetch";
  const record = useAutoSyncStore.getState().recordResult;
  try {
    await gitFetch(repo.path, repo.accountId!, true);
    useSyncStore.getState().markFetched(repo.path, Math.floor(Date.now() / 1000));

    let fastForwarded = 0;
    if (mode === "pull") {
      const snapshot = await getAutoSyncSnapshot(repo.path);
      const decision = decideAutoSync({
        ...snapshot,
        mode,
        lastActivityAt: useAutoSyncStore.getState().lastActivityByPath[repo.path] ?? null,
        now: Date.now(),
      });
      // 확인하는 사이에 사용자가 직접 동기화를 시작했다면 건드리지 않는다.
      const manualSyncStarted = useSyncStore.getState().syncingByRepo[repo.path] !== undefined;
      if (decision === "fetch+ff" && !manualSyncStarted) {
        fastForwarded = (await autoFastForward(repo.path)).commits;
      }
    }
    record(repo.path, { at: Date.now(), ok: true, mode, fastForwarded });
    return fastForwarded;
  } catch (err) {
    record(repo.path, {
      at: Date.now(),
      ok: false,
      mode,
      fastForwarded: 0,
      error: getErrorMessage(err),
    });
    return 0;
  }
}

/**
 * 저장소별 원격 자동 최신화 스케줄러. 저장소마다 자기 주기(1·3·5·10·30분)로
 * 차례가 오고, 차례가 된 저장소는 하나씩 순서대로 실행해 요청이 몰리지 않게 한다.
 *
 *  - 창이 숨겨져 있으면 건너뛴다
 *  - 창이 다시 포커스되면 차례가 됐거나 지난 저장소를 바로 실행한다(60초 throttle)
 *  - 계정·원격이 없는 저장소, 직접 동기화 중인 저장소는 건너뛴다
 *  - 실패는 알리지 않고 저장소별 마지막 결과에만 남긴다
 *  - 자동으로 커밋을 받았을 때만 짧은 알림을 띄운다
 *
 * MainLayout에서 한 번만 마운트한다.
 */
export function useAutoSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;
    let running = false;
    let lastFocusRunAt = 0;

    const runDue = async () => {
      if (running) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      const { repos, autoSyncByRepo } = useRepositoryStore.getState();
      const { syncingByRepo } = useSyncStore.getState();
      const idle = repos.filter((r) => syncingByRepo[r.path] === undefined);
      const due = pickDueRepos(idle, autoSyncByRepo, lastRunTimes(), Date.now());
      if (due.length === 0) return;

      running = true;
      try {
        for (const repo of due) {
          if (!mounted) return;
          // 앞 저장소를 도는 사이 설정이 바뀌었을 수 있어 실행 직전에 다시 읽는다.
          const setting = resolveAutoSync(
            useRepositoryStore.getState().autoSyncByRepo,
            repo.path,
          );
          if (setting.mode === "off") continue;
          const commits = await autoSyncRepo(repo, setting);
          if (commits > 0 && mounted) {
            useToastStore
              .getState()
              .addToast(
                i18n.t("autoSync.fastForwardedToast", { repo: repo.name, count: commits }),
                "info",
              );
          }
        }
        if (mounted) await invalidateAfterSync(queryClient);
      } finally {
        running = false;
      }
    };

    const initialTimer = setTimeout(runDue, INITIAL_DELAY_MS);
    const interval = setInterval(runDue, TICK_MS);

    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        const now = Date.now();
        if (focused && now - lastFocusRunAt >= FOCUS_THROTTLE_MS) {
          lastFocusRunAt = now;
          runDue();
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
