import { create } from "zustand";
import { historyTargetOf, sameViewTarget, useHistoryViewStore, viewTargetFor } from "@/stores/history-view";
import { useRepositoryStore } from "@/stores/repository";
import type { HistoryTarget } from "@/types";

/**
 * 「올릴 내용 합쳐 보기」가 여는 범위의 주인: 저장소(워크트리) 경로 + 보는 대상(체크아웃/특정 브랜치
 * 보기). 둘 중 하나만 바뀌어도 「자신의 이력」의 뜻 자체가 달라지므로 범위는 의미를 잃는다(개선안 #1).
 */
export interface UnpushedRangeOwner {
  repoPath: string;
  historyTarget: HistoryTarget;
}

/** 「올릴 내용 합쳐 보기」가 여는 범위: 아직 push하지 않은 커밋들. */
export interface UnpushedRange extends UnpushedRangeOwner {
  /** 범위의 시작(제외) — origin에 있는 첫 커밋. 처음부터면 null. */
  baseOid: string | null;
  /** 범위의 끝 — 연 시점(또는 그 뒤 따라간 새 HEAD, 개선안 #2) 워크트리의 HEAD. */
  headOid: string;
}

function ownerKey(owner: UnpushedRangeOwner): string {
  const target = owner.historyTarget;
  return `${owner.repoPath}\u0000${target.kind}${target.kind === "ref" ? `:${target.name}` : ""}`;
}

/** 두 소유자가 같은 화면(저장소·워크트리·보는 대상)을 가리키는지. */
export function sameRangeOwner(a: UnpushedRangeOwner, b: UnpushedRangeOwner): boolean {
  return ownerKey(a) === ownerKey(b);
}

/** `range`가 `owner`의 화면에 속하면 그대로, 아니면 null(개선안 #1 — 다른 화면의 범위를 보여주지 않는다). */
export function activeUnpushedRange(
  range: UnpushedRange | null,
  owner: UnpushedRangeOwner,
): UnpushedRange | null {
  return range && sameRangeOwner(range, owner) ? range : null;
}

interface UnpushedRangeViewState {
  /**
   * 저장소 화면에서 「올리지 않은 작업 · 원격에 올릴 내용」 칸이 열려 있는가. PR 탭(`pr-view.ts`)과
   * 같이 저장하지 않는 화면 상태다.
   */
  range: UnpushedRange | null;
  /** 상세 칸에서 고른 파일. 범위를 바꾸면 비운다. */
  selectedFile: string | null;
  open: (range: UnpushedRange) => void;
  /**
   * 열려 있는 동안 base·head를 지금 값으로 맞춘다(개선안 #2, 따라가기). 소유자가 다르면(그새 범위가
   * 닫혔거나 다른 화면의 범위가 열렸다) 아무 것도 하지 않는다.
   */
  sync: (owner: UnpushedRangeOwner, baseOid: string | null, headOid: string) => void;
  close: () => void;
  selectFile: (path: string | null) => void;
}

export const useUnpushedRangeViewStore = create<UnpushedRangeViewState>()((set) => ({
  range: null,
  selectedFile: null,
  open: (range) => set({ range, selectedFile: null }),
  sync: (owner, baseOid, headOid) =>
    set((state) => {
      if (!state.range || !sameRangeOwner(state.range, owner)) return state;
      if (state.range.baseOid === baseOid && state.range.headOid === headOid) return state;
      return { range: { ...state.range, baseOid, headOid } };
    }),
  close: () => set({ range: null, selectedFile: null }),
  selectFile: (selectedFile) => set({ selectedFile }),
}));

// 다른 저장소·워크트리를 열거나(activeRepoPath가 바뀜) 체크아웃하지 않고 보는 대상이 바뀌면(다른
// 브랜치를 보기 시작하거나 현재 체크아웃으로 돌아가면) 열린 범위는 새 화면과 상관없는 예전 파일
// 목록을 보여주게 된다 — follow.ts와 같은 방식으로 구독해서 닫는다(개선안 #1).
useRepositoryStore.subscribe((next, prev) => {
  if (next.activeRepoPath !== prev.activeRepoPath) useUnpushedRangeViewStore.getState().close();
});
useHistoryViewStore.subscribe((next, prev) => {
  if (next.repoPath !== prev.repoPath || !sameViewTarget(next.target, prev.target)) {
    useUnpushedRangeViewStore.getState().close();
  }
});

/**
 * 지금 화면(저장소·워크트리·보는 대상)에 범위가 열려 있는지. 위 구독이 대부분 걸러 주지만,
 * 화면(`MainColumn`)에서도 소유자를 한 번 더 확인해 잠깐이라도 다른 화면의 내용을 보여주지 않는다
 * (개선안 #1).
 */
export function useRangeOpenForCurrentScope(): boolean {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const viewTarget = useHistoryViewStore((s) => viewTargetFor(s, activeRepoPath));
  const range = useUnpushedRangeViewStore((s) => s.range);
  if (!activeRepoPath || !range) return false;
  return sameRangeOwner(range, { repoPath: activeRepoPath, historyTarget: historyTargetOf(viewTarget) });
}
