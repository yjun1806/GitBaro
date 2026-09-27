/**
 * 메인 칸을 나누는 크기들: (옛) 그래프 패널 ↕ 아래 칸, 파일 목록 ↔ diff, (새) 옆으로 쌓는 칸(D47/5.4)의
 * 단계별 폭. 사용자가 손잡이를 끌어 정하고 `gitbaro-ui`에 저장한다. 저장값이 망가졌거나 창보다 커도
 * 레이아웃이 무너지지 않게 여기서 범위를 맞춘다.
 */

/** 옛 위아래 나누기(`GraphSplit`, 없앰)의 그래프 비율. 저장 필드 `graphPanelRatio`를 지우지 않으려고 범위만 남긴다. */
export const DEFAULT_GRAPH_RATIO = 0.42;
export const MIN_GRAPH_RATIO = 0.15;
export const MAX_GRAPH_RATIO = 0.8;

/** 파일 목록(커밋 정보·스테이징 목록 포함) 폭(px). 손잡이로 220~420 사이에서 바꾼다(5.4). */
export const DEFAULT_FILE_LIST_WIDTH = 280;
export const MIN_FILE_LIST_WIDTH = 220;
export const MAX_FILE_LIST_WIDTH = 420;

/** diff 칸의 최소 폭(5.4). 모자라면 2단계에서만 가로 스크롤을 허용한다. */
export const MIN_DIFF_PANE_WIDTH = 424;

/** 1단계(그래프 46% + 상세, diff 없음)에서 상세 칸의 최소 폭(시안 `layout-explore.html`). */
export const LEVEL1_DETAIL_MIN_WIDTH = 360;

/**
 * 2단계에서 그래프 칸의 폭(px). 좁은 커밋 목록(레인 점 + 제목 말줄임 + 시각)으로 남아, 커밋·파일·diff를
 * 함께 오갈 수 있다(D47). 커밋 줄의 400px 이하 칸 단계(`NARROW_HIDDEN_CLASS`)가 이 폭에서 적용된다.
 */
export const GRAPH_NARROW_WIDTH = 240;

/** 2단계에서 창이 좁으면 파일 목록이 먼저 이 폭까지 줄어든다. 그래도 모자라면 가로 스크롤(5.4). */
export const MIN_FILE_LIST_SQUEEZED_WIDTH = 220;

/** 1단계에서 그래프 칸이 차지하는 비율(나머지는 상세 칸)의 기본값. 손잡이로 바꾸고 저장한다. */
export const GRAPH_LEVEL1_RATIO = 0.46;
export const MIN_PANE_GRAPH_RATIO = 0.2;
export const MAX_PANE_GRAPH_RATIO = 0.8;

/** 1단계 그래프 칸의 최소 폭(px). 커밋 줄의 400px 칸 단계(좁은 목록과 같은 모양)까지만 줄어든다. */
export const MIN_PANE_GRAPH_WIDTH = 400;

/** 1단계 옆 칸(상세)의 최소 폭(px, 5.4 「상세 280」). 옆 칸에 diff까지 있으면 파일 목록 220 + diff 424. */
export const MIN_PANE_DETAIL_WIDTH = 280;

/** 2단계 좁은 커밋 목록 폭의 범위(px). 기본은 {@link GRAPH_NARROW_WIDTH}. */
export const MIN_NARROW_LIST_WIDTH = 180;
export const MAX_NARROW_LIST_WIDTH = 400;

/** 크게 보기(3단계)에서 diff 옆에 남는 파일 목록의 폭(px, 펼침·접힘). */
export const MAXIMIZED_LIST_WIDTH = 260;
export const MAXIMIZED_LIST_FOLDED_WIDTH = 36;

/** 칸 사이 간격(px). `--g` 토큰과 같은 값(2.3). */
export const PANE_GAP = 8;

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

export function clampPaneGraphRatio(ratio: number): number {
  return Number.isFinite(ratio) ? clamp(ratio, MIN_PANE_GRAPH_RATIO, MAX_PANE_GRAPH_RATIO) : GRAPH_LEVEL1_RATIO;
}

export function clampNarrowListWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.round(clamp(width, MIN_NARROW_LIST_WIDTH, MAX_NARROW_LIST_WIDTH))
    : GRAPH_NARROW_WIDTH;
}
