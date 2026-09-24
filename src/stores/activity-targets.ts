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

/**
 * `useLiveChanges`가 등록된 저장소 전체를 등록하는 key. 40곳 상한을 넘겼을
 * 때 등록된 저장소가 다른 화면이 더한 경로보다 우선하도록(다른 우선순위
 * 규칙은 명세에 없다) `selectActivityTargets`가 이 key를 맨 앞에 둔다.
 */
export const REPOS_KEY = "repos";

/**
 * 실시간 따라가기(W6-T1)가 따라가는 경로 하나를 등록하는 key. 따라가는 경로는 감시
 * 대상에 반드시 들어가야 하므로(명세) 등록된 저장소보다도 앞에 둔다 — 경로가 하나라
 * 40곳 상한에서 다른 경로를 한 곳 이상 밀어내지 않는다.
 */
export const FOLLOW_KEY = "follow";

/** 이 순서의 key가 먼저 오고, 나머지 key는 등록 순서 그대로 뒤따른다. */
const KEY_PRIORITY: readonly string[] = [FOLLOW_KEY, REPOS_KEY];

/**
 * 등록된 모든 화면의 경로를 중복 없이 하나로 합친다.
 *
 * `KEY_PRIORITY`에 있는 key가 먼저, 나머지는 `extraByKey`의 삽입 순서대로
 * 뒤따른다. 등록 순서(Object.values 그대로)에만 기대지 않는 이유: 화면이
 * 다시 등록될 때(effect의 cleanup 뒤 재실행 등) key가 지워졌다가 새로
 * 들어가면 일반 객체의 삽입 순서가 바뀌고, 자식 컴포넌트의 effect가 부모보다
 * 먼저 도는 React의 실행 순서 때문에 마운트 시점에도 순서가 뒤집힐 수 있다.
 * 우선순위를 등록 순서가 아니라 이 목록으로 못박아 두 문제 모두를 피한다.
 */
export function selectActivityTargets(extraByKey: Record<string, string[]>): string[] {
  const orderedKeys = [
    ...KEY_PRIORITY.filter((key) => key in extraByKey),
    ...Object.keys(extraByKey).filter((key) => !KEY_PRIORITY.includes(key)),
  ];

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const key of orderedKeys) {
    for (const path of extraByKey[key]) {
      if (!seen.has(path)) {
        seen.add(path);
        merged.push(path);
      }
    }
  }
  return merged;
}
