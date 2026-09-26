import { mergeByTime } from "@/components/graph/repo-lanes";

/**
 * 그래프의 영역: 올리지 않은 작업(unpushed) → 원격에 있음(remote) → 기본 브랜치(base, 헤더가
 * 아니라 갈라진 지점 표시 행 하나). 세 단계(워크스페이스·저장소·브랜치) 모두 같은 순서다
 * (시안 `scope-unify.html`의 「영역 머리」).
 */
export type RegionKind = "unpushed" | "remote";

export type ScopeRegionRow<C> =
  | { kind: "header"; region: RegionKind }
  | { kind: "commit"; region: RegionKind; laneId: string; commit: C }
  | { kind: "base" };

/** 레인 하나의 커밋을 영역별로 나눈 것. 둘 다 최신 순이다. */
export interface SplitLaneCommits<C> {
  laneId: string;
  unpushed: readonly C[];
  remote: readonly C[];
}

/**
 * 레인의 커밋을 앞에서부터 `unpushedCount`개는 올리지 않은 쪽으로, 나머지는 원격에 있는
 * 쪽으로 나눈다. 목록이 최신 순이고(HEAD부터), 올리지 않은 커밋이 늘 맨 위에 몰려 있다는
 * 전제다 — 커밋마다 올렸는지를 직접 답해 주지 않는 조회(워크스페이스·저장소 단계의
 * `get_workspace_history`)에 쓴다.
 */
export function splitLaneCommitsByCount<C>(
  laneId: string,
  commits: readonly C[],
  unpushedCount: number,
): SplitLaneCommits<C> {
  const n = Math.max(0, Math.min(unpushedCount, commits.length));
  return { laneId, unpushed: commits.slice(0, n), remote: commits.slice(n) };
}

/**
 * 레인의 커밋을 `isUnpushed`로 나눈다. 커밋마다 올렸는지를 답해 주는 조회(브랜치 단계의
 * `get_commit_history`, `CommitInfo.isUnpushed`)에 쓴다. 순서(최신 순)는 그대로 지킨다.
 */
export function splitLaneCommitsByFlag<C>(
  laneId: string,
  commits: readonly C[],
  isUnpushed: (commit: C) => boolean,
): SplitLaneCommits<C> {
  const unpushed: C[] = [];
  const remote: C[] = [];
  for (const c of commits) (isUnpushed(c) ? unpushed : remote).push(c);
  return { laneId, unpushed, remote };
}

/**
 * 영역 행을 만든다: 올리지 않은 작업이 있으면 그 머리 + 레인을 시각순으로 합친 커밋들,
 * 원격에 있음이 있으면 같은 방식, 마지막에 `hasBase`면 기본 브랜치 표시 행 하나.
 * 영역이 비어 있으면(그 영역에 커밋을 낸 레인이 하나도 없으면) 머리를 그리지 않는다.
 * 영역 안에서는 레인마다 순서를 지키며 시각순으로 섞는다(레인은 저장소 밴드 하나에 대응한다).
 */
export function buildRegionRows<C>(
  lanes: readonly SplitLaneCommits<C>[],
  timeOf: (commit: C) => number,
  hasBase: boolean,
): ScopeRegionRow<C>[] {
  const rows: ScopeRegionRow<C>[] = [];
  appendRegion(rows, lanes, "unpushed", timeOf);
  appendRegion(rows, lanes, "remote", timeOf);
  if (hasBase) rows.push({ kind: "base" });
  return rows;
}

function appendRegion<C>(
  rows: ScopeRegionRow<C>[],
  lanes: readonly SplitLaneCommits<C>[],
  region: RegionKind,
  timeOf: (commit: C) => number,
): void {
  const active = lanes.filter((l) => l[region].length > 0);
  if (active.length === 0) return;
  rows.push({ kind: "header", region });
  const tagged = active.map((l) => l[region].map((commit) => ({ laneId: l.laneId, commit })));
  const merged = mergeByTime(tagged, (x) => timeOf(x.commit));
  for (const { laneId, commit } of merged) rows.push({ kind: "commit", region, laneId, commit });
}
