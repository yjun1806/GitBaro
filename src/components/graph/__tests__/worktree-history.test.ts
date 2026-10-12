import { describe, expect, it } from "vitest";
import { computeGraphLanes } from "@/lib/graph-lanes";
import { wipLaneOid, withWipLanes } from "../worktree-history";

describe("withWipLanes", () => {
  const commit = (id: string, parentIds: string[]) => ({ id, parentIds });
  // main (open) at m1; feat/x at f1 on top of m1.
  const commits = [commit("f1", ["m1"]), commit("m1", ["root"]), commit("root", [])];

  it("gives each worktree's WIP row its own lane that runs into that worktree's HEAD", () => {
    const input = withWipLanes(
      [
        { path: "/main", head: "m1" },
        { path: "/feat", head: "f1" },
      ],
      commits,
    );
    expect(input.map((c) => c.oid)).toEqual([wipLaneOid("/main"), wipLaneOid("/feat"), "f1", "m1", "root"]);
    const rows = new Map(computeGraphLanes(input).rows.map((r) => [r.oid, r]));
    const main = rows.get(wipLaneOid("/main"))!;
    const feat = rows.get(wipLaneOid("/feat"))!;
    expect(main.lane).not.toBe(feat.lane);
    // Each HEAD commit continues the chain its WIP row started, so both share one color.
    expect(rows.get("f1")!.chain).toBe(feat.chain);
    expect(rows.get("m1")!.chain).toBe(main.chain);
    expect(rows.get("f1")!.edges).toContainEqual(expect.objectContaining({ kind: "in", chain: feat.chain }));
  });

  it("leaves a WIP row with an unknown HEAD unconnected", () => {
    const [wip] = withWipLanes([{ path: "/x", head: null }], commits);
    expect(wip.parentIds).toEqual([]);
  });

  it("leaves a WIP row unconnected when its HEAD is not in the loaded commits", () => {
    const input = withWipLanes([{ path: "/old", head: "gone" }], commits);
    expect(input[0].parentIds).toEqual([]);
    // No lane stays open below the last row for a parent that never comes.
    const rows = computeGraphLanes(input).rows;
    expect(rows[rows.length - 1].edges.some((e) => e.kind === "out" || e.kind === "pass")).toBe(false);
  });
});
