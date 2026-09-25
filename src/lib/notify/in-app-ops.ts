import type { GitCommandEntry } from "@/types";

/**
 * HEAD 를 옮길 수 없는 git 작업. 이 작업은 앱 안에서 돌아도 알림을 막지 않는다 — 자동 fetch 는
 * 몇 분마다 도는데, 그 사이에 에이전트가 만든 커밋까지 가리면 안 된다.
 */
const NON_HEAD_OPERATIONS: ReadonlySet<string> = new Set([
  "fetch",
  "push",
  "status",
  "log",
  "config",
  "rev-parse",
  "reflog",
  "stash",
]);

/** 앱이 실행한 git 작업 기록. 경로는 끝의 `/` 를 뗀 워크트리 경로다. */
export interface InAppOps {
  /** 진행 중인 작업 id → 경로. */
  active: Record<string, string>;
  /** 경로 → 그 경로에서 앱 작업이 마지막으로 끝난 시각(epoch ms). */
  lastEndedAt: Record<string, number>;
}

export const EMPTY_IN_APP_OPS: InAppOps = { active: {}, lastEndedAt: {} };

/** 시계 차이와 이벤트 도착 지연을 흡수하는 여유. */
export const IN_APP_GRACE_MS = 2_000;

export function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** HEAD 를 옮길 수 있는 작업이 시작됐다. 그 밖의 작업은 기록하지 않는다. */
export function opStarted(ops: InAppOps, entry: Pick<GitCommandEntry, "id" | "operation" | "repoPath">): InAppOps {
  if (NON_HEAD_OPERATIONS.has(entry.operation)) return ops;
  return { ...ops, active: { ...ops.active, [entry.id]: normalizePath(entry.repoPath) } };
}

/** 작업이 끝났다(성공·실패 모두). 기록하지 않은 작업이면 그대로 둔다. */
export function opEnded(ops: InAppOps, id: string, now: number): InAppOps {
  const path = ops.active[id];
  if (path === undefined) return ops;
  const { [id]: _done, ...active } = ops.active;
  return { active, lastEndedAt: { ...ops.lastEndedAt, [path]: now } };
}

/**
 * `path` 의 HEAD 이동이 앱 안 작업 탓인가. 지금 그 경로에서 작업이 돌고 있거나, 옮기기 전 HEAD 를
 * 마지막으로 본 때(`since`) 이후에 끝난 작업이 있으면 그렇다고 본다.
 */
export function isCausedInApp(ops: InAppOps, path: string, since: number): boolean {
  const key = normalizePath(path);
  if (Object.values(ops.active).includes(key)) return true;
  const ended = ops.lastEndedAt[key];
  return ended !== undefined && ended >= since - IN_APP_GRACE_MS;
}
