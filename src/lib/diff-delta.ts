/**
 * 따라가기(D4)에서 「방금 바뀐 줄」을 찾는다. 같은 파일의 직전 내용과 지금 내용을 줄 단위로
 * 비교해, 지금 내용에서 새로 생긴 줄의 번호(1부터)를 돌려준다.
 *
 * 비교는 공통 앞뒤를 먼저 잘라 내고 가운데만 최장 공통 부분열(LCS)로 맞춘다. 에이전트의
 * 편집은 대개 한 곳에 몰려 있어 가운데가 작다. 가운데가 너무 크면(`LCS_CELL_LIMIT`) 줄 내용의
 * 개수만 비교하는 방법으로 물러선다. 이때는 순서가 바뀐 줄을 놓칠 수 있지만 멈추지는 않는다.
 */

/** 줄 번호 구간(양 끝 포함, 1부터). */
export interface LineRange {
  start: number;
  end: number;
}

export interface DiffDelta {
  /** 지금 내용에서 새로 생긴 줄 번호(오름차순). */
  added: number[];
  /** `added`를 이어진 구간으로 묶은 것. */
  ranges: LineRange[];
  /** 직전 내용에서 사라진 줄 수. */
  removedCount: number;
}

/** 가운데 구간의 LCS 표가 이 칸 수를 넘으면 개수 비교로 물러선다(메모리 약 16MB). */
export const LCS_CELL_LIMIT = 4_000_000;

/** 줄로 나눈다. 끝의 줄바꿈 하나는 빈 줄로 세지 않는다(에디터의 줄 번호와 맞춘다). */
export function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  const parts = content.split(/\r?\n/);
  return parts[parts.length - 1] === "" ? parts.slice(0, -1) : parts;
}

/** 줄 번호 목록을 이어진 구간으로 묶는다. 입력 순서와 중복은 상관없다. */
export function toRanges(lines: readonly number[]): LineRange[] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  return sorted.reduce<LineRange[]>((acc, line) => {
    const last = acc[acc.length - 1];
    if (last && line === last.end + 1) {
      return [...acc.slice(0, -1), { start: last.start, end: line }];
    }
    return [...acc, { start: line, end: line }];
  }, []);
}

/**
 * `prev`와 `next`의 가운데 구간에서 `next` 쪽 줄마다 짝이 있는지(LCS에 드는지) 표시한다.
 * 짝이 없는 줄이 새로 생긴 줄이다.
 */
function matchedByLcs(prev: readonly string[], next: readonly string[]): { nextMatched: boolean[]; matches: number } {
  const n = prev.length;
  const m = next.length;
  // dp[i][j] = prev[i..], next[j..]의 LCS 길이. 한 줄로 편 표를 쓴다.
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        prev[i] === next[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const nextMatched = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i] === next[j]) {
      nextMatched[j] = true;
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { nextMatched, matches: dp[0] };
}

/** 표가 너무 클 때: 줄 내용별 개수로 짝을 짓는다. 앞에서부터 남은 개수만큼 짝이 있다고 본다. */
function matchedByCount(prev: readonly string[], next: readonly string[]): { nextMatched: boolean[]; matches: number } {
  const left = new Map<string, number>();
  for (const line of prev) left.set(line, (left.get(line) ?? 0) + 1);
  let matches = 0;
  const nextMatched = next.map((line) => {
    const count = left.get(line) ?? 0;
    if (count === 0) return false;
    left.set(line, count - 1);
    matches++;
    return true;
  });
  return { nextMatched, matches };
}

/** 직전 내용 `prev`와 지금 내용 `next`를 비교해 새로 생긴 줄과 사라진 줄 수를 센다. */
export function diffDelta(prev: string, next: string): DiffDelta {
  if (prev === next) return { added: [], ranges: [], removedCount: 0 };
  const a = splitLines(prev);
  const b = splitLines(next);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const midPrev = a.slice(head, a.length - tail);
  const midNext = b.slice(head, b.length - tail);
  const { nextMatched, matches } =
    midPrev.length * midNext.length <= LCS_CELL_LIMIT
      ? matchedByLcs(midPrev, midNext)
      : matchedByCount(midPrev, midNext);

  const added = nextMatched.flatMap((matched, k) => (matched ? [] : [head + k + 1]));
  return { added, ranges: toRanges(added), removedCount: midPrev.length - matches };
}
