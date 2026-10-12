import { create } from "zustand";
import type { GitCommandEntry } from "@/types";

/**
 * 지금 실행 중인 git 명령과 그 진행률.
 *
 * 영속 스토어(activity.ts)와 분리해 둔 이유: zustand persist는 `set`이 불릴 때마다
 * 상태 전체를 직렬화해 저장한다. 진행률은 줄 단위로 수백 번 갱신되므로 같은 스토어에 두면
 * push/fetch 한 번이 1~2MB 쓰기 수백 번이 된다. 이 스토어는 저장하지 않는다.
 */
interface LiveOperationsState {
  activeOperations: Record<string, GitCommandEntry>;
  start: (entry: GitCommandEntry) => void;
  finish: (id: string) => void;
  updateProgress: (id: string, message: string, percent?: number) => void;
}

export const useLiveOperationsStore = create<LiveOperationsState>()((set) => ({
  activeOperations: {},

  start: (entry) =>
    set((state) => ({
      activeOperations: { ...state.activeOperations, [entry.id]: entry },
    })),

  finish: (id) =>
    set((state) => {
      const { [id]: _finished, ...rest } = state.activeOperations;
      return { activeOperations: rest };
    }),

  updateProgress: (id, message, percent) =>
    set((state) => {
      const op = state.activeOperations[id];
      if (!op) return state;
      return {
        activeOperations: {
          ...state.activeOperations,
          [id]: { ...op, progress: { message, percent } },
        },
      };
    }),
}));
