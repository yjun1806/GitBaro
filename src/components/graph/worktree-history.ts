/**
 * 워크트리 색과 WIP 행의 레인 입력(D5). 저장소 단계의 워크트리별 레인은 레인 뷰어(`repo-lanes.ts`)가 그린다.
 */
import type { GraphCommitInput } from "@/lib/graph-lanes";
import { laneColor } from "./graph-model";

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
 * 잇는다. HEAD를 모르거나 HEAD가 목록에 없으면(바탕 이력의 불러온 범위보다 오래됨) 부모 없이 둔다.
 * 없는 부모를 이으면 그 레인이 그래프 맨 아래까지 이어진다.
 */
export function withWipLanes(
  wips: readonly WipLaneInput[],
  commits: readonly { id: string; parentIds: readonly string[] }[],
): GraphCommitInput[] {
  const ids = new Set(commits.map((c) => c.id));
  return [
    ...wips.map((w) => ({ oid: wipLaneOid(w.path), parentIds: w.head && ids.has(w.head) ? [w.head] : [] })),
    ...commits.map((c) => ({ oid: c.id, parentIds: c.parentIds })),
  ];
}
