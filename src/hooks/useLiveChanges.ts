import { useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { setActivityWatch } from "@/api/commands";
import { useRepoSyncStatuses } from "@/api/queries";
import { REPOS_KEY, useActivityTargetsStore, selectActivityTargets } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useRepositoryStore } from "@/stores/repository";
import type { ActivityEvent } from "@/types";

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
  //
  // 등록과 해제를 별도 effect로 나눈다. 저장소 목록이 바뀔 때마다 이 key를
  // 지웠다가 다시 등록하면(단일 effect의 cleanup+재실행 패턴), 합친 목록에서
  // "repos" key가 맨 뒤로 밀린다 — extraByKey는 일반 객체라 키를 지웠다가
  // 다시 넣으면 삽입 순서가 바뀌기 때문이다. 그러면 40곳 상한에서 다른
  // 화면이 나중에 등록한 경로가 저장소보다 우선순위를 가져가 버린다. 갱신은
  // (덮어쓰기만 하는) upsert로 처리하고, 해제는 마운트 해제 때만 한다.
  useEffect(() => {
    registerWatchPaths(REPOS_KEY, repoPaths);
  }, [repoPaths, registerWatchPaths]);

  useEffect(() => {
    return () => unregisterWatchPaths(REPOS_KEY);
  }, [unregisterWatchPaths]);

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
  // (W1-T2가 repo_sync_status 에 그 필드를 추가했다 — RepoSyncStatus의 필수 필드).
  //
  // `RepoRail`도 `useRepoSyncStatuses`를 20초 폴링으로 부르므로, overflow가
  // 그 전체 목록의 부분집합이면 같은 queryKey로 걸어 계산을 한 번만 하게
  // 만들 수도 있다. 다만 `RepoRail`은 활성 저장소를 `repoViewPath`로
  // 지금 보는 워크트리 경로로 치환해서 조회하는데, `overflow`는 백엔드에
  // 등록한 원본 저장소 경로(`repo.path`) 그대로다. 활성 저장소가 워크트리를
  // 보는 중이면서 동시에 overflow에 들어간 경우 두 키가 달라, 그 목록으로
  // 합치면 그 한 저장소만 조용히 값을 못 찾는 회귀가 생긴다. 그래서
  // `overflow` 그대로 별도 쿼리를 쓴다 — 중복 폴링 비용은 남지만 안전하다.
  const { data: syncStatusByPath } = useRepoSyncStatuses(overflow);
  useEffect(() => {
    if (!syncStatusByPath) return;
    for (const path of overflow) {
      const mtime = syncStatusByPath[path]?.dirtyLatestMtime;
      if (typeof mtime === "number") {
        recordChange(path, mtime);
      }
    }
  }, [syncStatusByPath, overflow, recordChange]);
}
