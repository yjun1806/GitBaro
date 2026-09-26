import { describe, expect, it } from "vitest";
import { computeGraphLanes } from "@/lib/graph-lanes";
import type { RefLabel } from "@/types";
import { branchColors, mutedChainNames, remoteBoundaryIndex, worktreeChainColors } from "../graph-paint";
import { withWipLanes, worktreeColor } from "../worktree-history";

const MAIN = "/repos/app";
const FEAT = "/repos/app-feat";

/**
 * f2 ─ f1 ─┐            (feat/x, 워크트리 FEAT)
 * m3 ─ m2 ─┴─ m1        (main, 기본 폴더)
 * m2는 merge된 브랜치 b1을 품는다.
 */
const commits = [
  { id: "f2", parentIds: ["f1"], refs: [{ name: "feat/x", kind: "localBranch", isHead: false }] as RefLabel[] },
  { id: "m3", parentIds: ["m2"], refs: [{ name: "main", kind: "localBranch", isHead: true }] as RefLabel[] },
  { id: "f1", parentIds: ["m1"], refs: [] as RefLabel[] },
  { id: "m2", parentIds: ["m1", "b1"], refs: [] as RefLabel[] },
  { id: "b1", parentIds: ["m1"], refs: [] as RefLabel[] },
  { id: "m1", parentIds: [], refs: [] as RefLabel[] },
];

function layoutsFor(wips: { path: string; head: string | null }[]) {
  const result = computeGraphLanes(withWipLanes(wips, commits));
  return new Map(result.rows.map((r) => [r.oid, r]));
}

describe("worktreeChainColors", () => {
  it("paints only the chains of the shown worktrees, current first", () => {
    const layouts = layoutsFor([{ path: MAIN, head: "m3" }]);
    const colors = worktreeChainColors(layouts, [
      { path: MAIN, branch: "main", head: "m3" },
      { path: FEAT, branch: "feat/x", head: "f2" },
    ]);
    expect(colors.get(layouts.get("m3")!.chain)).toBe(worktreeColor(MAIN));
    expect(colors.get(layouts.get("f2")!.chain)).toBe(worktreeColor(FEAT));
    // merge된 브랜치 b1의 줄기는 어느 워크트리에도 묶이지 않는다.
    expect(colors.has(layouts.get("b1")!.chain)).toBe(false);
  });

  it("leaves a hidden worktree's chain gray", () => {
    const layouts = layoutsFor([]);
    const colors = worktreeChainColors(layouts, [{ path: MAIN, branch: "main", head: "m3" }]);
    expect(colors.has(layouts.get("f2")!.chain)).toBe(false);
  });
});

describe("mutedChainNames", () => {
  it("names a gray chain after the branch on its newest commit, or null when merged", () => {
    const layouts = layoutsFor([]);
    const colors = worktreeChainColors(layouts, [{ path: MAIN, branch: "main", head: "m3" }]);
    const names = mutedChainNames(commits, layouts, colors);
    expect(names.get(layouts.get("f2")!.chain)).toBe("feat/x");
    expect(names.get(layouts.get("b1")!.chain)).toBeNull();
    expect(names.has(layouts.get("m3")!.chain)).toBe(false);
  });
});

describe("branchColors", () => {
  it("maps each shown worktree's branch to its colour", () => {
    const map = branchColors([
      { path: MAIN, branch: "main", head: null },
      { path: FEAT, branch: null, head: null },
    ]);
    expect([...map]).toEqual([["main", worktreeColor(MAIN)]]);
  });
});

