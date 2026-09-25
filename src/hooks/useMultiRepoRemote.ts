import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gitFetch, gitPull, gitPush, planRemoteOp } from "@/api/commands";
import { invalidateAfterSync } from "@/api/queries";
import { findOwnerRepo, useRepositoryStore } from "@/stores/repository";
import { useSyncStore } from "@/stores/sync";
import { getErrorMessage, isMergeConflictError } from "@/lib/utils";
import type { RemoteOp, RepoInfo, RepoRemotePlan } from "@/types";

/** 확인 창에 올릴 저장소. 계정은 저장소마다 지정된 것만 쓴다. */
export interface RemoteRepoTarget {
  path: string;
  name: string;
  accountId: string | null;
  /** 이 앱에서 마지막으로 성공한 fetch 시각(유닉스 초). 모르면 null. */
  lastFetchedAt: number | null;
}

/** 확인 창의 저장소 한 줄. */
export interface RemotePlanRow {
  name: string;
  accountId: string | null;
  plan: RepoRemotePlan;
  /**
   * 창을 열 때 돌린 fetch가 실패했다. 계획은 마지막 fetch 기준이라, 원격에 새 커밋이
   * 있는데 받아 오지 못했으면 틀릴 수 있다.
   */
  fetchFailed: boolean;
  /**
   * 마지막으로 **성공한** fetch 시각(유닉스 초). 「마지막 fetch 기준」 표시에 쓴다.
   * 실패한 fetch 시각은 들어가지 않는다. 모르면 null.
   */
  lastFetchedAt: number | null;
}

export type RemoteRowResult =
  | { status: "running" }
  | { status: "ok" }
  | { status: "conflict" }
  | { status: "failed"; message: string };

/** 실제 git 호출. 테스트에서 바꿔 끼운다. 토큰은 넘기지 않고 계정 ID만 넘긴다. */
export interface RemoteDeps {
  fetch: (path: string, accountId: string) => Promise<void>;
  pull: (path: string, accountId: string) => Promise<void>;
  push: (path: string, accountId: string) => Promise<void>;
  plan: (paths: string[], op: RemoteOp) => Promise<RepoRemotePlan[]>;
}

const DEFAULT_DEPS: RemoteDeps = {
  fetch: (path, accountId) => gitFetch(path, accountId),
  // 방식은 사용자의 pull.rebase 설정을 따른다(계획의 명령과 같게).
  pull: (path, accountId) => gitPull(path, accountId),
  // force push는 이 창에서 제공하지 않는다.
  push: (path, accountId) => gitPush(path, accountId, false),
  plan: (paths, op) => planRemoteOp(paths, op),
};

/** 계획상 실행할 줄인가(처음부터 체크한다). 계정이 없거나 계획이 건너뛴 저장소는 아니다. */
export function isRunnable(row: RemotePlanRow): boolean {
  return !row.plan.skip && row.accountId !== null && row.plan.command !== null;
}

/**
 * 계획은 「할 일 없음」이지만 fetch가 실패해 틀렸을 수 있는 줄. 원격에 새 커밋이 있는데
 * 받아 오지 못했을 수 있으므로, 체크는 풀어 두되 사용자가 골라 실행할 수 있게 한다.
 */
export function isStaleUpToDate(row: RemotePlanRow): boolean {
  return (
    row.fetchFailed &&
    row.plan.skipReason === "upToDate" &&
    row.accountId !== null &&
    row.plan.command !== null
  );
}

/** 사용자가 체크해서 실행할 수 있는 줄. */
export function isSelectable(row: RemotePlanRow): boolean {
  return isRunnable(row) || isStaleUpToDate(row);
}

/**
 * 창을 열 때 한 번 부른다. Pull·Push면 저장소마다 기존 fetch를 먼저 돌리고(실패해도 계속),
 * 그 뒤 계획을 만든다. Fetch는 실행 자체가 fetch이므로 미리 돌리지 않는다.
 */
export async function prepareRemotePlan(
  targets: RemoteRepoTarget[],
  op: RemoteOp,
  deps: RemoteDeps = DEFAULT_DEPS,
): Promise<{ rows: RemotePlanRow[]; fetchedPaths: string[] }> {
  const fetchOutcome = await Promise.all(
    targets.map(async (target) => {
      if (op === "fetch" || target.accountId === null) return { path: target.path, ok: false };
      try {
        await deps.fetch(target.path, target.accountId);
        return { path: target.path, ok: true };
      } catch {
        return { path: target.path, ok: false };
      }
    }),
  );
  const plans = await deps.plan(
    targets.map((t) => t.path),
    op,
  );
  const planByPath = new Map(plans.map((plan) => [plan.path, plan]));
  const rows = targets.map((target, i) => {
    const plan = planByPath.get(target.path) ?? missingPlan(target.path);
    return {
      name: target.name,
      accountId: target.accountId,
      plan,
      // 계정이 없어 fetch를 못 한 저장소는 어차피 실행하지 않는다. 「마지막 fetch 기준」은
      // 실행할 수 있는데 최신이 아닐 수 있는 저장소에만 붙인다.
      fetchFailed: op !== "fetch" && target.accountId !== null && !fetchOutcome[i].ok,
      lastFetchedAt: latest(target.lastFetchedAt, plan.fetchedAt),
    };
  });
  return { rows, fetchedPaths: fetchOutcome.filter((o) => o.ok).map((o) => o.path) };
}

/**
 * 고른 저장소마다 기존 원격 명령을 **따로** 부른다. 하나가 실패해도 나머지는 계속한다.
 * 인증 실패 시 토큰 갱신·1회 재시도는 각 명령(`git_fetch`·`git_pull`·`git_push`)이 한다.
 * `pullFirst`에 든 저장소는 Push 전에 Pull을 먼저 돌린다.
 */
