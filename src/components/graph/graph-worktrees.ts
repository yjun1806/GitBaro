import { create } from "zustand";

/**
 * 커밋 그래프에 함께 보는 다른 워크트리(저장소마다). 기본은 비어 있어 지금 연 워크트리만 그린다.
 * 화면 상태라 저장하지 않는다 — 앱을 켜는 동안만 기억한다.
 */
interface GraphWorktreesState {
  /** 저장소 경로 → 함께 보는 워크트리 경로(지금 연 워크트리는 넣지 않는다). */
  shownByRepo: Readonly<Record<string, readonly string[]>>;
  toggle: (repoPath: string, path: string) => void;
  setShown: (repoPath: string, paths: readonly string[]) => void;
}

export const useGraphWorktreesStore = create<GraphWorktreesState>()((set) => ({
  shownByRepo: {},
  toggle: (repoPath, path) =>
    set((state) => {
      const current = state.shownByRepo[repoPath] ?? [];
      const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
      return { shownByRepo: { ...state.shownByRepo, [repoPath]: next } };
    }),
  setShown: (repoPath, paths) =>
    set((state) => ({ shownByRepo: { ...state.shownByRepo, [repoPath]: [...paths] } })),
}));
