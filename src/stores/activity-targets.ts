import { create } from "zustand";

/**
 * 여러 화면이 활동 감시 대상 경로를 더하고 뺀다. 화면마다 고유한 `key`로
 * 자기 몫을 등록하며(예: 등록된 저장소 전체는 `useLiveChanges`가 "repos" 키로,
 * 펼친 저장소의 워크트리는 사이드바가 "sidebar" 키로), 합친 목록을
 * `useLiveChanges` 훅이 백엔드(`set_activity_watch`)에 넘긴다.
 *
 * 저장하지 않는다 — 화면을 새로 열 때마다 다시 등록된다.
 */
interface ActivityTargetsState {
  extraByKey: Record<string, string[]>;
  /** `key`가 감시하려는 경로 목록을 (덮어쓰며) 등록한다. */
  registerWatchPaths: (key: string, paths: string[]) => void;
  /** `key`의 등록을 지운다. 화면이 사라질 때 훅의 정리(cleanup)에서 부른다. */
  unregisterWatchPaths: (key: string) => void;
}

export const useActivityTargetsStore = create<ActivityTargetsState>((set) => ({
  extraByKey: {},

  registerWatchPaths: (key, paths) =>
    set((state) => ({
      extraByKey: { ...state.extraByKey, [key]: paths },
    })),

  unregisterWatchPaths: (key) =>
    set((state) => {
      if (!(key in state.extraByKey)) return state;
      const next = { ...state.extraByKey };
      delete next[key];
      return { extraByKey: next };
    }),
}));

/** 등록된 모든 화면의 경로를 중복 없이, 등록 순서를 지켜 하나로 합친다. */
export function selectActivityTargets(extraByKey: Record<string, string[]>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const paths of Object.values(extraByKey)) {
    for (const path of paths) {
      if (!seen.has(path)) {
        seen.add(path);
        merged.push(path);
      }
    }
  }
  return merged;
}
