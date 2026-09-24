import { create } from "zustand";
import type { CommitInfo } from "@/types";

/**
 * 커밋 그래프의 범위 모드. 브랜치 패널에서 「비교」를 누르면 그래프가 `base..target`
 * (target에만 있고 base에는 없는 커밋)만 보여 준다. 저장하지 않는다.
 */
export interface BranchRange {
  /** 범위를 정한 저장소(워크트리) 경로. 다른 저장소를 열면 범위 모드를 쓰지 않는다. */
  repoPath: string;
  base: string;
  target: string;
}

interface BranchRangeState {
  range: BranchRange | null;
  setRange: (range: BranchRange) => void;
  /** base와 target을 맞바꾼다(`target..base`). */
  swap: () => void;
  clear: () => void;
}

export const useBranchRangeStore = create<BranchRangeState>()((set) => ({
  range: null,
  setRange: (range) => set({ range }),
  swap: () =>
    set((s) => (s.range ? { range: { ...s.range, base: s.range.target, target: s.range.base } } : s)),
  clear: () => set({ range: null }),
}));

/** 지금 연 저장소에 해당하는 범위. 다른 저장소의 범위면 null. */
export function activeRange(range: BranchRange | null, activeRepoPath: string | null): BranchRange | null {
  return range && activeRepoPath !== null && range.repoPath === activeRepoPath ? range : null;
}

/** `base..target` 표기. */
export function rangeLabel(range: Pick<BranchRange, "base" | "target">): string {
  return `${range.base}..${range.target}`;
}

/**
 * 범위 안 커밋만으로 레인을 계산할 입력. 범위 밖 부모(갈라진 지점 아래)는 끝내 목록에
 * 나오지 않으므로 빼서 넘긴다. 그러지 않으면 그 부모를 기다리는 레인이 끝까지 열려 있다
 * (`computeGraphLanes` 설명 참고).
 */
export function rangeLaneInput(commits: readonly CommitInfo[]): { oid: string; parentIds: string[] }[] {
  const inRange = new Set(commits.map((c) => c.id));
  return commits.map((c) => ({ oid: c.id, parentIds: c.parentIds.filter((p) => inRange.has(p)) }));
}
