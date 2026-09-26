import { describe, expect, it } from "vitest";
import { buildRegionRows, splitLaneCommitsByCount, splitLaneCommitsByFlag } from "../scope-regions";

interface C {
  id: string;
  t: number;
  isUnpushed?: boolean;
}
const timeOf = (c: C) => c.t;

describe("splitLaneCommitsByCount", () => {
  it("takes the front N (newest) commits as unpushed, the rest as on the remote", () => {
    const commits: C[] = [{ id: "c3", t: 30 }, { id: "c2", t: 20 }, { id: "c1", t: 10 }];
    const { unpushed, remote } = splitLaneCommitsByCount("a", commits, 2);
    expect(unpushed.map((c) => c.id)).toEqual(["c3", "c2"]);
    expect(remote.map((c) => c.id)).toEqual(["c1"]);
  });

  it("clamps an out-of-range count instead of throwing", () => {
    const commits: C[] = [{ id: "c1", t: 10 }];
    expect(splitLaneCommitsByCount("a", commits, 5).unpushed).toHaveLength(1);
    expect(splitLaneCommitsByCount("a", commits, -1).unpushed).toHaveLength(0);
  });
});

describe("splitLaneCommitsByFlag", () => {
  it("splits by the per-commit flag, keeping order", () => {
    const commits: C[] = [
      { id: "c3", t: 30, isUnpushed: true },
      { id: "c2", t: 20, isUnpushed: false },
      { id: "c1", t: 10, isUnpushed: true },
    ];
    const { unpushed, remote } = splitLaneCommitsByFlag("a", commits, (c) => c.isUnpushed === true);
    expect(unpushed.map((c) => c.id)).toEqual(["c3", "c1"]);
    expect(remote.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("buildRegionRows", () => {
  it("orders unpushed before remote before base, with a header only when the region has commits", () => {
    const rows = buildRegionRows(
      [{ laneId: "a", unpushed: [{ id: "u1", t: 10 }], remote: [{ id: "r1", t: 5 }] }],
      timeOf,
      true,
    );
    expect(rows.map((r) => (r.kind === "commit" ? r.commit.id : r.kind))).toEqual([
      "header",
      "u1",
      "header",
      "r1",
      "base",
    ]);
    expect(rows[0]).toMatchObject({ kind: "header", region: "unpushed" });
    expect(rows[2]).toMatchObject({ kind: "header", region: "remote" });
  });

  it("omits a region's header entirely when no lane has anything there", () => {
    const rows = buildRegionRows([{ laneId: "a", unpushed: [], remote: [{ id: "r1", t: 5 }] }], timeOf, false);
    expect(rows.map((r) => (r.kind === "commit" ? r.commit.id : r.kind))).toEqual(["header", "r1"]);
    expect(rows.every((r) => !(r.kind === "header" && r.region === "unpushed"))).toBe(true);
  });

  it("omits the base row when hasBase is false", () => {
    const rows = buildRegionRows([{ laneId: "a", unpushed: [{ id: "u1", t: 1 }], remote: [] }], timeOf, false);
    expect(rows[rows.length - 1]).toEqual({
      kind: "commit",
      region: "unpushed",
      laneId: "a",
      commit: { id: "u1", t: 1 },
    });
  });

  it("interleaves lanes by time within a region while keeping each lane's own order (repo bands)", () => {
    const rows = buildRegionRows(
      [
        { laneId: "a", unpushed: [{ id: "a2", t: 50 }, { id: "a1", t: 10 }], remote: [] },
        { laneId: "b", unpushed: [{ id: "b2", t: 40 }, { id: "b1", t: 30 }], remote: [] },
      ],
      timeOf,
      false,
    );
    const ids = rows.filter((r) => r.kind === "commit").map((r) => (r as { commit: C }).commit.id);
    expect(ids).toEqual(["a2", "b2", "b1", "a1"]);
    // 각 레인 안의 순서(부모가 자식보다 아래)는 흐트러지지 않는다.
    expect(ids.indexOf("a2")).toBeLessThan(ids.indexOf("a1"));
    expect(ids.indexOf("b2")).toBeLessThan(ids.indexOf("b1"));
  });

  it("tags every commit row with its region and lane", () => {
    const rows = buildRegionRows(
      [{ laneId: "a", unpushed: [{ id: "u1", t: 1 }], remote: [{ id: "r1", t: 1 }] }],
      timeOf,
      false,
    );
    const commits = rows.filter((r) => r.kind === "commit");
    expect(commits.every((r) => r.kind === "commit" && r.laneId === "a")).toBe(true);
  });
});
