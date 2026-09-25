import { describe, expect, it } from "vitest";
import { diffHeads, type HeadSnapshot } from "../head-moves";
import type { RepoReviewStatus } from "@/types";

function status(worktrees: { path: string; branch: string | null; headOid: string | null }[]): RepoReviewStatus[] {
  return [{ repoPath: "/r", worktrees: worktrees.map((w, i) => ({ ...w, isMain: i === 0 })) }];
}

describe("diffHeads", () => {
  it("records the first snapshot silently (app start does not notify)", () => {
    const { next, moves } = diffHeads({}, status([{ path: "/r", branch: "main", headOid: "a" }]), 100);
    expect(moves).toEqual([]);
    expect(next["/r"]).toEqual({ repoPath: "/r", branch: "main", headOid: "a", seenAt: 100 });
  });

  it("reports a HEAD change on the same branch with the time the old HEAD was last seen", () => {
    const first = diffHeads({}, status([{ path: "/r", branch: "main", headOid: "a" }]), 100).next;
    const second = diffHeads(first, status([{ path: "/r", branch: "main", headOid: "a" }]), 200).next;
    const { moves } = diffHeads(second, status([{ path: "/r", branch: "main", headOid: "b" }]), 300);
    expect(moves).toEqual([
      { repoPath: "/r", worktreePath: "/r", branch: "main", from: "a", to: "b", previousSeenAt: 200 },
    ]);
  });

  it("treats a branch switch as a checkout, not a new commit", () => {
    const prev: HeadSnapshot = { "/r": { repoPath: "/r", branch: "main", headOid: "a", seenAt: 1 } };
    const { next, moves } = diffHeads(prev, status([{ path: "/r", branch: "feature", headOid: "b" }]), 2);
    expect(moves).toEqual([]);
    expect(next["/r"].branch).toBe("feature");
  });

  it("tracks each linked worktree separately and starts new worktrees silently", () => {
    const prev: HeadSnapshot = { "/r": { repoPath: "/r", branch: "main", headOid: "a", seenAt: 1 } };
    const { moves, next } = diffHeads(
      prev,
      status([
        { path: "/r", branch: "main", headOid: "a" },
        { path: "/wt", branch: "agent", headOid: "x" },
      ]),
      2,
    );
    expect(moves).toEqual([]);
    expect(next["/wt"]).toMatchObject({ repoPath: "/r", headOid: "x" });
  });

  it("skips worktrees without commits and forgets removed ones", () => {
    const prev: HeadSnapshot = { "/gone": { repoPath: "/r", branch: "x", headOid: "a", seenAt: 1 } };
    const { next } = diffHeads(prev, status([{ path: "/r", branch: "main", headOid: null }]), 2);
    expect(next).toEqual({});
  });
});
