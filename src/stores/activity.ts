import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import type { GitCommandEntry } from "@/types";

const MAX_STDOUT_PERSIST = 500;

/**
 * 보관하는 최대 엔트리 수.
 *
 * 이전에는 개수 상한 없이 90일 만료만 있었고, 3분 주기 백그라운드 fetch가 저장소 수만큼
 * 기록을 남겨 8,586건 / 5MB까지 늘어났다(localStorage 쿼터를 소진해 다른 스토어의 저장이
 * 전부 실패했다). 성공한 자동 작업을 제외한 실측 유입량은 하루 두어 건이므로, 1,000건은
 * 1년 반치에 해당한다 — 정상 사용에서는 걸리지 않는 안전핀이다.
 */
export const MAX_ENTRIES = 1000;

function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** entries는 최신순이므로 앞에서부터 남긴다. */
function capEntries(entries: GitCommandEntry[]): GitCommandEntry[] {
  return entries.length > MAX_ENTRIES ? entries.slice(0, MAX_ENTRIES) : entries;
}

/**
 * hydrate 직후 상태 보정.
 *
 * 상한은 메모리 액션(addStart·addComplete)에서만 적용되는데, 자동 작업은 그 양쪽 경로를
 * 모두 우회한다. 저장된 값은 hydrate 때 그대로 올라오므로, 여기서 자르지 않으면 자동
 * fetch만 도는 사용자에게는 상한이 영영 작동하지 않는다.
 *
 * zustand의 `onRehydrateStorage`는 상태를 직접 변경하는 계약이다(repository.ts와 동일).
 */
export function reconcileRehydrated(
  state: { entries: GitCommandEntry[] } | undefined,
): void {
  if (!state) return;
  state.entries = capEntries(state.entries);
}

interface ActivityState {
  entries: GitCommandEntry[];
  activeOperations: Record<string, GitCommandEntry>;
  addStart: (entry: GitCommandEntry) => void;
  addComplete: (id: string, result: Partial<GitCommandEntry>) => void;
  updateProgress: (
    id: string,
    message: string,
    percent?: number,
  ) => void;
  clearLog: () => void;
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set) => ({
      entries: [],
      activeOperations: {},

      // 자동 작업은 진행 표시(activeOperations)에만 올린다. 로그에 남길지는
      // 완료 시점에 성공 여부를 보고 정한다.
      addStart: (entry) =>
        set((state) => ({
          entries: entry.automatic
            ? state.entries
            : capEntries([entry, ...state.entries]),
          activeOperations: { ...state.activeOperations, [entry.id]: entry },
        })),

      addComplete: (id, result) =>
        set((state) => {
          const { [id]: startedEntry, ...remainingOps } = state.activeOperations;

          const isLogged = state.entries.some((e) => e.id === id);
          if (isLogged) {
            return {
              entries: state.entries.map((e) =>
                e.id === id ? { ...e, ...result } : e,
              ),
              activeOperations: remainingOps,
            };
          }

          // 로그에 없는 건 자동 작업이다. 실패했을 때만 뒤늦게 남긴다.
          const shouldLogFailure = startedEntry && result.success === false;
          return {
            entries: shouldLogFailure
              ? capEntries([{ ...startedEntry, ...result }, ...state.entries])
              : state.entries,
            activeOperations: remainingOps,
          };
        }),

      updateProgress: (id, message, percent) =>
        set((state) => {
          const op = state.activeOperations[id];
          if (!op) return state;
          const updated = { ...op, progress: { message, percent } };
          return {
            entries: state.entries.map((e) => (e.id === id ? updated : e)),
            activeOperations: { ...state.activeOperations, [id]: updated },
          };
        }),

      clearLog: () =>
        set((state) => ({
          entries: state.entries.filter((e) => state.activeOperations[e.id]),
        })),
    }),
    {
      name: "gitbaro-activity-log",
      storage: createJSONStorage(() => createSafeStorage()),
      // 개수 상한은 메모리 상태에서 이미 적용된다(capEntries). 여기서는 진행 중
      // 항목을 빼고 출력만 잘라 저장한다.
      partialize: (state) => ({
        entries: state.entries
          .filter((e) => e.completedAt != null)
          .map((e) => ({
            ...e,
            stdout: truncate(e.stdout, MAX_STDOUT_PERSIST),
            stderr: truncate(e.stderr, MAX_STDOUT_PERSIST),
          })),
      }),
      // 함수 참조를 그대로 넘기면 persist의 상태 타입 추론이 이 함수의 파라미터
      // 타입으로 좁혀진다. 람다로 감싸 추론을 유지한다.
      onRehydrateStorage: () => (state) => reconcileRehydrated(state),
    },
  ),
);
