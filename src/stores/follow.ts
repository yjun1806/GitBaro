import { create } from "zustand";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";

/** 따라가는 중이면 가장 최근에 고친 파일을 자동으로 고르고, 멈추면 보던 파일에 머문다. */
export type FollowMode = "following" | "paused";

/**
 * 실시간 따라가기(D4) 상태. WIP 행을 고르면 그 워크트리를 따라가기 시작하고,
 * 사용자가 파일을 고르거나 diff를 스크롤하면 멈춘다.
 *
 * 저장하지 않는다 — 앱을 다시 열면 따라가던 곳은 잊는다.
 */
interface FollowState {
  /** 따라가는 워크트리 경로. 없으면 null. */
  target: string | null;
  mode: FollowMode;
  /** 멈춘 동안 보여 줄 파일(저장소 루트 기준 경로). 따라가는 중에는 쓰지 않는다. */
  file: string | null;
  /** `path`를 따라가기 시작한다. 이미 따라가던 곳이어도 자동 선택으로 돌아간다. */
  start: (path: string) => void;
  stop: () => void;
  /** 보던 파일에 머문다(스크롤 등). 따라가는 중이 아니면 아무것도 하지 않는다. */
  pause: (currentFile: string | null) => void;
  /** 사용자가 파일을 골랐다 — 그 파일에 머문다. */
  pickFile: (file: string) => void;
  /** 다시 가장 최근 파일을 따라간다. */
  resume: () => void;
}

export const useFollowStore = create<FollowState>((set) => ({
  target: null,
  mode: "following",
  file: null,

  start: (path) => set({ target: path, mode: "following", file: null }),

  stop: () =>
    set((state) => (state.target === null ? state : { target: null, mode: "following", file: null })),

  pause: (currentFile) =>
    set((state) =>
      state.target === null || state.mode === "paused" ? state : { mode: "paused", file: currentFile },
    ),

  pickFile: (file) =>
    set((state) => (state.target === null ? state : { mode: "paused", file })),

  resume: () => set((state) => (state.target === null ? state : { mode: "following", file: null })),
}));

/**
 * 저장소 화면에서 따라가기를 끝내는 때: 아래 칸이 「커밋하지 않은 변경」을 떠나거나
 * (커밋·스태시·Actions를 고름), 다른 저장소나 워크트리를 열었을 때. 그 뒤 WIP 행으로
 * 돌아오면 스테이징 목록이 먼저 보이지 않고 다시 따라가기부터 시작한다.
 */
useUIStore.subscribe((next, prev) => {
  if (next.activeTab !== prev.activeTab && next.activeTab !== "changes") {
    useFollowStore.getState().stop();
  }
});

useRepositoryStore.subscribe((next, prev) => {
  if (next.activeRepoPath !== prev.activeRepoPath) useFollowStore.getState().stop();
});
