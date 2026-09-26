import { create } from "zustand";

/** 저장소 설정 화면의 칸. */
export type RepoSettingsSection =
  | "name"
  | "account"
  | "sync"
  | "list"
  | "notifications"
  | "info"
  | "danger";

interface RepoSettingsState {
  /** 설정 화면을 연 저장소 경로. null이면 닫혀 있다. */
  repoPath: string | null;
  /** 처음 보일 칸. */
  section: RepoSettingsSection;
  open: (repoPath: string, section?: RepoSettingsSection) => void;
  close: () => void;
}

/**
 * 저장소 설정 화면을 어디서 열었든(머리 줄, 사이드바 메뉴, 자동 최신화 안내) 한 곳(`RepoSettingsHost`)에서 띄운다.
 * 메뉴는 누르는 즉시 닫히므로 화면 상태를 메뉴 밖에 둔다. 저장하지 않는다.
 */
export const useRepoSettingsStore = create<RepoSettingsState>()((set) => ({
  repoPath: null,
  section: "name",
  open: (repoPath, section = "name") => set({ repoPath, section }),
  close: () => set({ repoPath: null }),
}));
