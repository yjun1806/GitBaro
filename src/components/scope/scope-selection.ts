import type { LaneSource } from "./scope-lanes";

/** 그래프의 선택 하나: 레인 출처와, 골랐으면 그 커밋. WIP 행을 골랐으면 `commitOid`가 null이다. */
export interface ScopeSelection {
  laneId: string;
  commitOid: string | null;
}

/** 두 선택이 같은 곳을 가리키는지. */
export function sameSelection(a: ScopeSelection | null, b: ScopeSelection | null): boolean {
  if (a === null || b === null) return a === b;
  return a.laneId === b.laneId && a.commitOid === b.commitOid;
}

/** 선택이 가리키는 레인이 지금 범위에도 있는지. */
export function isSelectionValid(selection: ScopeSelection | null, sources: readonly LaneSource[]): boolean {
  return selection !== null && sources.some((s) => s.id === selection.laneId);
}

/**
 * 선택을 새 범위로 옮긴다. 레인이 새 범위에도 있으면(워크스페이스 ⊃ 저장소 ⊃ 브랜치라 내려갈
 * 때는 늘 있다) 그대로 두고, 없으면 체크아웃한 레인의 커밋 안 한 변경으로 되돌린다.
 * 체크아웃한 레인이 없으면(체크아웃하지 않은 브랜치를 보는 중이면) 선택을 비운다.
 */
export function carrySelection(
  selection: ScopeSelection | null,
  sources: readonly LaneSource[],
  openedLaneId: string | null,
): ScopeSelection | null {
  if (isSelectionValid(selection, sources)) return selection;
  return openedLaneId !== null ? { laneId: openedLaneId, commitOid: null } : null;
}
