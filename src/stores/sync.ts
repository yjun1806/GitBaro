import { create } from "zustand";

/** 툴바 동기화 버튼이 실행하는 작업. publish는 추적 브랜치가 없는 첫 push다. */
export type SyncAction = "fetch" | "pull" | "push" | "publish";

/**
 * 저장소별 동기화 진행 상태와 마지막 fetch 시각.
 * 한 저장소에서 push하는 동안 다른 저장소로 옮겨도 그 저장소의 버튼은 막히지 않아야 한다.
 */
interface SyncState {
  syncingByRepo: Record<string, SyncAction>;
  lastFetchedByRepo: Record<string, number>;
  startSync: (repoPath: string, action: SyncAction) => void;
  finishSync: (repoPath: string) => void;
  markFetched: (repoPath: string, at: number) => void;
}

export const useSyncStore = create<SyncState>()((set) => ({
  syncingByRepo: {},
  lastFetchedByRepo: {},
  startSync: (repoPath, action) =>
    set((state) => ({ syncingByRepo: { ...state.syncingByRepo, [repoPath]: action } })),
  finishSync: (repoPath) =>
    set((state) => {
      const { [repoPath]: _done, ...rest } = state.syncingByRepo;
      return { syncingByRepo: rest };
    }),
  markFetched: (repoPath, at) =>
    set((state) => ({ lastFetchedByRepo: { ...state.lastFetchedByRepo, [repoPath]: at } })),
}));