describe("remoteBoundaryIndex", () => {
  it("points at the first commit on a remote below the unpushed ones", () => {
    const list = [{ isUnpushed: true }, { isUnpushed: true }, { isUnpushed: false }, { isUnpushed: false }];
    expect(remoteBoundaryIndex(list)).toBe(2);
  });

  it("draws nothing when everything is pushed or nothing pushed is loaded yet", () => {
    expect(remoteBoundaryIndex([{ isUnpushed: false }])).toBeNull();
    expect(remoteBoundaryIndex([{ isUnpushed: true }])).toBeNull();
    expect(remoteBoundaryIndex([])).toBeNull();
    // 원격 여부를 모르는 목록(다른 화면의 커밋)에는 경계가 없다.
    expect(remoteBoundaryIndex([{}, {}])).toBeNull();
  });

  it("goes below the last unpushed commit when merged remote commits sit between local ones", () => {
    // 원격 커밋 m9를 merge한 뒤 시간순: u3(merge) · m9 · u1 · m8. 「여기부터 아래는 원격에 있음」이
    // 참이려면 경계는 m8 위여야 한다(m9 위가 아니다).
    const list = [
      { id: "u3", isUnpushed: true },
      { id: "m9", isUnpushed: false },
      { id: "u1", isUnpushed: true },
      { id: "m8", isUnpushed: false },
    ];
    expect(remoteBoundaryIndex(list)).toBe(3);
  });

  it("skips commits whose remote state is unknown", () => {
    expect(remoteBoundaryIndex([{ isUnpushed: true }, {}, { isUnpushed: false }])).toBe(2);
  });

  // #3: 함께 그리는 다른 워크트리의 커밋(`isOwn: false`)은 경계 위치를 정하는 데 쓰지 않는다 —
  // 자신과 상관없는 별도의 브랜치라, 그 워크트리의 오래된 커밋 하나 때문에 자신의 경계가 실제보다
  // 아래로 밀리면 위에 낀 자신의(이미 올라간) 커밋들이 "아직 안 올라감"처럼 보인다.
  it("ignores another worktree's commits when placing the boundary, even if that commit is unpushed", () => {
    // main(자신)은 모두 이미 올라갔다. feat(다른 워크트리)의 오래된 커밋 하나만 안 올라갔다.
    const list = [
      { isOwn: true, isUnpushed: false }, // main의 최신 커밋
      { isOwn: false, isUnpushed: true }, // feat의 2일 전 안 올라간 커밋
      { isOwn: true, isUnpushed: false }, // main의 더 오래된 커밋
    ];
    // main 자신은 안 올라간 커밋이 없으므로 그릴 경계가 없다.
    expect(remoteBoundaryIndex(list)).toBeNull();
  });

  it("draws nothing when another worktree's already-pushed commit would sit above the boundary", () => {
    const list = [
      { isOwn: false, isUnpushed: false }, // 다른 워크트리의 이미 올라간 커밋(경계 위에 낌)
      { isOwn: true, isUnpushed: true }, // 자신의 안 올라간 커밋
      { isOwn: true, isUnpushed: false }, // 자신의 다음 커밋(경계 후보)
    ];
    // 「경계 위는 아직 안 올라갔다」가 거짓이 되므로(다른 워크트리의 이미 올라간 커밋이 위에 있음) 그리지 않는다.
    expect(remoteBoundaryIndex(list)).toBeNull();
  });

  it("still draws when only its own history has a merged-in remote commit above the boundary", () => {
    // 자신의 이력 안에서 원격 커밋이 낀 것(merge)은 원래도 허용한다 — isOwn 기본값(true)만으로도 유지된다.
    const list = [
      { isUnpushed: true }, // u3: merge 커밋(안 올라감)
      { isUnpushed: false }, // m9: merge로 들어온 원격 커밋
      { isUnpushed: true }, // u1: 더 오래된 로컬 커밋(안 올라감)
      { isUnpushed: false }, // m8
    ];
    expect(remoteBoundaryIndex(list)).toBe(3);
  });

  it("draws nothing yet while its own history hasn't reached a pushed commit (more pages may still load)", () => {
    const list = [
      { isOwn: true, isUnpushed: true },
      { isOwn: false, isUnpushed: false },
    ];
    // 다른 워크트리에는 이미 올라간 커밋이 있어도, 자신의 이력이 아직 올라간 지점에 닿지 못했으면 기다린다.
    expect(remoteBoundaryIndex(list)).toBeNull();
  });
});
