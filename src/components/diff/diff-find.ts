// diff 안 찾기 — 순수 로직. 화면(DOM)을 칠하는 일은 find-highlight.ts가 한다.

/** 한 파일에서 세는 일치의 상한. 흔한 한 글자로 5만 줄을 찾으면 수십만 개가 되어 목록이 무거워진다. */
export const MAX_FIND_MATCHES = 10_000;

/** 찾기 조건. `query`가 비면 찾지 않는다. */
export interface DiffFindQuery {
  query: string;
  caseSensitive: boolean;
}

/** 줄 보기의 칸: 나란히 보기의 옛 쪽·새 쪽, 또는 통합 보기의 한 줄. */
export type FindSide = "old" | "new" | "line";

/** 줄 보기에서 찾은 한 곳. `nth`는 같은 칸 안에서 몇 번째 일치인지(0부터)다. */
export interface FindMatch {
  row: number;
  side: FindSide;
  nth: number;
}

export interface FindCell {
  side: FindSide;
  text: string;
}

/** 찾을 말을 정규식으로. 특수 문자는 글자 그대로 찾는다. 빈 말이면 null. */
export function compileFindRegex(q: DiffFindQuery): RegExp | null {
  if (!q.query) return null;
  const escaped = q.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, q.caseSensitive ? "g" : "gi");
}

/** `text` 안의 일치마다 [시작, 끝)을 넘긴다. 콜백이 false를 돌려주면 멈춘다. */
export function forEachMatch(text: string, re: RegExp, cb: (start: number, end: number) => boolean | void): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (cb(m.index, m.index + m[0].length) === false) return;
  }
}

/**
 * 행마다 칸의 글을 받아 일치를 모은다. 행 순서대로, 한 행 안에서는 칸 순서대로 나온다.
 * `limit`개에서 멈추고 `capped`로 알린다.
 */
export function findLineMatches(
  rowCount: number,
  cellsOf: (row: number) => FindCell[],
  re: RegExp,
  limit = MAX_FIND_MATCHES,
): { matches: FindMatch[]; capped: boolean } {
  const matches: FindMatch[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (const cell of cellsOf(row)) {
      let nth = 0;
      let full = false;
      forEachMatch(cell.text, re, () => {
        if (matches.length >= limit) {
          full = true;
          return false;
        }
        matches.push({ row, side: cell.side, nth: nth++ });
      });
      if (full) return { matches, capped: true };
    }
  }
  return { matches, capped: false };
}

/** 다음(1)·이전(-1) 일치의 번호. 끝에서 처음으로, 처음에서 끝으로 돈다. */
export function stepMatch(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return 0;
  return (((current + dir) % count) + count) % count;
}
