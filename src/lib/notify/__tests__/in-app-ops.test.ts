import { describe, expect, it } from "vitest";
import { EMPTY_IN_APP_OPS, IN_APP_GRACE_MS, isCausedInApp, opEnded, opStarted } from "../in-app-ops";

const commit = { id: "1", operation: "commit" as const, repoPath: "/wt/" };

describe("in-app git operations", () => {
  it("suppresses a HEAD move while an in-app commit on that worktree is still running", () => {
    const ops = opStarted(EMPTY_IN_APP_OPS, commit);
    expect(isCausedInApp(ops, "/wt", 0)).toBe(true);
    expect(isCausedInApp(ops, "/other", 0)).toBe(false);
  });

  it("suppresses a HEAD move when an in-app operation ended after the old HEAD was last seen", () => {
    const ops = opEnded(opStarted(EMPTY_IN_APP_OPS, commit), "1", 5_000);
    expect(isCausedInApp(ops, "/wt", 4_000)).toBe(true);
    // 끝난 뒤에 옛 HEAD 를 다시 확인했다면 그다음 이동은 앱 밖의 일이다.
    expect(isCausedInApp(ops, "/wt", 5_000 + IN_APP_GRACE_MS + 1)).toBe(false);
  });

  it("does not let fetch or push hide an agent's commit", () => {
    const ops = opStarted(EMPTY_IN_APP_OPS, { id: "2", operation: "fetch", repoPath: "/wt" });
    expect(isCausedInApp(ops, "/wt", 0)).toBe(false);
    expect(isCausedInApp(opEnded(ops, "2", 10), "/wt", 0)).toBe(false);
  });

  it("counts pull as an in-app HEAD move", () => {
    const ops = opEnded(opStarted(EMPTY_IN_APP_OPS, { id: "3", operation: "pull", repoPath: "/r" }), "3", 100);
    expect(isCausedInApp(ops, "/r", 50)).toBe(true);
  });
});
