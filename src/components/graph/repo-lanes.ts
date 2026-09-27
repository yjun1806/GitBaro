import type { GraphEdge, GraphRowLayout } from "@/lib/graph-lanes";
import type { CommitInfo } from "@/types";
import { laneColor } from "./graph-model";

/**
 * 저장소별 레인 모드(워크스페이스 리뷰)의 행 계산. 순수 함수만 둔다.
 *
 * 단일 저장소 그래프(`computeGraphLanes`)와 달리 레인 하나가 저장소 하나다. 저장소마다
 * 커밋을 따로 불러오므로(`get_workspace_history`) 저장소 사이에는 선을 잇지 않는다. 각 레인은
 * 그 저장소의 첫 행에서 시작해 맨 아래 「main에서 갈라진 지점」 행으로 모인다(시안 `gen_d.py`).
 */

/** 레인 하나. 순서가 레인 번호다. */
export interface LaneRepo {
  path: string;
  /** HEAD부터 갈라진 지점 바로 위까지, 최신 순(백엔드 순서 그대로). */
  commits: readonly CommitInfo[];
  /** main과 갈라진 지점을 찾았는지. 찾았으면 레인이 맨 아래 행까지 이어진다. */
  hasBase: boolean;
  /**
   * 어느 원격에도 없는 커밋(`get_workspace_history`의 `unpushedOids`). 모든 레인이 이 값을 주면 행을
   * 영역(올리지 않음 → 원격에 있음)으로 나누고 영역 머리를 끼운다. 원격이 없는 저장소가 하나라도 있으면
   * (「원격에 있음」이 거짓이 된다) 주지 않는다 — 그때는 영역 없이 시각순으로만 섞는다.
   */
  unpushedOids?: ReadonlySet<string>;
}

/** 영역 머리(D48): 지금(WIP 행 위) · 올리지 않음 · 원격에 있음. 기본 브랜치는 맨 아래 `base` 행이 말한다. */
export type LaneRegion = "now" | "unpushed" | "remote";

/** 워크트리 하나의 커밋하지 않은 변경. */
export interface LaneWip {
  repoPath: string;
  /** 워크트리 경로. 메인 작업 트리면 `repoPath`와 같다. */
  path: string;
  branch: string | null;
  isMain: boolean;
  count: number;
  /** 마지막으로 바뀐 시각(epoch ms). 모르면 null. */
  changedAt: number | null;
  /** 그 워크트리의 HEAD. 브랜치가 없을 때 「HEAD <sha>」로 보여 준다. */
  headOid?: string | null;
}

export type RepoLaneRow =
  | { kind: "wip"; key: string; repoPath: string; wip: LaneWip; layout: GraphRowLayout }
  | {
      kind: "commit";
      key: string;
      repoPath: string;
      commit: CommitInfo;
      layout: GraphRowLayout;
      /** 영역으로 나눴을 때 이 커밋의 영역. 나누지 않았으면 없다. */
      region?: "unpushed" | "remote";
    }
  | { kind: "header"; key: string; region: LaneRegion; layout: GraphRowLayout }
  | { kind: "base"; key: string; layout: GraphRowLayout };

export interface RepoLaneGraph {
  rows: RepoLaneRow[];
  /** 레인 수: 저장소 수 + 따로 떨어진 워크트리 WIP 칸 수. */
  laneCount: number;
}

/** 저장소 경로 + 커밋 SHA. 포크처럼 커밋을 공유하는 저장소가 섞여도 행이 겹치지 않게 한다. */
export function repoCommitKey(repoPath: string, oid: string): string {
  return `${repoPath}\u0000${oid}`;
}

/**
 * 레인의 색. 레인 번호가 아니라 저장소 경로로 정하므로, 저장소를 숨기거나 순서를 바꿔도
 * 같은 저장소는 늘 같은 색이다(사이드바 저장소 아바타 색과 같다).
 */
