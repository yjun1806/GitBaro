import { describe, expect, it, vi } from "vitest";
import {
  isRunnable,
  isSelectable,
  prepareRemotePlan,
  runRemotePlan,
  targetsFor,
  type RemoteDeps,
  type RemotePlanRow,
  type RemoteRowResult,
} from "@/hooks/useMultiRepoRemote";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";
import type { RemoteOp, RepoRemotePlan } from "@/types";

function plan(path: string, overrides: Partial<RepoRemotePlan> = {}): RepoRemotePlan {
  return {
    path,
    branch: "feat/x",
    remote: "origin",
    command: "git push origin feat/x",
    commits: 1,
    behind: 0,
    needsPull: false,
    setsUpstream: false,
    skip: false,
    skipReason: null,
    fetchedAt: 1_700_000_000,
    error: null,
    ...overrides,
  };
}

function row(path: string, overrides: Partial<RepoRemotePlan> = {}, accountId: string | null = "acc"): RemotePlanRow {
  return { name: path.slice(1), accountId, plan: plan(path, overrides), fetchFailed: false, lastFetchedAt: null };
}

function deps(overrides: Partial<RemoteDeps> = {}): RemoteDeps & { calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) =>
    vi.fn((path: string, accountId: string) => {
      calls.push(`${name} ${path} ${accountId}`);
      return Promise.resolve();
    });
  return {
    calls,
    fetch: record("fetch"),
    pull: record("pull"),
    push: record("push"),
    plan: vi.fn((paths: string[]) => {
      calls.push(`plan ${paths.join(",")}`);
      return Promise.resolve(paths.map((p) => plan(p)));
    }),
    ...overrides,
  };
}

const targets = [
  { path: "/a", name: "a", accountId: "acc-a", lastFetchedAt: null },
  { path: "/b", name: "b", accountId: "acc-b", lastFetchedAt: null },
];

