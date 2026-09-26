/**
 * 커밋 줄 「변경」 칸의 크기 막대(디자인 시스템 3.15). 순수 함수만 둔다 — 데이터는
 * `useCommitStats`(`api/queries.ts`)가 조회하고, 폭 계산만 여기서 한다. 값은 시안
 * `scope-unify.html`의 `chgCell()`을 그대로 옮겼다.
 */

/** 막대 전체 폭(px)의 하한·상한. 변경이 아주 작거나(4px) 아주 커도(40px) 칸을 벗어나지 않는다. */
const BAR_MIN_WIDTH = 4;
const BAR_MAX_WIDTH = 40;

export interface ChangeBarWidths {
  /** 막대 전체 폭(px). */
  barWidth: number;
  /** 추가(+) 구간 폭(px). */
  addWidth: number;
  /** 삭제(−) 구간 폭(px). */
  delWidth: number;
}

/**
 * 추가·삭제 줄 수를 막대 폭으로. 총 변경 줄 수(`total`)의 로그 스케일로 막대 전체 폭을 정하고,
 * 그 안을 추가·삭제 비율로 나눈다. 변경이 없으면(0줄) 막대 전체가 삭제 색 없이 하한 폭만 차지한다.
 */
export function changeBarWidths(additions: number, deletions: number): ChangeBarWidths {
  const total = additions + deletions;
  const barWidth = Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, Math.round(9 * Math.log2(1 + total / 4))));
  const addWidth = total > 0 ? Math.round((barWidth * additions) / total) : 0;
  return { barWidth, addWidth, delWidth: barWidth - addWidth };
}
