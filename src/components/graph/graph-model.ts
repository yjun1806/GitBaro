import { avatarColor } from "@/lib/avatar-color";

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

/** 줄기마다 돌려 쓰는 명도(%). 첫 값이 저장소 아바타 색 그대로(`avatarColor`의 45%)다. */
const LANE_LIGHTNESS = [45, 62, 32, 54, 38];

/**
 * 줄기(chain)의 선 색. 모든 줄기가 저장소 아바타 색(`avatarColor`)의 색조를 그대로 쓴다
 * (README: 저장소 색 = 그래프 레인 색). 한 저장소 안의 여러 줄기는 명도만 바꿔 구별한다.
 * 첫 줄기(0, 보통 HEAD가 있는 줄기)는 저장소 색 그대로다.
 */
export function laneColor(seed: string, chain: number): string {
  const base = avatarColor(seed).background;
  if (chain === 0) return base;
  const hue = /hsl\((\d+)/.exec(base)?.[1] ?? "0";
  const lightness = LANE_LIGHTNESS[chain % LANE_LIGHTNESS.length];
  return `hsl(${hue}, 55%, ${lightness}%)`;
}

export interface NewCommitMarks {
  /** 새 커밋으로 표시할 커밋(불러온 것 중). */
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
 * 새 커밋은 백엔드가 개수를 셀 때 고른 커밋 그대로다(`list_new_commit_ids`의 `ids`).
 * 그래서 점과 구분선이 버튼의 N과 늘 같은 커밋을 가리킨다. 기반 브랜치에서 병합해 들어온
 * 커밋처럼 시간순으로 새 커밋 사이에 끼어도 새 커밋이 아닌 커밋에는 점을 찍지 않는다.
 *
 * 구분선은 마지막 새 커밋 바로 아래에 둔다. 새 커밋을 다 찾지 못했으면(다음 페이지에 있거나,
 * 백엔드 목록이 상한에서 잘렸으면) 그리지 않는다.
 */
export function markNewCommits(
  commits: readonly { id: string }[],
  newCommits: { newCount: number; ids: readonly string[] } | null,
): NewCommitMarks {
  if (!newCommits || newCommits.newCount <= 0 || newCommits.ids.length === 0) return NO_MARKS;
  const wanted = new Set(newCommits.ids);
  const newIds = new Set(commits.filter((c) => wanted.has(c.id)).map((c) => c.id));
  const complete = newCommits.ids.length >= newCommits.newCount && newIds.size === wanted.size;
  if (!complete) return { newIds, dividerBefore: null };
  let last = -1;
  commits.forEach((c, i) => {
    if (newIds.has(c.id)) last = i;
  });
  return { newIds, dividerBefore: last + 1 };
}

/**
 * 「여기까지 확인함 · 오늘 14:10」의 시각 부분. 오늘·어제는 그 말과 시:분, 그보다 전은
 * 날짜와 시:분으로 쓴다(시안 `gen_d.py`의 구분선 문구).
 */
export function formatSeenClock(
  seenAtMs: number,
  nowMs: number,
  labels: { today: (time: string) => string; yesterday: (time: string) => string },
  locale?: string,
): string {
  const seen = new Date(seenAtMs);
  const time = `${String(seen.getHours()).padStart(2, "0")}:${String(seen.getMinutes()).padStart(2, "0")}`;
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  if (seenAtMs >= startOfToday.getTime()) return labels.today(time);
  if (seenAtMs >= startOfToday.getTime() - dayMs) return labels.yesterday(time);
  const date = seen.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return `${date} ${time}`;
}

export interface GraphWip {
  /** 워크트리 경로. */
  path: string;
  /** 체크아웃한 브랜치. detached HEAD면 null. */
  branch: string | null;
  /** 커밋하지 않은 파일 수. 아직 모르면 null. */
  count: number | null;
  /** 커밋하지 않은 파일이 마지막으로 바뀐 시각(epoch ms). 모르거나 없으면 null. */
  changedAt: number | null;
  /** 지금 열어 둔 워크트리(그래프가 보여 주는 이력의 주인)인지. */
  isCurrent: boolean;
  isMain: boolean;
  /** 그 워크트리의 HEAD 커밋. 브랜치가 없을 때(detached) 「HEAD <sha>」로 보여 준다. 모르면 null. */
  headOid?: string | null;
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

/**
 * 그래프에 그릴 WIP 행. 커밋하지 않은 파일이 없는(0) 워크트리의 행은 숨긴다. 수를 아직 모르면(null)
 * 남기고, 따라가는 중인 워크트리는 0이 돼도 남긴다(아래 칸이 그 워크트리를 계속 보여 주므로).
 */
export function visibleWipRows(wips: readonly GraphWip[], followTarget: string | null): GraphWip[] {
  const followed = followTarget !== null ? normalizePath(followTarget) : null;
  return wips.filter((w) => w.count !== 0 || normalizePath(w.path) === followed);
}

/**
 * 저장소 그래프의 「main에서 갈라진 지점」 행을 둘 자리: 갈라진 지점 커밋 바로 위.
 * 기본 브랜치 자신을 보고 있거나(그때 기준은 upstream이라 「main에서 갈라짐」이 아니다),
 * 갈라진 지점을 못 찾았거나, 그 커밋을 아직 불러오지 않았으면 null.
 */
export function forkPointIndex(
  commits: readonly { id: string }[],
  changes:
    | { baseStatus: string | null; mergeBaseOid: string | null; branch: string | null; defaultBranch: string | null }
    | undefined,
): number | null {
  if (!changes || changes.baseStatus !== "found" || !changes.mergeBaseOid) return null;
  if (changes.defaultBranch === null || changes.branch === changes.defaultBranch) return null;
  const index = commits.findIndex((c) => c.id === changes.mergeBaseOid);
  return index === -1 ? null : index;
}

/** WIP 행·커밋 입력이 밝히는 「어디에 쌓인 변경인가」. */
export interface WipTarget {
  /** 체크아웃한 브랜치. 브랜치가 없으면(detached HEAD) null. */
  branch: string | null;
  /** 브랜치가 없을 때 보여 줄 HEAD의 짧은 SHA. 모르면 null. */
  shortSha: string | null;
  /** 연결된 워크트리의 폴더 이름. 메인 작업 트리면 null. */
  worktree: string | null;
}

/**
 * 커밋하지 않은 변경이 어느 브랜치·워크트리에 있는지. 브랜치 이름과 워크트리 폴더 이름은 따로 보여 준다
 * (같은 브랜치 이름이어도 워크트리가 다르면 다른 작업이다).
 */
export function wipTarget(wip: { path: string; branch: string | null; isMain: boolean; headOid?: string | null }): WipTarget {
  const trimmed = wip.path.replace(/\/+$/, "");
  return {
    branch: wip.branch,
    shortSha: wip.branch === null && wip.headOid ? wip.headOid.slice(0, 7) : null,
    worktree: wip.isMain ? null : (trimmed.split("/").pop() ?? trimmed),
  };
}
