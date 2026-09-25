import { describe, expect, it } from "vitest";
import { EMPTY_CI_SEEN, isFailedRun, pickNewFailures } from "../ci-failures";
import type { WorkflowRun } from "@/types";

function run(id: number, conclusion: string | null, headBranch = "main", status = "completed"): WorkflowRun {
  return {
    id,
    name: "CI",
    status,
    conclusion,
    headBranch,
    headSha: "s",
    htmlUrl: "",
    createdAt: "",
    updatedAt: "",
    runNumber: id,
  };
}

const main = new Set(["main"]);

describe("CI failure notifications", () => {
  it("counts failure and timed_out as failed, not cancelled or running", () => {
    expect(isFailedRun(run(1, "failure"))).toBe(true);
    expect(isFailedRun(run(1, "timed_out"))).toBe(true);
    expect(isFailedRun(run(1, "cancelled"))).toBe(false);
    expect(isFailedRun(run(1, null, "main", "in_progress"))).toBe(false);
  });

  it("stays silent about failures already present on the first look", () => {
    const { notify, seen } = pickNewFailures(EMPTY_CI_SEEN, "/r", [run(1, "failure")], main);
    expect(notify).toEqual([]);
    expect(pickNewFailures(seen, "/r", [run(1, "failure")], main).notify).toEqual([]);
  });

  it("notifies once per run id when a run turns into a failure", () => {
    let state = pickNewFailures(EMPTY_CI_SEEN, "/r", [run(2, null, "main", "in_progress")], main).seen;
    const failed = pickNewFailures(state, "/r", [run(2, "failure")], main);
    expect(failed.notify.map((r) => r.id)).toEqual([2]);
    state = failed.seen;
    expect(pickNewFailures(state, "/r", [run(2, "failure")], main).notify).toEqual([]);
  });

  it("only notifies for checked-out branches, and does not replay other branches later", () => {
    let state = pickNewFailures(EMPTY_CI_SEEN, "/r", [], main).seen;
    const other = pickNewFailures(state, "/r", [run(3, "failure", "feature")], main);
    expect(other.notify).toEqual([]);
    state = other.seen;
    expect(pickNewFailures(state, "/r", [run(3, "failure", "feature")], new Set(["feature"])).notify).toEqual([]);
  });

  it("initializes each repository separately", () => {
    const state = pickNewFailures(EMPTY_CI_SEEN, "/a", [], main).seen;
    expect(pickNewFailures(state, "/b", [run(4, "failure")], main).notify).toEqual([]);
    expect(pickNewFailures(state, "/a", [run(5, "failure")], main).notify.map((r) => r.id)).toEqual([5]);
  });
});