describe("prepareRemotePlan", () => {
  it("fetches every repository with its own account before planning a push", async () => {
    const d = deps();
    const { rows, fetchedPaths } = await prepareRemotePlan(targets, "push", d);
    expect(d.calls).toEqual(["fetch /a acc-a", "fetch /b acc-b", "plan /a,/b"]);
    expect(fetchedPaths).toEqual(["/a", "/b"]);
    expect(rows.map((r) => r.fetchFailed)).toEqual([false, false]);
  });

  it("marks a repository whose fetch failed as planned from the last fetch, and keeps the rest", async () => {
    const d = deps({
      fetch: vi.fn((path: string) => (path === "/a" ? Promise.reject(new Error("offline")) : Promise.resolve())),
    });
    const { rows, fetchedPaths } = await prepareRemotePlan(targets, "pull", d);
    expect(rows.map((r) => [r.plan.path, r.fetchFailed])).toEqual([
      ["/a", true],
      ["/b", false],
    ]);
    expect(fetchedPaths).toEqual(["/b"]);
    expect(rows.every(isRunnable)).toBe(true);
  });

  it("does not fetch ahead of a Fetch, and never fetches a repository without an account", async () => {
    const d = deps();
    const { rows } = await prepareRemotePlan(targets, "fetch", d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(rows.every((r) => !r.fetchFailed)).toBe(true);

    const d2 = deps();
    const { rows: rows2 } = await prepareRemotePlan(
      [{ path: "/c", name: "c", accountId: null, lastFetchedAt: null }],
      "push",
      d2,
    );
    expect(d2.fetch).not.toHaveBeenCalled();
    expect(rows2[0].fetchFailed).toBe(false);
    expect(isRunnable(rows2[0])).toBe(false);
  });

  it("dates a failed fetch's plan by the last successful fetch, not the failed attempt", async () => {
    // 실패한 fetch는 FETCH_HEAD를 비우므로 백엔드는 시각을 모른다(null). 앱이 기억한 성공 시각을 쓴다.
    const d = deps({
      fetch: vi.fn(() => Promise.reject(new Error("offline"))),
      plan: vi.fn((paths: string[]) =>
        Promise.resolve(paths.map((p) => plan(p, { fetchedAt: p === "/a" ? null : 1_600_000_000 }))),
      ),
    });
    const { rows } = await prepareRemotePlan(
      [
        { path: "/a", name: "a", accountId: "acc", lastFetchedAt: 1_650_000_000 },
        { path: "/b", name: "b", accountId: "acc", lastFetchedAt: null },
      ],
      "pull",
      d,
    );
    expect(rows.map((r) => r.lastFetchedAt)).toEqual([1_650_000_000, 1_600_000_000]);
  });

  it("lets the user pick a 'nothing to pull' repository whose fetch failed, unchecked by default", async () => {
    const d = deps({
      fetch: vi.fn(() => Promise.reject(new Error("offline"))),
      plan: vi.fn((paths: string[]) =>
        Promise.resolve(paths.map((p) => plan(p, { commits: 0, skip: true, skipReason: "upToDate" }))),
      ),
    });
    const { rows } = await prepareRemotePlan(targets, "pull", d);
    expect(rows.map(isRunnable)).toEqual([false, false]);
    expect(rows.map(isSelectable)).toEqual([true, true]);

    const run = deps();
    await runRemotePlan(rows.slice(0, 1), "pull", new Set(), () => {}, run);
    expect(run.calls).toEqual(["pull /a acc-a"]);
  });

  it("skips a repository the backend returned no plan for", async () => {
    const d = deps({ plan: vi.fn(() => Promise.resolve([plan("/b")])) });
    const { rows } = await prepareRemotePlan(targets, "push", d);
    expect(rows[0].plan.skip).toBe(true);
    expect(isRunnable(rows[0])).toBe(false);
    expect(isRunnable(rows[1])).toBe(true);
  });
});

describe("runRemotePlan", () => {
  const collect = () => {
    const events: [string, RemoteRowResult["status"]][] = [];
    return { events, onResult: (path: string, r: RemoteRowResult) => events.push([path, r.status]) };
  };

  it("runs each repository separately and keeps going after one fails", async () => {
    const d = deps({
      push: vi.fn((path: string) => (path === "/b" ? Promise.reject({ type: "GitCli", message: "rejected" }) : Promise.resolve())),
    });
    const { onResult } = collect();
    const results = await runRemotePlan([row("/a"), row("/b"), row("/c")], "push", new Set(), onResult, d);
    expect(d.push).toHaveBeenCalledTimes(3);
    expect(results["/a"]).toEqual({ status: "ok" });
    expect(results["/b"]).toEqual({ status: "failed", message: "rejected" });
    expect(results["/c"]).toEqual({ status: "ok" });
  });

  it("does not run skipped repositories or ones without an account", async () => {
    const d = deps();
    const results = await runRemotePlan(
      [row("/a", { skip: true, skipReason: "upToDate" }), row("/b", {}, null), row("/c")],
      "push",
      new Set(),
      () => {},
      d,
    );
    expect(d.calls).toEqual(["push /c acc"]);
    expect(Object.keys(results)).toEqual(["/c"]);
  });

  it("pulls first only for the repositories the user picked", async () => {
    const d = deps();
    await runRemotePlan([row("/a", { needsPull: true }), row("/b")], "push", new Set(["/a"]), () => {}, d);
    expect(d.calls).toEqual(["pull /a acc", "push /a acc", "push /b acc"]);
  });

  it("reports a pull conflict separately and moves on", async () => {
    const d = deps({ pull: vi.fn(() => Promise.reject({ type: "MergeConflict", message: "x" })) });
    const { events, onResult } = collect();
    const results = await runRemotePlan([row("/a"), row("/b")], "pull", new Set(), onResult, d);
    expect(results["/a"]).toEqual({ status: "conflict" });
    expect(events).toEqual([
      ["/a", "running"],
      ["/a", "conflict"],
      ["/b", "running"],
      ["/b", "conflict"],
    ]);
  });

  it.each<RemoteOp>(["fetch", "pull", "push"])("%s passes only the account id, never a token", async (op) => {
    const d = deps();
    await runRemotePlan([row("/a")], op, new Set(), () => {}, d);
    expect(d[op]).toHaveBeenCalledWith("/a", "acc");
  });
});

describe("targetsFor", () => {
  it("uses each repository's own assigned account", () => {
    const repos = [
      makeRepo("xames", "mos", { accountId: "mos-bot" }),
      makeRepo("xames-app", "mos", { accountId: null }),
    ];
    expect(
      targetsFor(["/repos/xames", "/repos/xames-app", "/repos/gone"], repos, { "/repos/xames": 1_700_000_000 }),
    ).toEqual([
      { path: "/repos/xames", name: "xames", accountId: "mos-bot", lastFetchedAt: 1_700_000_000 },
      { path: "/repos/xames-app", name: "xames-app", accountId: null, lastFetchedAt: null },
      { path: "/repos/gone", name: "gone", accountId: null, lastFetchedAt: null },
    ]);
  });

  it("uses the owner repository's account for a linked worktree path", () => {
    const repos = [makeRepo("xames", "mos", { accountId: "mos-bot" })];
    const worktree = "/worktrees/xames-feat";
    expect(targetsFor([worktree], repos, {}, { "/repos/xames": worktree })).toEqual([
      { path: worktree, name: "xames", accountId: "mos-bot", lastFetchedAt: null },
    ]);
  });
});
