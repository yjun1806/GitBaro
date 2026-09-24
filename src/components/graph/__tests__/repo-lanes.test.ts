import { describe, expect, it } from "vitest";
import type { CommitInfo } from "@/types";
import { buildRepoLaneRows, repoLaneColor, type LaneRepo, type LaneWip } from "../repo-lanes";

function commit(id: string, timestamp: number): CommitInfo {
  return {
    id,
    shortId: id,
    message: id,
    summary: id,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp,
    parentIds: [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

const A: LaneRepo = { path: "/w/a", commits: [commit("a2", 50), commit("a1", 10)], hasBase: true };
const B: LaneRepo = { path: "/w/b", commits: [commit("b2", 40), commit("b1", 30)], hasBase: true };
const wipA: LaneWip = { repoPath: "/w/a", path: "/w/a", branch: "feat", isMain: true, count: 2, changedAt: 1000 };

const summary = (rows: ReturnType<typeof buildRepoLaneRows>["rows"]) =>
  rows.map((r) => (r.kind === "commit" ? r.commit.id : r.kind === "wip" ? `wip:${r.repoPath}` : r.kind));

describe("buildRepoLaneRows", () => {
  it("puts WIP rows on top, then new commits by time, older commits with a seen tick per lane, then the base", () => {
    const newIds = new Map([
      ["/w/a", new Set(["a2"])],
      ["/w/b", new Set(["b2"])],
    ]);
    const { rows } = buildRepoLaneRows([A, B], [wipA], newIds);
    expect(summary(rows)).toEqual(["wip:/w/a", "a2", "b2", "b1", "a1", "base"]);
    const a1 = rows.find((r) => r.kind === "commit" && r.commit.id === "a1");
    expect(a1 && a1.kind === "commit" && a1.isSeen).toBe(true);
    // 저장소 레인마다 확인한 첫 커밋에만 눈금이 붙는다.
    const ticks = rows.flatMap((r) => (r.kind === "commit" && r.seenTick ? [r.commit.id] : []));
    expect(ticks).toEqual(["b1", "a1"]);
  });

  it("leaves out the divider when nothing is new, and the base when no repository found one", () => {
    const { rows } = buildRepoLaneRows(
      [{ ...A, hasBase: false }, { ...B, hasBase: false }],
      [],
      new Map(),
    );
    expect(summary(rows)).toEqual(["a2", "b2", "b1", "a1"]);
  });

  it("keeps each repository's own order even when its timestamps go backwards (rebase)", () => {
    const skewed: LaneRepo = { path: "/w/a", commits: [commit("child", 5), commit("parent", 60)], hasBase: false };
    const { rows } = buildRepoLaneRows([skewed, B], [], new Map());
    const ids = summary(rows);
    expect(ids.indexOf("child")).toBeLessThan(ids.indexOf("parent"));
  });

  it("gives each repository one lane that runs from its first row down into the base", () => {
    const { rows, laneCount } = buildRepoLaneRows([A, B], [], new Map());
    expect(laneCount).toBe(2);
    // a2(레인 0) → b2(레인 1) → b1 → a1 → base
    const [a2, b2, b1, a1, base] = rows;
    if (a2.kind !== "commit" || b2.kind !== "commit" || b1.kind !== "commit" || a1.kind !== "commit")
      throw new Error("unexpected rows");
    expect(a2.layout.lane).toBe(0);
    expect(b2.layout.lane).toBe(1);
    // 첫 행: 위에서 들어오는 선 없이 아래로만 나간다.
    expect(a2.layout.edges).toEqual([{ kind: "out", fromLane: 0, toLane: 0, chain: 0 }]);
    // b2 행에서 저장소 a의 레인은 지나간다.
    expect(b2.layout.edges).toContainEqual({ kind: "pass", fromLane: 0, toLane: 0, chain: 0 });
    // 맨 아래 행으로 두 레인이 모두 모인다.
    if (base.kind !== "base") throw new Error("no base row");
    expect(base.layout.edges).toEqual([
      { kind: "in", fromLane: 0, toLane: 0, chain: 0 },
      { kind: "in", fromLane: 1, toLane: 0, chain: 1 },
    ]);
  });

  it("ends a lane at its last row when that repository has no base", () => {
    const { rows } = buildRepoLaneRows([A, { ...B, hasBase: false }], [], new Map());
    const base = rows[rows.length - 1];
    if (base.kind !== "base") throw new Error("no base row");
    expect(base.layout.edges.map((e) => e.chain)).toEqual([0]);
  });

  it("puts no seen tick anywhere when nothing is new", () => {
    const { rows } = buildRepoLaneRows([A, B], [], new Map());
    expect(rows.some((r) => r.kind === "commit" && r.seenTick)).toBe(false);
  });
});

describe("buildRepoLaneRows — other worktrees' uncommitted changes", () => {
  const wipAFeat: LaneWip = {
    repoPath: "/w/a",
    path: "/w/a-feat",
    branch: "feat/b",
    isMain: false,
    count: 1,
    changedAt: 2000,
  };

  it("puts them in a separate column with no line into the repository's commits", () => {
    const { rows, laneCount } = buildRepoLaneRows([A, B], [wipAFeat, wipA], new Map());
    expect(laneCount).toBe(3);
    const wt = rows.find((r) => r.kind === "wip" && r.wip.path === "/w/a-feat");
    if (!wt || wt.kind !== "wip") throw new Error("missing worktree WIP");
    expect(wt.layout.lane).toBe(2);
    // 따로 떨어진 칸은 자기 선이 없다(부모가 이 레인에 없다).
    expect(wt.layout.edges.filter((e) => e.fromLane === 2 || e.toLane === 2)).toEqual([]);
    // 색은 저장소 레인 색을 따른다.
    expect(wt.layout.chain).toBe(0);
  });

  it("still starts the repository lane at the main checkout's WIP", () => {
    const { rows } = buildRepoLaneRows([A, B], [wipAFeat, wipA], new Map());
    const mainWip = rows.find((r) => r.kind === "wip" && r.wip.path === "/w/a");
    if (!mainWip || mainWip.kind !== "wip") throw new Error("missing main WIP");
    expect(mainWip.layout.lane).toBe(0);
    expect(mainWip.layout.edges.some((e) => e.kind === "out" && e.fromLane === 0)).toBe(true);
    // 더 최근에 바뀐 워크트리 WIP가 맨 위이고, 저장소 레인은 그 행을 지나지 않는다.
    const top = rows[0];
    if (top.kind !== "wip") throw new Error("expected WIP on top");
    expect(top.wip.path).toBe("/w/a-feat");
    expect(top.layout.edges.some((e) => e.chain === 0)).toBe(false);
  });
});

describe("repoLaneColor", () => {
  it("is fixed per repository, whatever lane it lands in", () => {
    const first = buildRepoLaneRows([A, B], [], new Map());
    const swapped = buildRepoLaneRows([B, A], [], new Map());
    const colorOfRow = (lanePaths: string[], rows: typeof first.rows, id: string) => {
      const row = rows.find((r) => r.kind === "commit" && r.commit.id === id);
      if (!row || row.kind !== "commit") throw new Error("missing");
      return repoLaneColor(lanePaths[row.layout.chain]);
    };
    expect(colorOfRow([A.path, B.path], first.rows, "a2")).toBe(repoLaneColor("/w/a"));
    expect(colorOfRow([B.path, A.path], swapped.rows, "a2")).toBe(repoLaneColor("/w/a"));
    expect(repoLaneColor("/w/a")).not.toBe(repoLaneColor("/w/b"));
  });
});
