import { avatarColor } from "@/lib/avatar-color";
import type { NewCommitBasis } from "@/types";

/**
 * 커밋 그래프의 화면 계산(순수 함수). 레인 위치는 `@/lib/graph-lanes`가 정하고,
 * 여기서는 그 결과를 그리는 데 필요한 값(레인 색, 좌표, 새 커밋, 구분선 자리)만 만든다.
 */

/** 행 높이(px). 시안 `gen_d.py`의 `RH`. */
export const GRAPH_ROW_HEIGHT = 30;
/** 첫 레인 중심의 x 좌표와 레인 사이 간격(px). 시안 `LX = 16 + i * 14`. */
export const LANE_START_X = 16;
export const LANE_GAP = 14;
/** 레인이 이보다 많으면 오른쪽 레인은 잘라서 그린다. 글자 칸이 밀려나지 않게 한다. */
export const MAX_VISIBLE_LANES = 10;

/** 레인 번호 → 그 레인 중심의 x 좌표. */
export function laneX(lane: number): number {
  return LANE_START_X + lane * LANE_GAP;
}

/** 그래프 칸 폭. 가장 넓은 행의 레인 수에 맞추되 `MAX_VISIBLE_LANES`에서 자른다. */
export function graphColumnWidth(maxLanes: number): number {
  const lanes = Math.min(Math.max(maxLanes, 1), MAX_VISIBLE_LANES);
  return laneX(lanes - 1) + LANE_START_X;
}

/**
 * 줄기(chain)의 선 색. 저장소 아바타 색(`avatarColor`)의 색조를 쓴다.
 * 첫 줄기(0, 보통 HEAD가 있는 줄기)는 저장소 색 그대로, 나머지 줄기는 저장소 경로와
 * 줄기 번호를 합친 값의 색조를 쓴다. 같은 저장소면 늘 같은 색이 나온다.
 */
export function laneColor(seed: string, chain: number): string {
  return avatarColor(chain === 0 ? seed : `${seed}#${chain}`).background;
}

export interface NewCommitMarkInput {
  /** 이 워크트리의 새 커밋 수. 아직 모르면 null. */
  newCount: number | null;
  basis: NewCommitBasis | null;
  /** 기준선으로 기록된 커밋. 기록이 없으면 null. */
  seenOid: string | null;
}

export interface NewCommitMarks {
  /** 새 커밋으로 표시할 커밋. */
  newIds: ReadonlySet<string>;
  /**
   * 「여기까지 확인함」 구분선을 이 번호의 행 앞에 그린다(`commits.length`면 맨 끝).
   * 새 커밋이 없거나, 새 커밋이 아직 다 불러와지지 않았으면(구분선이 더 아래에 있음) null.
   */
  dividerBefore: number | null;
}

const NO_MARKS: NewCommitMarks = { newIds: new Set(), dividerBefore: null };

/**
 * 불러온 커밋 중 어느 것이 새 커밋이고, 구분선이 어디에 오는지 정한다.
 *
 * 목록은 HEAD에서 닿는 커밋을 시간순으로 늘어놓은 것이다(`get_commit_history`).
 * - 기준선 커밋에서 셌고(`basis: "oid"`) 그 커밋이 목록에 있으면: 기준선 커밋에서 닿지 않는
 *   커밋이 새 커밋이다. 병합으로 들어온 옛 커밋이 시간순으로 위쪽에 섞여도 새 커밋으로 치지 않는다.
 * - 그 밖(작성 시각·갈라진 지점으로 셈, 기준선 커밋을 아직 불러오지 않음): 위에서부터 `newCount`개다.
 *
 * 구분선은 마지막 새 커밋 바로 아래에 둔다. 새 커밋을 다 찾지 못했으면(다음 페이지에 있음) 그리지 않는다.
 */
export function markNewCommits(
  commits: readonly { id: string; parentIds: readonly string[] }[],
  { newCount, basis, seenOid }: NewCommitMarkInput,
): NewCommitMarks {
  if (!newCount || newCount <= 0 || commits.length === 0) return NO_MARKS;

  const seenIndex = seenOid ? commits.findIndex((c) => c.id === seenOid) : -1;
  let newIds: Set<string>;
  if (basis === "oid" && seenIndex >= 0) {
    const reachable = reachableFrom(commits, seenOid as string);
    newIds = new Set(commits.filter((c) => !reachable.has(c.id)).map((c) => c.id));
  } else {
    newIds = new Set(commits.slice(0, newCount).map((c) => c.id));
  }

  if (newIds.size < newCount) return { newIds, dividerBefore: null };
  let last = -1;
  commits.forEach((c, i) => {
    if (newIds.has(c.id)) last = i;
  });
  return { newIds, dividerBefore: last + 1 };
}

/** 불러온 커밋 안에서 `start`와 그 조상을 모은다. */
function reachableFrom(
  commits: readonly { id: string; parentIds: readonly string[] }[],
  start: string,
): Set<string> {
  const byId = new Map(commits.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const parent of byId.get(id)?.parentIds ?? []) {
      if (!seen.has(parent)) stack.push(parent);
    }
  }
  return seen;
}

export interface GraphWip {
  /** 워크트리 경로. */
  path: string;
  /** 체크아웃한 브랜치. detached HEAD면 null. */
  branch: string | null;
  /** 커밋하지 않은 파일 수. 아직 모르면 null. */
  count: number | null;
  /** 지금 열어 둔 워크트리(그래프가 보여 주는 이력의 주인)인지. */
  isCurrent: boolean;
  isMain: boolean;
}

/** 경로 비교용: 끝의 `/`를 뗀다. */
export function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * WIP 행 순서. 다른 워크트리를 위에(메인 먼저, 그다음 경로순), 지금 연 워크트리를 맨 아래에
 * 둔다. 지금 연 워크트리의 WIP 행은 바로 아래 HEAD 커밋과 점선으로 이어진다.
 */
export function orderWipRows(rows: readonly GraphWip[]): GraphWip[] {
  const others = rows
    .filter((r) => !r.isCurrent)
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path));
  const current = rows.filter((r) => r.isCurrent);
  return [...others, ...current];
}

/**
 * 한 행의 아래 가장자리에서 다음 행으로 이어지는 선(레인과 줄기). 커밋 행 사이에 끼는 행
 * (「여기까지 확인함」 구분선)이 선을 끊지 않고 그리는 데 쓴다.
 */
export function edgesThroughBottom(
  edges: readonly { kind: "pass" | "in" | "out"; toLane: number; chain: number }[],
): { lane: number; chain: number }[] {
  const byLane = new Map<number, number>();
  for (const edge of edges) {
    if (edge.kind !== "in" && !byLane.has(edge.toLane)) byLane.set(edge.toLane, edge.chain);
  }
  return [...byLane].map(([lane, chain]) => ({ lane, chain }));
}
