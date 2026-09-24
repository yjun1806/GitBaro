import { describe, expect, it } from "vitest";
import {
  ACTIVITY_QUIET_MS,
  DEFAULT_AUTO_SYNC,
  decideAutoSync,
  isAutoSyncDue,
  nextAutoSyncAt,
  pickDueRepos,
  resolveAutoSync,
  type AutoSyncDecisionInput,
} from "../auto-sync";
import type { AutoSyncSetting, RepoInfo } from "@/types";

const NOW = 1_000_000_000;
const MINUTE = 60 * 1000;

/** 자동으로 받아도 되는 상태. 테스트마다 조건 하나만 어긋나게 바꾼다. */
const safe: AutoSyncDecisionInput = {
  mode: "pull",
  hasUpstream: true,
  detached: false,
  ahead: 0,
  behind: 3,
  isClean: true,
  operationInProgress: false,
  lastActivityAt: null,
  now: NOW,
};

describe("decideAutoSync", () => {
  it("does nothing when the repository is off", () => {
    expect(decideAutoSync({ ...safe, mode: "off" })).toBe("skip");
  });

  it("only fetches in fetch mode, even when a fast-forward would be safe", () => {
    expect(decideAutoSync({ ...safe, mode: "fetch" })).toBe("fetch");
  });

  it("fast-forwards in pull mode when every safety rule holds", () => {
    expect(decideAutoSync(safe)).toBe("fetch+ff");
  });

  it.each<[string, Partial<AutoSyncDecisionInput>]>([
    ["no upstream", { hasUpstream: false }],
    ["detached HEAD", { detached: true }],
    ["local commits not pushed (diverged)", { ahead: 1 }],
    ["nothing to receive", { behind: 0 }],
    ["uncommitted changes", { isClean: false }],
    ["merge or rebase in progress", { operationInProgress: true }],
    ["a file changed 30 seconds ago", { lastActivityAt: NOW - 30 * 1000 }],
    ["a file changed just under 2 minutes ago", { lastActivityAt: NOW - ACTIVITY_QUIET_MS + 1 }],
  ])("falls back to fetch only with %s", (_label, override) => {
    expect(decideAutoSync({ ...safe, ...override })).toBe("fetch");
  });

  it("fast-forwards once the working tree has been quiet for 2 minutes", () => {
    expect(decideAutoSync({ ...safe, lastActivityAt: NOW - ACTIVITY_QUIET_MS })).toBe("fetch+ff");
  });
});

describe("auto sync schedule", () => {
  const every3: AutoSyncSetting = { mode: "fetch", intervalMinutes: 3 };

  it("defaults to checking every 3 minutes", () => {
    expect(resolveAutoSync({}, "/repo")).toEqual({ mode: "fetch", intervalMinutes: 3 });
    expect(resolveAutoSync({}, "/repo")).toBe(DEFAULT_AUTO_SYNC);
  });

  it("is due right away when it has never run", () => {
    expect(nextAutoSyncAt(every3, null)).toBe(0);
    expect(isAutoSyncDue(every3, null, NOW)).toBe(true);
  });

  it("is due exactly one interval after the last run", () => {
    const last = NOW - 3 * MINUTE;
    expect(nextAutoSyncAt(every3, last)).toBe(NOW);
    expect(isAutoSyncDue(every3, last, NOW)).toBe(true);
    expect(isAutoSyncDue(every3, last + 1, NOW)).toBe(false);
  });

  it("uses each repository's own interval", () => {
    const last = NOW - 5 * MINUTE;
    expect(isAutoSyncDue({ mode: "pull", intervalMinutes: 5 }, last, NOW)).toBe(true);
    expect(isAutoSyncDue({ mode: "pull", intervalMinutes: 10 }, last, NOW)).toBe(false);
    expect(nextAutoSyncAt({ mode: "fetch", intervalMinutes: 30 }, last)).toBe(last + 30 * MINUTE);
  });

  it("is never due when off", () => {
    expect(nextAutoSyncAt({ mode: "off", intervalMinutes: 1 }, null)).toBeNull();
    expect(isAutoSyncDue({ mode: "off", intervalMinutes: 1 }, 0, NOW)).toBe(false);
  });
});

describe("pickDueRepos", () => {
  const repo = (path: string, overrides: Partial<RepoInfo> = {}): RepoInfo => ({
    path,
    name: path,
    currentBranch: "main",
    isDirty: false,
    remotes: [{ name: "origin", url: "https://github.com/o/r.git" }],
    accountId: "acc",
    ...overrides,
  });

  it("returns due repositories, longest-waiting first", () => {
    const repos = [repo("/a"), repo("/b"), repo("/c")];
    const lastRun = { "/a": NOW - 4 * MINUTE, "/b": NOW - 10 * MINUTE, "/c": NOW - MINUTE };
    expect(pickDueRepos(repos, {}, lastRun, NOW).map((r) => r.path)).toEqual(["/b", "/a"]);
  });

  it("skips repositories that are off or not due at their own interval", () => {
    const repos = [repo("/off"), repo("/slow"), repo("/fast")];
    const settings: Record<string, AutoSyncSetting> = {
      "/off": { mode: "off", intervalMinutes: 1 },
      "/slow": { mode: "pull", intervalMinutes: 30 },
      "/fast": { mode: "pull", intervalMinutes: 1 },
    };
    const lastRun = { "/off": 0, "/slow": NOW - 5 * MINUTE, "/fast": NOW - 2 * MINUTE };
    expect(pickDueRepos(repos, settings, lastRun, NOW).map((r) => r.path)).toEqual(["/fast"]);
  });

  it("skips repositories without an account or a remote", () => {
    const repos = [repo("/no-account", { accountId: null }), repo("/no-remote", { remotes: [] })];
    expect(pickDueRepos(repos, {}, {}, NOW)).toEqual([]);
  });

  it("does not reorder the input list", () => {
    const repos = [repo("/a"), repo("/b")];
    pickDueRepos(repos, {}, { "/a": NOW - MINUTE * 9, "/b": NOW - MINUTE * 20 }, NOW);
    expect(repos.map((r) => r.path)).toEqual(["/a", "/b"]);
  });
});
