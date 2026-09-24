/**
 * 그래프 한 장에 워크트리 여러 개의 이력을 함께 그리기 위한 병합(D5).
 * 지금 연 워크트리의 이력이 바탕이고, 칩 줄에서 고른 다른 워크트리의 첫 페이지를 끼워 넣는다.
 */
import type { GraphCommitInput } from "@/lib/graph-lanes";
import { laneColor } from "./graph-model";

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

/**
 * 워크트리 하나의 색(시안 D5: 칩 아이콘·WIP 행·그 워크트리 레인·이름표가 같은 색).
 * 경로로 정하므로 그래프 밖(따라가기의 ⧉ 경고 이름표)에서도 같은 색이 나온다.
 */
export function worktreeColor(path: string): string {
  return laneColor(path, 0);
}

/** WIP 행을 레인 계산에 넣을 때 쓰는 가짜 커밋 id. 커밋 SHA와 겹치지 않는다. */
export function wipLaneOid(path: string): string {
  return `wip:${path}`;
}

/** 레인 계산에 넣을 WIP 행: 그 워크트리 경로와 HEAD 커밋(모르면 null). */
export interface WipLaneInput {
  path: string;
  head: string | null;
}

/**
 * 그래프 맨 위 WIP 행들을 커밋 목록 앞에 가짜 커밋으로 붙인다(D5). 각 WIP 행의 부모는
 * 그 워크트리의 HEAD라서, 레인 계산이 WIP 행마다 제 레인을 열고 그 워크트리의 커밋까지
 * 잇는다. HEAD를 모르면 부모 없이 둔다(선을 긋지 않는다).
 */
export function withWipLanes(
  wips: readonly WipLaneInput[],
  commits: readonly { id: string; parentIds: readonly string[] }[],
): GraphCommitInput[] {
  return [
    ...wips.map((w) => ({ oid: wipLaneOid(w.path), parentIds: w.head ? [w.head] : [] })),
    ...commits.map((c) => ({ oid: c.id, parentIds: c.parentIds })),
  ];
}
