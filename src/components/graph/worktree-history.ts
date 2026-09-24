/**
 * 그래프 한 장에 워크트리 여러 개의 이력을 함께 그리기 위한 병합(D5).
 * 지금 연 워크트리의 이력이 바탕이고, 칩 줄에서 고른 다른 워크트리의 첫 페이지를 끼워 넣는다.
 */

interface HistoryCommit {
  readonly id: string;
  readonly timestamp: number;
}

/**
 * 여러 이력을 한 줄로 합친다.
 * - 각 이력 안의 순서는 그대로 둔다(부모가 자식보다 뒤라는 약속을 깨지 않는다).
 * - 이력끼리는 커밋 시각이 늦은 쪽을 먼저 꺼낸다. 시각이 같으면 앞 이력(바탕)이 먼저다.
 * - 같은 커밋이 여러 이력에 있으면 처음 나온 것 하나만 둔다.
 * - `base`에 다음 페이지가 남아 있으면(`baseComplete`가 false) 바탕의 마지막 커밋보다 오래된
 *   다른 이력의 커밋은 뺀다. 다음 페이지를 불러오면 제자리에 끼워진다.
 */
export function mergeHistories<T extends HistoryCommit>(
  base: readonly T[],
  extras: readonly (readonly T[])[],
  baseComplete: boolean,
): T[] {
  if (extras.every((e) => e.length === 0)) return [...base];
  const floor = !baseComplete && base.length > 0 ? base[base.length - 1].timestamp : null;
  const lists = [base, ...extras.map((e) => (floor === null ? e : e.filter((c) => c.timestamp >= floor)))];
  const cursors = lists.map(() => 0);
  const seen = new Set<string>();
  const out: T[] = [];
  for (;;) {
    let pick = -1;
    for (let i = 0; i < lists.length; i++) {
      // 이미 꺼낸 커밋은 건너뛴다(공통 조상 등).
      while (cursors[i] < lists[i].length && seen.has(lists[i][cursors[i]].id)) cursors[i]++;
      if (cursors[i] >= lists[i].length) continue;
      if (pick < 0 || lists[i][cursors[i]].timestamp > lists[pick][cursors[pick]].timestamp) pick = i;
    }
    if (pick < 0) return out;
    const commit = lists[pick][cursors[pick]];
    cursors[pick]++;
    seen.add(commit.id);
    out.push(commit);
  }
}