export function repoLaneColor(repoPath: string): string {
  return laneColor(repoPath, 0);
}

/**
 * 저장소마다 최신 순인 목록 여러 개를 시각순 하나로 합친다. 같은 저장소 안의 순서는 그대로
 * 둔다(시각이 뒤섞인 rebase 커밋도 부모가 자식보다 위로 올라가지 않는다). 시각이 같으면 앞
 * 저장소가 먼저다.
 *
 * `src/components/scope`의 영역별 레인 합치기(`buildRegionRows`)도 이 함수를 그대로 쓴다.
 */
export function mergeByTime<T>(lists: readonly (readonly T[])[], timeOf: (item: T) => number): T[] {
  const idx = lists.map(() => 0);
  const out: T[] = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < lists.length; i++) {
      if (idx[i] >= lists[i].length) continue;
      if (best === -1 || timeOf(lists[i][idx[i]]) > timeOf(lists[best][idx[best]])) best = i;
    }
    if (best === -1) return out;
    out.push(lists[best][idx[best]]);
    idx[best] += 1;
  }
}

type Draft =
  | { kind: "wip"; lane: number; repoLane: number; wip: LaneWip }
  | { kind: "commit"; lane: number; commit: CommitInfo; region?: "unpushed" | "remote" }
  | { kind: "header"; region: LaneRegion }
  | { kind: "base" };

/**
 * 행 순서: WIP 행(최근에 바뀐 순) → 커밋(시각순) → main에서 갈라진 지점.
 * 갈라진 지점을 찾은 저장소가 없으면 맨 아래 행도 두지 않는다.
 *
 * 모든 레인이 `unpushedOids`를 주면 영역으로 나눈다(5.1 「영역 머리」): 「지금」 머리 + WIP 행 →
 * 「올리지 않음」 머리 + 레인마다 올리지 않은 커밋(시각순) → 「원격에 있음」 머리 + 나머지 → 기본 브랜치.
 * 빈 영역은 머리도 두지 않는다. 한 레인 안의 순서는 늘 지킨다 — 올리지 않은 커밋은 HEAD 쪽에 몰려 있다.
 */
