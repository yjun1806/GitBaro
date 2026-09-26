import { create } from "zustand";
import { useRepositoryStore } from "@/stores/repository";

/**
 * 「저장소」 단계(사이드바 저장소 줄, 모든 워크트리를 통틀어 봄) 선택. 한 번에 저장소 하나만
 * 이 상태로 볼 수 있다. 화면 상태라 저장하지 않는다(`useHistoryViewStore`와 같은 성격).
 */
interface ScopeState {
  /** 「저장소」 단계로 보는 중인 저장소 경로. 아니면 null(브랜치 단계). */
  aggregateRepoPath: string | null;
  /** repoPath를 「저장소」 단계로 본다. null이면 저장소 단계 보기를 끈다(브랜치 단계로 돌아간다). */
  viewRepoAggregate: (repoPath: string | null) => void;
}

export const useScopeStore = create<ScopeState>()((set) => ({
  aggregateRepoPath: null,
  viewRepoAggregate: (repoPath) => set({ aggregateRepoPath: repoPath }),
}));

// 연 저장소(워크트리 포함)의 소유 저장소가 바뀌면 「저장소」 단계 보기를 끈다. 다른 저장소로
// 옮겨 갔는데 이전 저장소의 집계 보기가 남아 있으면 안 된다.
let prevOwnerPath = useRepositoryStore.getState().activeRepo?.path ?? useRepositoryStore.getState().activeRepoPath;
useRepositoryStore.subscribe((state) => {
  const owner = state.activeRepo?.path ?? state.activeRepoPath;
  if (owner === prevOwnerPath) return;
  prevOwnerPath = owner;
  if (useScopeStore.getState().aggregateRepoPath !== null) useScopeStore.getState().viewRepoAggregate(null);
});
