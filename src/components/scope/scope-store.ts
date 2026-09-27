import { create } from "zustand";
import { useRepositoryStore } from "@/stores/repository";
import type { ScopeSelection } from "./scope-selection";

/**
 * 「저장소」 단계(사이드바 저장소 줄, 모든 워크트리를 통틀어 봄) 선택과, 단계마다 레인 칩을 사용자가
 * 건드린 것. 한 번에 저장소 하나만 저장소 단계로 볼 수 있다. 화면 상태라 저장하지 않는다
 * (`useHistoryViewStore`와 같은 성격) — 앱을 켜는 동안만 기억한다.
 */
interface ScopeState {
  /** 「저장소」 단계로 보는 중인 저장소 경로. 아니면 null(브랜치 단계). */
  aggregateRepoPath: string | null;
  /** repoPath를 「저장소」 단계로 본다. null이면 저장소 단계 보기를 끈다(브랜치 단계로 돌아간다). */
  viewRepoAggregate: (repoPath: string | null) => void;
  /**
   * 워크스페이스 단계의 저장소 칩을 사용자가 건드린 것(저장소 경로 → 켜짐). 건드리지 않은 저장소는
   * 기본값(`isRepoActive`)을 쓴다.
   */
  repoShown: Readonly<Record<string, boolean>>;
  /** 저장소 단계의 워크트리 칩을 사용자가 건드린 것(레인 id → 켜짐). 없으면 기본값(`isLaneShownByDefault`). */
  laneShown: Readonly<Record<string, boolean>>;
  setRepoShown: (repoPath: string, shown: boolean) => void;
  setLaneShown: (laneId: string, shown: boolean) => void;
  /** 여러 레인의 켜짐을 한 번에 정한다(「이 워크트리만」). */
  setLanesShown: (shown: Readonly<Record<string, boolean>>) => void;
  /**
   * 마지막으로 고른 (레인, 커밋). 단계를 옮길 때 `carrySelection`이 읽는다 — 워크스페이스 화면과
   * 저장소·브랜치 화면이 선택을 따로 들고 있어 그 사이를 잇는 자리다.
   */
  lastSelection: ScopeSelection | null;
  rememberSelection: (selection: ScopeSelection | null) => void;
  /** 브랜치 단계 Actions·PR 탭의 「이 브랜치만」. 기본은 켜짐, 끄면 저장소 전체(5.1). */
  branchOnly: boolean;
  setBranchOnly: (on: boolean) => void;
}

export const useScopeStore = create<ScopeState>()((set) => ({
  aggregateRepoPath: null,
  viewRepoAggregate: (repoPath) => set({ aggregateRepoPath: repoPath }),
  repoShown: {},
  laneShown: {},
  setRepoShown: (repoPath, shown) => set((state) => ({ repoShown: { ...state.repoShown, [repoPath]: shown } })),
  setLaneShown: (laneId, shown) => set((state) => ({ laneShown: { ...state.laneShown, [laneId]: shown } })),
  setLanesShown: (shown) => set((state) => ({ laneShown: { ...state.laneShown, ...shown } })),
  lastSelection: null,
  rememberSelection: (selection) => set({ lastSelection: selection }),
  branchOnly: true,
  setBranchOnly: (on) => set({ branchOnly: on }),
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
