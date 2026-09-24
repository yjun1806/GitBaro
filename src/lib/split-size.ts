/**
 * 메인 칸을 나누는 두 크기: 그래프 패널 ↕ 아래 칸, 파일 목록 ↔ diff.
 * 사용자가 손잡이를 끌어 정하고 `gitbaro-ui`에 저장한다. 저장값이 망가졌거나 창보다 커도
 * 레이아웃이 무너지지 않게 여기서 범위를 맞춘다.
 */

/** 그래프 패널이 메인 칸(그래프 + 아래 칸) 높이에서 차지하는 비율. */
export const DEFAULT_GRAPH_RATIO = 0.42;
export const MIN_GRAPH_RATIO = 0.15;
export const MAX_GRAPH_RATIO = 0.8;

/** 파일 목록(커밋 정보·스테이징 목록 포함) 폭(px). */
export const DEFAULT_FILE_LIST_WIDTH = 320;
export const MIN_FILE_LIST_WIDTH = 200;
export const MAX_FILE_LIST_WIDTH = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampGraphRatio(ratio: number): number {
  return Number.isFinite(ratio) ? clamp(ratio, MIN_GRAPH_RATIO, MAX_GRAPH_RATIO) : DEFAULT_GRAPH_RATIO;
}

export function clampFileListWidth(width: number): number {
  return Number.isFinite(width) ? Math.round(clamp(width, MIN_FILE_LIST_WIDTH, MAX_FILE_LIST_WIDTH)) : DEFAULT_FILE_LIST_WIDTH;
}

/**
 * 손잡이를 `deltaPx`만큼 끌었을 때의 새 비율. `containerPx`는 그래프와 아래 칸을 합친 높이다.
 * 높이를 아직 모르면(0) 비율을 그대로 둔다.
 */
export function graphRatioAfterDrag(startRatio: number, deltaPx: number, containerPx: number): number {
  if (!(containerPx > 0)) return clampGraphRatio(startRatio);
  return clampGraphRatio(startRatio + deltaPx / containerPx);
}
