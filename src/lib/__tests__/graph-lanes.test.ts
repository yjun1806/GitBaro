import { describe, expect, it } from "vitest";
import {
  computeGraphLanes,
  createGraphLaneState,
  type GraphCommitInput,
  type GraphEdge,
  type GraphRowLayout,
} from "@/lib/graph-lanes";

const c = (oid: string, parentIds: string[] = [], laneKey?: string): GraphCommitInput =>
  laneKey === undefined ? { oid, parentIds } : { oid, parentIds, laneKey };

const lanesOf = (rows: readonly GraphRowLayout[]) => rows.map((r) => r.lane);

const edgesOf = (row: GraphRowLayout, kind: GraphEdge["kind"]) =>
  row.edges
    .filter((e) => e.kind === kind)
    .map((e) => [e.fromLane, e.toLane])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

describe("computeGraphLanes", () => {
  it("한 줄 이력은 모두 레인 0에 놓이고 곧은 선으로 이어진다", () => {
    const { rows, state } = computeGraphLanes([c("d", ["c"]), c("c", ["b"]), c("b", ["a"]), c("a")]);

    expect(lanesOf(rows)).toEqual([0, 0, 0, 0]);
    expect(edgesOf(rows[0], "in")).toEqual([]);
    expect(edgesOf(rows[0], "out")).toEqual([[0, 0]]);
    expect(edgesOf(rows[1], "in")).toEqual([[0, 0]]);
    expect(edgesOf(rows[3], "out")).toEqual([]);
    expect(rows.every((r) => r.width === 1)).toBe(true);
    expect(new Set(rows.map((r) => r.chain)).size).toBe(1);
    expect(state.lanes).toEqual([]);
  });

  it("분기·병합: 두 번째 부모는 새 레인을 받고, 공통 조상에서 다시 모인다", () => {
    //   M (a2, b1)
    //   | \
    //   a2  b1
    //   |  /
    //   base
    const { rows } = computeGraphLanes([
      c("M", ["a2", "b1"]),
      c("a2", ["base"]),
      c("b1", ["base"]),
      c("base"),
    ]);

    expect(lanesOf(rows)).toEqual([0, 0, 1, 0]);
    expect(edgesOf(rows[0], "out")).toEqual([
      [0, 0],
      [0, 1],
    ]);
    // a2가 base를 먼저 기다리므로 b1은 레인 0으로 합류한다.
    expect(edgesOf(rows[2], "out")).toEqual([[1, 0]]);
    expect(edgesOf(rows[2], "pass")).toEqual([[0, 0]]);
    expect(edgesOf(rows[3], "in")).toEqual([[0, 0]]);
    expect(rows[3].width).toBe(1);
    // 병합으로 들어온 줄기는 다른 줄기 번호를 갖는다.
    expect(rows[2].chain).not.toBe(rows[1].chain);
  });

  it("두 브랜치 끝이 같은 부모를 기다리면 부모 행에서 여러 선이 모인다", () => {
    // 두 브랜치 끝 x, y가 모두 p를 부모로 둔다.
    const { rows } = computeGraphLanes([c("x", ["p"]), c("y", ["p"]), c("p")]);

    expect(lanesOf(rows)).toEqual([0, 1, 0]);
    // y가 레인 1에서 시작하지만 p는 이미 레인 0에서 기다리므로 레인 0으로 합류한다.
    expect(edgesOf(rows[1], "out")).toEqual([[1, 0]]);
    expect(edgesOf(rows[2], "in")).toEqual([[0, 0]]);
  });

  it("부모 3개 병합(옥토퍼스)은 레인 3개로 퍼졌다가 다시 모인다", () => {
    const { rows, state } = computeGraphLanes([
      c("O", ["p1", "p2", "p3"]),
      c("p1", ["root"]),
      c("p2", ["root"]),
      c("p3", ["root"]),
      c("root"),
    ]);

    expect(lanesOf(rows)).toEqual([0, 0, 1, 2, 0]);
    expect(edgesOf(rows[0], "out")).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(rows[0].width).toBe(3);
    expect(edgesOf(rows[1], "pass")).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(edgesOf(rows[3], "out")).toEqual([[2, 0]]);
    expect(rows[4].width).toBe(1);
    expect(state.lanes).toEqual([]);
  });

  it("중복된 부모 id는 한 번만 이어진다", () => {
    const { rows } = computeGraphLanes([c("m", ["p", "p"]), c("p")]);
    expect(edgesOf(rows[0], "out")).toEqual([[0, 0]]);
  });

  it("빈 레인은 재사용한다", () => {
    // 브랜치 b가 끝난 뒤 새로 시작하는 브랜치 c는 비어 있는 레인 1을 다시 쓴다.
    const { rows } = computeGraphLanes([
      c("a3", ["a2"]),
      c("b1", ["a2"]),
      c("a2", ["a1"]),
      c("c1", ["a1"]),
      c("a1"),
    ]);
    expect(lanesOf(rows)).toEqual([0, 1, 0, 1, 0]);
  });

  describe("페이지 경계", () => {
    const history: GraphCommitInput[] = [
      c("M2", ["m1", "f2"]),
      c("f2", ["f1"]),
      c("m1", ["M1"]),
      c("f1", ["M1"]),
      c("M1", ["x", "y", "z"]),
      c("x", ["base"]),
      c("y", ["base"]),
      c("z", ["base"]),
      c("base", ["root"]),
      c("root"),
    ];

    it("여러 페이지로 나눠 계산해도 한 번에 계산한 결과와 같다", () => {
      const whole = computeGraphLanes(history).rows;
      for (let size = 1; size < history.length; size++) {
        let state = createGraphLaneState();
        const rows: GraphRowLayout[] = [];
        for (let i = 0; i < history.length; i += size) {
          const page = computeGraphLanes(history.slice(i, i + size), state);
          rows.push(...page.rows);
          state = page.state;
        }
        expect(rows).toEqual(whole);
      }
    });

    it("다음 페이지를 이어서 계산해도 앞 페이지의 결과와 상태는 바뀌지 않는다", () => {
      const first = deepFreeze(computeGraphLanes(history.slice(0, 3)));
      const snapshot = JSON.parse(JSON.stringify(first));

      // 얼어 있는 객체를 고치려 하면 strict 모드에서 예외가 난다.
      const second = computeGraphLanes(history.slice(3), first.state);

      expect(JSON.parse(JSON.stringify(first))).toEqual(snapshot);
      expect(second.rows[0].oid).toBe("f1");
      // f1은 앞 페이지에서 f2가 기다리던 레인에 놓인다.
      expect(second.rows[0].lane).toBe(first.rows[1].lane);
    });

    it("앞 페이지가 열어 둔 레인이 다음 페이지의 첫 행에 지나가는 선으로 이어진다", () => {
      const first = computeGraphLanes(history.slice(0, 2));
      const second = computeGraphLanes(history.slice(2), first.state);
      // m1은 레인 0, 레인 1(f2의 부모 f1을 기다림)은 지나간다.
      expect(second.rows[0].lane).toBe(0);
      expect(edgesOf(second.rows[0], "pass")).toEqual([[1, 1]]);
    });
  });

  describe("레인 고정 키", () => {
    it("미리 준 키는 순서대로 레인을 예약하고, 다른 줄기는 그 레인을 쓰지 않는다", () => {
      const state = createGraphLaneState({ pinnedKeys: ["repoA", "repoB"] });
      const { rows } = computeGraphLanes(
        [
          c("b2", ["b1"], "repoB"),
          c("free", []),
          c("a2", ["a1"], "repoA"),
          c("b1", [], "repoB"),
          c("a1", [], "repoA"),
        ],
        state,
      );
      expect(lanesOf(rows)).toEqual([1, 2, 0, 1, 0]);
    });

    it("처음 본 키는 그때 비어 있는 레인에 고정되고, 줄기가 끊긴 뒤에도 같은 레인으로 돌아온다", () => {
      const first = computeGraphLanes([
        c("a2", ["a1"], "repoA"),
        c("b1", [], "repoB"),
        c("a1", [], "repoA"),
      ]);
      expect(lanesOf(first.rows)).toEqual([0, 1, 0]);
      expect(first.state.pinned).toEqual({ repoA: 0, repoB: 1 });

      // repoB가 다음 페이지에서 새 줄기로 다시 나타나도 레인 1에 놓인다.
      // 키 없는 x는 예약된 레인 0·1을 피해 레인 2를 쓴다.
      const second = computeGraphLanes([c("x", []), c("b0", [], "repoB")], first.state);
      expect(lanesOf(second.rows)).toEqual([2, 1]);
    });

    it("기다리는 레인이 여럿이면 자기 키의 고정 레인을 고른다", () => {
      const state = createGraphLaneState({ pinnedKeys: ["repoA"] });
      // 레인 1의 side와 레인 0의 tip이 모두 base를 기다리는데, base의 키는 repoA(레인 0).
      const { rows } = computeGraphLanes(
        [c("tip", ["base"], "repoA"), c("side", ["base"], "other"), c("base", [], "repoA")],
        state,
      );
      expect(rows[2].lane).toBe(0);
    });
  });

  it("1만 행을 100ms 안에 계산한다", () => {
    // 주 줄기에 기능 브랜치가 갈라졌다 병합되는 블록(5커밋)을 2천 번 반복한다.
    // 블록: M(A, Fa) → Fa → A → Fb → B, 그리고 B의 부모는 다음 블록의 M.
    const blocks = 2_000;
    const commits: GraphCommitInput[] = [];
    for (let j = 0; j < blocks; j++) {
      const below = j + 1 < blocks ? [`M${j + 1}`] : [];
      commits.push(
        c(`M${j}`, [`A${j}`, `Fa${j}`]),
        c(`Fa${j}`, [`Fb${j}`]),
        c(`A${j}`, [`B${j}`]),
        c(`Fb${j}`, [`B${j}`]),
        c(`B${j}`, below),
      );
    }
    const start = performance.now();
    const { rows } = computeGraphLanes(commits);
    const elapsed = performance.now() - start;

    expect(rows.length).toBe(10_000);
    expect(Math.max(...rows.map((r) => r.width))).toBe(2);
    expect(elapsed).toBeLessThan(100);
  });
});
