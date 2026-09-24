import { useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { setActivityWatch } from "@/api/commands";
import { useRepoSyncStatuses } from "@/api/queries";
import { useActivityTargetsStore, selectActivityTargets } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useRepositoryStore } from "@/stores/repository";
import type { ActivityEvent } from "@/types";

/** `registerWatchPaths` key this hook uses for the default target set. */
const REPOS_KEY = "repos";

/**
 * 여러 저장소·워크트리의 활동 시각을 모은다(W1-T3). `MainLayout`에서 한 번
 * 마운트한다.
 *
 * - 등록된 저장소 전체를 기본 감시 대상으로 등록하고, 다른 화면이
 *   `registerWatchPaths`로 더한 경로와 합쳐 백엔드에 넘긴다.
 * - `repo:activity` 이벤트로 `live-changes` 스토어를 채운다.
 * - 상한(40곳)을 넘겨 감시되지 않는 경로는 기존 20초 폴링
 *   (`repo_sync_status`의 `dirtyLatestMtime`)으로 대신 채운다.
 */
export function useLiveChanges(): void {
  const repos = useRepositoryStore((s) => s.repos);
  const repoPaths = useMemo(() => repos.map((r) => r.path), [repos]);

  const registerWatchPaths = useActivityTargetsStore((s) => s.registerWatchPaths);
  const unregisterWatchPaths = useActivityTargetsStore((s) => s.unregisterWatchPaths);
  const extraByKey = useActivityTargetsStore((s) => s.extraByKey);

  const setWatchState = useLiveChangesStore((s) => s.setWatchState);
  const recordChange = useLiveChangesStore((s) => s.recordChange);
  const overflow = useLiveChangesStore((s) => s.overflow);

  // 기본 감시 대상: 등록된 저장소 전체.
  useEffect(() => {
    registerWatchPaths(REPOS_KEY, repoPaths);
    return () => unregisterWatchPaths(REPOS_KEY);
  }, [repoPaths, registerWatchPaths, unregisterWatchPaths]);

  const targets = useMemo(() => selectActivityTargets(extraByKey), [extraByKey]);
  const targetsKey = useMemo(() => [...targets].sort().join("\u0000"), [targets]);

  useEffect(() => {
    let cancelled = false;
    setActivityWatch(targets)
      .then((result) => {
        if (!cancelled) setWatchState(result.watched, result.overflow);
      })
      .catch(() => {
        /* best-effort — 감시가 안 붙어도 20초 폴링이 대신한다 */
      });
    return () => {
      cancelled = true;
    };
    // targetsKey 가 내용을, targets 참조 변화를 대신 판단한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, setWatchState]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    listen<ActivityEvent>("repo:activity", (event) => {
      if (!mounted) return;
      recordChange(event.payload.path, event.payload.at);
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
  }, [recordChange]);

  // 상한을 넘겨 빠진 경로: 기존 20초 폴링의 dirtyLatestMtime 으로 대신 채운다
  // (W1-T2가 repo_sync_status 에 그 필드를 추가한다. 아직 없으면 조용히 건너뛴다).
  const { data: syncStatusByPath } = useRepoSyncStatuses(overflow);
  useEffect(() => {
    if (!syncStatusByPath) return;
    for (const path of overflow) {
      const status = syncStatusByPath[path] as
        | { dirtyLatestMtime?: number | null }
        | undefined;
      const mtime = status?.dirtyLatestMtime;
      if (typeof mtime === "number") {
        recordChange(path, mtime);
      }
    }
  }, [syncStatusByPath, overflow, recordChange]);
}