export function buildRepoLaneRows(repos: readonly LaneRepo[], wips: readonly LaneWip[]): RepoLaneGraph {
  const laneOf = new Map(repos.map((r, i) => [r.path, i]));

  // 메인 작업 트리의 WIP는 그 저장소 레인 위에 둔다(부모가 레인의 HEAD다). 다른 워크트리의
  // WIP는 부모가 이 레인에 없으므로 저장소 레인들 오른쪽의 따로 떨어진 칸에 선 없이 둔다.
  // 워크트리마다 레인을 나누는 일은 D5(W6-T2)가 맡는다.
  const detachedLane = new Map<string, number>();
  for (const w of wips) {
    if (!laneOf.has(w.repoPath) || w.isMain || detachedLane.has(w.path)) continue;
    detachedLane.set(w.path, repos.length + detachedLane.size);
  }
  const wipDrafts: Draft[] = wips
    .filter((w) => laneOf.has(w.repoPath))
    .map((wip, order) => ({ wip, order }))
    .sort(
      (a, b) =>
        (b.wip.changedAt ?? -1) - (a.wip.changedAt ?? -1) ||
        (laneOf.get(a.wip.repoPath) ?? 0) - (laneOf.get(b.wip.repoPath) ?? 0) ||
        a.order - b.order,
    )
    .map(({ wip }) => ({
      kind: "wip",
      lane: detachedLane.get(wip.path) ?? laneOf.get(wip.repoPath) ?? 0,
      repoLane: laneOf.get(wip.repoPath) ?? 0,
      wip,
    }));

  const byRegion = repos.length > 0 && repos.every((r) => r.unpushedOids !== undefined);
  const commitsOf = (region?: "unpushed" | "remote"): Draft[] =>
    mergeByTime(
      repos.map((repo, lane) =>
        repo.commits
          .filter((c) => region === undefined || (repo.unpushedOids?.has(c.id) ?? false) === (region === "unpushed"))
          .map((commit) => ({ kind: "commit" as const, lane, commit, region })),
      ),
      (d) => d.commit.timestamp,
    );
  const withHeader = (region: LaneRegion, rows: Draft[]): Draft[] =>
    rows.length > 0 ? [{ kind: "header", region }, ...rows] : [];

  const drafts: Draft[] = byRegion
    ? [
        ...withHeader("now", wipDrafts),
        ...withHeader("unpushed", commitsOf("unpushed")),
        ...withHeader("remote", commitsOf("remote")),
      ]
    : [...wipDrafts, ...commitsOf()];
  const baseIndex = repos.some((r) => r.hasBase) ? drafts.length : -1;
  if (baseIndex >= 0) drafts.push({ kind: "base" });

  // 레인마다 시작 행과 끝 행.
  const start = repos.map(() => -1);
  const last = repos.map(() => -1);
  drafts.forEach((d, i) => {
    if (d.kind !== "wip" && d.kind !== "commit") return;
    if (d.lane >= repos.length) return; // 따로 떨어진 워크트리 WIP 칸
    if (start[d.lane] === -1) start[d.lane] = i;
    last[d.lane] = i;
  });
  const end = repos.map((r, lane) =>
    start[lane] === -1 ? -1 : r.hasBase && baseIndex >= 0 ? baseIndex : last[lane],
  );

  const edgesAt = (i: number, d: Draft): GraphEdge[] => {
    const edges: GraphEdge[] = [];
    repos.forEach((_, lane) => {
      if (start[lane] === -1 || i < start[lane] || i > end[lane]) return;
      const own = (d.kind === "wip" || d.kind === "commit") && d.lane === lane;
      if (own) {
        if (i > start[lane]) edges.push({ kind: "in", fromLane: lane, toLane: lane, chain: lane });
        if (i < end[lane]) edges.push({ kind: "out", fromLane: lane, toLane: lane, chain: lane });
      } else if (d.kind === "base" && i === end[lane]) {
        edges.push({ kind: "in", fromLane: lane, toLane: 0, chain: lane });
      } else if (i > start[lane] && i < end[lane]) {
        edges.push({ kind: "pass", fromLane: lane, toLane: lane, chain: lane });
      }
    });
    return edges;
  };

  const rows: RepoLaneRow[] = drafts.map((d, i) => {
    const edges = edgesAt(i, d);
    const width = Math.max(1, ...edges.map((e) => Math.max(e.fromLane, e.toLane) + 1));
    switch (d.kind) {
      case "wip": {
        const repoPath = d.wip.repoPath;
        return {
          kind: "wip",
          key: `wip:${d.wip.path}`,
          repoPath,
          wip: d.wip,
          layout: { oid: `wip:${d.wip.path}`, lane: d.lane, chain: d.repoLane, edges, width: Math.max(width, d.lane + 1) },
        };
      }
      case "commit": {
        const repoPath = repos[d.lane].path;
        return {
          kind: "commit",
          key: repoCommitKey(repoPath, d.commit.id),
          repoPath,
          commit: d.commit,
          layout: { oid: d.commit.id, lane: d.lane, chain: d.lane, edges, width: Math.max(width, d.lane + 1) },
          ...(d.region ? { region: d.region } : {}),
        };
      }
      case "header":
        return {
          kind: "header",
          key: `header:${d.region}`,
          region: d.region,
          layout: { oid: `header:${d.region}`, lane: 0, chain: -1, edges, width },
        };
      case "base":
        return { kind: "base", key: "base", layout: { oid: "base", lane: 0, chain: -1, edges, width } };
    }
  });

  return { rows, laneCount: repos.length + detachedLane.size };
}
