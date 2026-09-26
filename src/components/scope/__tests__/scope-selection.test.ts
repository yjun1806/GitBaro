import { describe, expect, it } from "vitest";
import { carrySelection, isSelectionValid, sameSelection, type ScopeSelection } from "../scope-selection";
import type { LaneSource } from "../scope-lanes";

function lane(id: string, worktreePath: string | null = id): LaneSource {
  return {
    id,
    repoPath: "/r/a",
    worktreePath,
    isMain: true,
    branch: "main",
    defaultBranch: "main",
    unpushedCount: 0,
    wipCount: 0,
    error: null,
    remotes: ["origin"],
    color: "",
  };
}

describe("sameSelection", () => {
  it("compares by lane and commit, treating null specially", () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection({ laneId: "a", commitOid: null }, null)).toBe(false);
    expect(sameSelection({ laneId: "a", commitOid: "c1" }, { laneId: "a", commitOid: "c1" })).toBe(true);
    expect(sameSelection({ laneId: "a", commitOid: "c1" }, { laneId: "a", commitOid: "c2" })).toBe(false);
  });
});

describe("isSelectionValid", () => {
  it("is valid only when the lane still exists in the given sources", () => {
    const sources = [lane("/w/a")];
    expect(isSelectionValid({ laneId: "/w/a", commitOid: "c1" }, sources)).toBe(true);
    expect(isSelectionValid({ laneId: "/w/gone", commitOid: "c1" }, sources)).toBe(false);
    expect(isSelectionValid(null, sources)).toBe(false);
  });
});

describe("carrySelection (선택 보존: 워크스페이스 ⊃ 저장소 ⊃ 브랜치)", () => {
  const selection: ScopeSelection = { laneId: "/w/a", commitOid: "c1" };

  it("keeps the selection unchanged when its lane exists in the new scope", () => {
    const sources = [lane("/w/a"), lane("/w/b")];
    expect(carrySelection(selection, sources, "/w/a")).toBe(selection);
  });

  it("falls back to the opened (checked-out) lane's WIP row when the lane is gone", () => {
    const sources = [lane("/w/b")];
    expect(carrySelection(selection, sources, "/w/b")).toEqual({ laneId: "/w/b", commitOid: null });
  });

  it("clears the selection when the lane is gone and nothing is checked out (viewing a branch)", () => {
    const sources = [lane("/w/b", null)];
    expect(carrySelection(selection, sources, null)).toBeNull();
  });

  it("keeps a null selection as null when nothing is opened", () => {
    expect(carrySelection(null, [lane("/w/a")], null)).toBeNull();
  });
});
