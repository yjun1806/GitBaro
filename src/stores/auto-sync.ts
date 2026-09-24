import { create } from "zustand";
import type { AutoSyncMode } from "@/types";

/** 저장소별 마지막 자동 최신화 결과. */
export interface AutoSyncResult {
  /** 끝난 시각(ms). 다음 실행 시각도 이 값으로 계산한다. */
  at: number;
  ok: boolean;
  mode: Exclude<AutoSyncMode, "off">;
  /** 자동으로 받은(fast-forward한) 커밋 수. 받지 않았으면 0. */
  fastForwarded: number;
  error?: string;
}

/**
 * 자동 최신화의 실행 중 상태. 앱을 다시 켜면 비어 있는 게 맞아서 저장하지 않는다.
 * 설정 자체는 저장소 스토어(`autoSyncByRepo`)에 저장한다.
 */
interface AutoSyncState {
  lastResultByRepo: Record<string, AutoSyncResult>;
  /** 작업 트리 경로별 마지막 파일 변경 시각(ms). FS 감시 이벤트로 채운다. */
  lastActivityByPath: Record<string, number>;
  /** 설정 창을 열어 둔 저장소 경로. null이면 닫혀 있다. */
  settingsRepoPath: string | null;
  recordResult: (repoPath: string, result: AutoSyncResult) => void;
  markActivity: (path: string, at: number) => void;
  openSettings: (repoPath: string) => void;
  closeSettings: () => void;
}

export const useAutoSyncStore = create<AutoSyncState>()((set) => ({
  lastResultByRepo: {},
  lastActivityByPath: {},
  settingsRepoPath: null,
  recordResult: (repoPath, result) =>
    set((state) => ({ lastResultByRepo: { ...state.lastResultByRepo, [repoPath]: result } })),
  markActivity: (path, at) =>
    set((state) => ({ lastActivityByPath: { ...state.lastActivityByPath, [path]: at } })),
  openSettings: (repoPath) => set({ settingsRepoPath: repoPath }),
  closeSettings: () => set({ settingsRepoPath: null }),
}));