export async function runRemotePlan(
  rows: RemotePlanRow[],
  op: RemoteOp,
  pullFirst: ReadonlySet<string>,
  onResult: (path: string, result: RemoteRowResult) => void,
  deps: RemoteDeps = DEFAULT_DEPS,
): Promise<Record<string, RemoteRowResult>> {
  let results: Record<string, RemoteRowResult> = {};
  for (const row of rows) {
    const { path } = row.plan;
    if (!isSelectable(row) || row.accountId === null) continue;
    const accountId = row.accountId;
    onResult(path, { status: "running" });
    let result: RemoteRowResult;
    try {
      if (op === "push" && pullFirst.has(path)) await deps.pull(path, accountId);
      await deps[op](path, accountId);
      result = { status: "ok" };
    } catch (err) {
      result = isMergeConflictError(err)
        ? { status: "conflict" }
        : { status: "failed", message: getErrorMessage(err) };
    }
    results = { ...results, [path]: result };
    onResult(path, result);
  }
  return results;
}

/** 백엔드가 계획을 돌려주지 않은 저장소. 실행하지 않도록 건너뛴다. */
function missingPlan(path: string): RepoRemotePlan {
  return {
    path,
    branch: null,
    remote: null,
    command: null,
    commits: 0,
    behind: 0,
    needsPull: false,
    setsUpstream: false,
    skip: true,
    skipReason: "error",
    fetchedAt: null,
    error: null,
  };
}

function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * 워크스페이스 경로를 등록된 저장소 정보(이름·지정 계정)로 바꾼다.
 * `lastFetched`는 이 앱에서 성공한 fetch 시각(`useSyncStore.lastFetchedByRepo`)이다.
 * 워크트리 경로면 소유 저장소(`activeWorktrees`로 역추적)의 계정을 쓴다.
 */
export function targetsFor(
  paths: string[],
  repos: RepoInfo[],
  lastFetched: Readonly<Record<string, number>> = {},
  activeWorktrees: Readonly<Record<string, string>> = {},
): RemoteRepoTarget[] {
  return paths.map((path) => {
    const repo =
      repos.find((r) => r.path === path) ?? findOwnerRepo(repos, path, activeWorktrees);
    return {
      path,
      name: repo?.name ?? path.split("/").filter(Boolean).pop() ?? path,
      accountId: repo?.accountId ?? null,
      lastFetchedAt: lastFetched[path] ?? null,
    };
  });
}

export type MultiRepoRemotePhase = "preparing" | "ready" | "running" | "done" | "failed";

/**
 * 여러 저장소 Fetch·Pull·Push 확인 창의 상태. 열리면 바로 계획을 준비하고,
 * `run()`을 불러야만 실행한다(확인 창을 거치지 않는 실행 경로는 없다).
 */
export function useMultiRepoRemote(paths: string[], op: RemoteOp) {
  const repos = useRepositoryStore((s) => s.repos);
  const queryClient = useQueryClient();
  const markFetched = useSyncStore((s) => s.markFetched);
  const startSync = useSyncStore((s) => s.startSync);
  const finishSync = useSyncStore((s) => s.finishSync);

  const [phase, setPhase] = useState<MultiRepoRemotePhase>("preparing");
  const [rows, setRows] = useState<RemotePlanRow[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pullFirst, setPullFirst] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<Record<string, RemoteRowResult>>({});
  const [error, setError] = useState<string | null>(null);

  // 창을 연 순간의 저장소 목록으로 계획을 만든다. 열려 있는 동안 목록이 바뀌어도 다시 만들지 않는다.
  const [targets] = useState(() =>
    targetsFor(
      paths,
      repos,
      useSyncStore.getState().lastFetchedByRepo,
      useRepositoryStore.getState().activeWorktrees,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    prepareRemotePlan(targets, op)
      .then(({ rows: prepared, fetchedPaths }) => {
        if (cancelled) return;
        const now = Math.floor(Date.now() / 1000);
        fetchedPaths.forEach((path) => markFetched(path, now));
        setRows(prepared);
        setSelected(new Set(prepared.filter(isRunnable).map((r) => r.plan.path)));
        setPhase("ready");
        if (fetchedPaths.length > 0) void invalidateAfterSync(queryClient);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(getErrorMessage(err));
        setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [targets, op, markFetched, queryClient]);

  const toggle = useCallback((path: string) => {
    setSelected((prev) => toggled(prev, path));
  }, []);

  const togglePullFirst = useCallback((path: string) => {
    setPullFirst((prev) => toggled(prev, path));
  }, []);

  const chosen = useMemo(
    () => rows.filter((r) => isSelectable(r) && selected.has(r.plan.path)),
    [rows, selected],
  );

  const run = useCallback(async () => {
    if (phase !== "ready" || chosen.length === 0) return;
    setPhase("running");
    await runRemotePlan(chosen, op, pullFirst, (path, result) => {
      if (result.status === "running") startSync(path, op);
      else finishSync(path);
      if (result.status === "ok" && op !== "push") markFetched(path, Math.floor(Date.now() / 1000));
      setResults((prev) => ({ ...prev, [path]: result }));
    });
    await invalidateAfterSync(queryClient);
    setPhase("done");
  }, [phase, chosen, op, pullFirst, startSync, finishSync, markFetched, queryClient]);

  return { phase, rows, selected, pullFirst, results, error, chosen, toggle, togglePullFirst, run };
}

function toggled(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
