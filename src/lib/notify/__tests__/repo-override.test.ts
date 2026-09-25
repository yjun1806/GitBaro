import { describe, expect, it } from "vitest";
import {
  isNotifyNeeded,
  isRepoNotifyOn,
  repoNotifyChoice,
  withNotifyChoice,
} from "@/lib/notify/repo-override";
import { EMPTY_CI_SEEN, forgetUnwatchedRepos, pickNewFailures } from "@/lib/notify/ci-failures";
import type { WorkflowRun } from "@/types";

const A = "/work/a";
const B = "/work/b";
const appOn = { newCommits: true, ciFailures: true };
const appOff = { newCommits: false, ciFailures: false };

describe("isRepoNotifyOn", () => {
  it("follows the app setting when the repository has no choice of its own", () => {
    expect(isRepoNotifyOn(appOn, {}, A, "newCommits")).toBe(true);
    expect(isRepoNotifyOn(appOff, {}, A, "newCommits")).toBe(false);
  });

  it("lets a repository turn a kind on or off regardless of the app setting", () => {
    const prefs = { [A]: { notify: { newCommits: "off" as const, ciFailures: "on" as const } } };
    expect(isRepoNotifyOn(appOn, prefs, A, "newCommits")).toBe(false);
    expect(isRepoNotifyOn(appOff, prefs, A, "ciFailures")).toBe(true);
    // 다른 종류, 다른 저장소는 앱 설정 그대로다.
    expect(isRepoNotifyOn(appOff, prefs, A, "newCommits")).toBe(false);
    expect(isRepoNotifyOn(appOn, prefs, B, "newCommits")).toBe(true);
  });
});

describe("isNotifyNeeded", () => {
  it("keeps watching while any repository wants the kind, even with the app setting off", () => {
    const prefs = { [B]: { notify: { ciFailures: "on" as const } } };
    expect(isNotifyNeeded(appOff, prefs, [A, B], "ciFailures")).toBe(true);
    expect(isNotifyNeeded(appOff, prefs, [A, B], "newCommits")).toBe(false);
  });

  it("stops watching when every repository turned the kind off", () => {
    const prefs = { [A]: { notify: { newCommits: "off" as const } }, [B]: { notify: { newCommits: "off" as const } } };
    expect(isNotifyNeeded(appOn, prefs, [A, B], "newCommits")).toBe(false);
    expect(isNotifyNeeded(appOn, {}, [], "newCommits")).toBe(false);
  });
});

describe("repoNotifyChoice / withNotifyChoice", () => {
  it("reads inherit when nothing is stored", () => {
    expect(repoNotifyChoice({}, A, "newCommits")).toBe("inherit");
    expect(repoNotifyChoice({ [A]: { notify: { newCommits: "on" } } }, A, "newCommits")).toBe("on");
  });

  it("stores on/off and drops the entry for inherit", () => {
    const on = withNotifyChoice(undefined, "newCommits", "on");
    expect(on).toEqual({ newCommits: "on" });
    const both = withNotifyChoice(on, "ciFailures", "off");
    expect(both).toEqual({ newCommits: "on", ciFailures: "off" });
    expect(withNotifyChoice(both, "newCommits", "inherit")).toEqual({ ciFailures: "off" });
    expect(withNotifyChoice({ ciFailures: "off" }, "ciFailures", "inherit")).toBeUndefined();
  });
});

function failedRun(id: number, branch = "main"): WorkflowRun {
  return {
    id,
    name: "CI",
    headBranch: branch,
    status: "completed",
    conclusion: "failure",
    runNumber: id,
  } as WorkflowRun;
}

describe("forgetUnwatchedRepos", () => {
  it("makes a repository that was turned off and on again start quiet, without old failures", () => {
    const branches = new Set(["main"]);
    let seen = pickNewFailures(EMPTY_CI_SEEN, A, [], branches).seen;
    // 알림을 끈 동안 A는 살펴보지 않는다.
    seen = forgetUnwatchedRepos(seen, new Set([B]));
    expect(seen.initializedRepos.has(A)).toBe(false);
    // 다시 켜고 처음 읽은 목록의 실패는 조용히 기록만 한다.
    const back = pickNewFailures(seen, A, [failedRun(7)], branches);
    expect(back.notify).toEqual([]);
    // 그 뒤 새로 생긴 실패는 알린다.
    expect(pickNewFailures(back.seen, A, [failedRun(7), failedRun(8)], branches).notify.map((r) => r.id)).toEqual([8]);
  });

  it("returns the same record when nothing changes", () => {
    const seen = pickNewFailures(EMPTY_CI_SEEN, A, [], new Set()).seen;
    expect(forgetUnwatchedRepos(seen, new Set([A, B]))).toBe(seen);
  });
});
