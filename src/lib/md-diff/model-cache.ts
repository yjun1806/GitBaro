import type { DocDiffModel } from "./types";

/**
 * 최근 계산 결과 보관소.
 *
 * 문서 보기 ↔ 통합 보기를 오갈 때마다 컴포넌트가 마운트/언마운트되는데, 캐시가 없으면
 * 그때마다 블록 매칭을 처음부터 다시 돌린다. 긴 문서에서는 조작 한 번에 수 초짜리 대기다.
 *
 * **실패도 보관한다.** 타임아웃은 문서 크기에서 오는 결정론적 결과라, 다시 눌러도 또
 * 8초를 버릴 뿐이다.
 */
export type CachedResult =
  | { ok: true; model: DocDiffModel }
  | { ok: false; error: string };

interface Entry {
  oldSrc: string;
  newSrc: string;
  result: CachedResult;
}

/**
 * 보관 개수. 파일을 A → B → A로 오갈 때 살아남을 만큼만 잡는다.
 * 항목이 원문 두 벌을 붙들고 있으므로 늘릴수록 메모리를 그대로 문다.
 */
const CAPACITY = 4;

let entries: Entry[] = [];

/**
 * 조회는 **부작용이 없다** — 렌더 중에 불러도 안전해야 한다.
 * (effect로 미루면 이미 아는 결과에도 "계산 중"이 한 프레임 스친다.)
 */
export function findCached(oldSrc: string, newSrc: string): CachedResult | null {
  const hit = entries.find((e) => e.oldSrc === oldSrc && e.newSrc === newSrc);
  return hit ? hit.result : null;
}

export function putCached(oldSrc: string, newSrc: string, result: CachedResult): void {
  const rest = entries.filter((e) => !(e.oldSrc === oldSrc && e.newSrc === newSrc));
  entries = [{ oldSrc, newSrc, result }, ...rest].slice(0, CAPACITY);
}

/** 테스트 전용 — 모듈 전역 상태를 케이스마다 비운다. */
export function clearCache(): void {
  entries = [];
}
