/** 워크트리 하나에서 짧은 사이에 쌓인 새 커밋을 한 알림으로 묶는 시간. */
export const COMMIT_BURST_WINDOW_MS = 10_000;

/** 앞으로 나아간 HEAD 이동 하나(백엔드가 자손임을 확인한 것). */
export interface CommitAdvance {
  repoPath: string;
  worktreePath: string;
  branch: string | null;
  /** 새 HEAD. */
  to: string;
  count: number;
  /** 새 커밋 중 가장 오래된 것의 제목. */
  firstSubject: string | null;
}

/** 아직 알리지 않은 묶음. */
export interface CommitBurst {
  repoPath: string;
  worktreePath: string;
  branch: string | null;
  count: number;
  firstSubject: string | null;
  /** 묶음에 든 마지막 HEAD. 알림을 누르면 이 커밋을 고른다. */
  latestOid: string;
  /** 묶음을 시작한 시각. 이로부터 `COMMIT_BURST_WINDOW_MS` 뒤에 알린다. */
  startedAt: number;
}

/** 워크트리 경로 → 알리기를 기다리는 묶음. */
export type CommitBursts = Record<string, CommitBurst>;

/** 새 커밋을 그 워크트리의 묶음에 더한다. 묶음이 없으면 새로 연다. */
export function addToBurst(bursts: CommitBursts, advance: CommitAdvance, now: number): CommitBursts {
  const current = bursts[advance.worktreePath];
  const burst: CommitBurst = current
    ? {
        ...current,
        branch: advance.branch,
        count: current.count + advance.count,
        firstSubject: current.firstSubject ?? advance.firstSubject,
        latestOid: advance.to,
      }
    : {
        repoPath: advance.repoPath,
        worktreePath: advance.worktreePath,
        branch: advance.branch,
        count: advance.count,
        firstSubject: advance.firstSubject,
        latestOid: advance.to,
        startedAt: now,
      };
  return { ...bursts, [advance.worktreePath]: burst };
}

/** 묶는 시간이 지난 묶음(알릴 것)과 아직 기다리는 묶음으로 나눈다. */
export function takeDueBursts(
  bursts: CommitBursts,
  now: number,
  windowMs = COMMIT_BURST_WINDOW_MS,
): { due: CommitBurst[]; rest: CommitBursts } {
  const due: CommitBurst[] = [];
  const rest: CommitBursts = {};
  for (const [path, burst] of Object.entries(bursts)) {
    if (now - burst.startedAt >= windowMs) due.push(burst);
    else rest[path] = burst;
  }
  return { due, rest };
}
