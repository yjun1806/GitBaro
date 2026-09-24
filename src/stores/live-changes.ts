import { create } from "zustand";

/** 이 시간이 지난 변경은 "지금 바뀌는 곳" 같은 화면에서 뺀다. */
export const LIVE_CHANGE_STALE_MS = 10 * 60 * 1000;

/**
 * 여러 저장소·워크트리의 최근 변경 시각을 모은다. `useLiveChanges` 훅이
 * `repo:activity` 이벤트와, 감시 상한(40곳)을 넘긴 경로의 20초 폴링 결과
 * (`dirtyLatestMtime`)로 채운다.
 *
 * 저장하지 않는다 — 세션마다 다시 관찰한 값만 쓴다.
 */
interface LiveChangesState {
  /** 경로별 마지막 변경 시각(epoch ms). */
  lastChangedAt: Record<string, number>;
  /** 백엔드가 실제로 감시 중인 경로(최대 40곳) — `repo:activity`가 오는 대상. */
  watched: string[];
  /** 상한을 넘겨 감시되지 않는 경로 — 20초 폴링으로 대신 채운다. */
  overflow: string[];
  setWatchState: (watched: string[], overflow: string[]) => void;
  /** 경로의 변경 시각을 기록한다. 더 이전 시각이 늦게 도착하면 무시한다. */
  recordChange: (path: string, at: number) => void;
  /** `now` 기준 10분 안에 바뀐 경로. 최근 순. */
  recentChangedPaths: (now?: number) => string[];
}

export const useLiveChangesStore = create<LiveChangesState>((set, get) => ({
  lastChangedAt: {},
  watched: [],
  overflow: [],

  setWatchState: (watched, overflow) => set({ watched, overflow }),

  recordChange: (path, at) =>
    set((state) => {
      const prev = state.lastChangedAt[path];
      if (prev !== undefined && at <= prev) return state;
      return { lastChangedAt: { ...state.lastChangedAt, [path]: at } };
    }),

  recentChangedPaths: (now = Date.now()) => {
    const { lastChangedAt } = get();
    return Object.entries(lastChangedAt)
      .filter(([, at]) => now - at <= LIVE_CHANGE_STALE_MS)
      .sort((a, b) => b[1] - a[1])
      .map(([path]) => path);
  },
}));
