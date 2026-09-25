import { describe, expect, it } from "vitest";
import { addToBurst, COMMIT_BURST_WINDOW_MS, takeDueBursts, type CommitAdvance } from "../commit-burst";

function advance(worktreePath: string, to: string, count: number, firstSubject: string | null): CommitAdvance {
  return { repoPath: "/r", worktreePath, branch: "agent", to, count, firstSubject };
}

describe("commit bursts", () => {
  it("groups commits within the window into one notification per worktree", () => {
    let bursts = addToBurst({}, advance("/wt", "b", 1, "first"), 0);
    bursts = addToBurst(bursts, advance("/wt", "d", 2, "third"), 4_000);
    bursts = addToBurst(bursts, advance("/other", "x", 1, "other"), 5_000);

    expect(takeDueBursts(bursts, COMMIT_BURST_WINDOW_MS - 1).due).toEqual([]);

    const { due, rest } = takeDueBursts(bursts, COMMIT_BURST_WINDOW_MS);
    expect(due).toEqual([
      { repoPath: "/r", worktreePath: "/wt", branch: "agent", count: 3, firstSubject: "first", latestOid: "d", startedAt: 0 },
    ]);
    expect(Object.keys(rest)).toEqual(["/other"]);
  });

  it("starts a new burst after the previous one was sent", () => {
    const first = takeDueBursts(addToBurst({}, advance("/wt", "b", 1, "a"), 0), COMMIT_BURST_WINDOW_MS);
    const second = addToBurst(first.rest, advance("/wt", "c", 1, "b"), COMMIT_BURST_WINDOW_MS + 1);
    expect(second["/wt"]).toMatchObject({ count: 1, firstSubject: "b", startedAt: COMMIT_BURST_WINDOW_MS + 1 });
  });

  it("keeps the first known subject when an earlier advance had none", () => {
    const bursts = addToBurst(addToBurst({}, advance("/wt", "b", 1, null), 0), advance("/wt", "c", 1, "later"), 1);
    expect(bursts["/wt"].firstSubject).toBe("later");
  });
});
