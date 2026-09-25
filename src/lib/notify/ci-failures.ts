import type { WorkflowRun } from "@/types";

/** 알림 대상이 되는 실패 결과. */
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(["failure", "timed_out"]);

export function isFailedRun(run: Pick<WorkflowRun, "status" | "conclusion">): boolean {
  return run.status === "completed" && run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion);
}

/** 이미 본 실패 실행. 메모리에만 둔다(앱을 다시 켜면 그때 있던 실패는 조용히 다시 기록한다). */
export interface CiSeen {
  /** 한 번이라도 실행 목록을 읽은 저장소. 처음 읽은 목록의 실패는 알리지 않는다. */
  initializedRepos: ReadonlySet<string>;
  /** 이미 본(알렸거나 조용히 기록한) 실패 실행 id. */
  seenRunIds: ReadonlySet<number>;
}

export const EMPTY_CI_SEEN: CiSeen = { initializedRepos: new Set(), seenRunIds: new Set() };

/**
 * 저장소 하나의 새 실행 목록에서 알릴 실패를 고른다.
 *
 * - 처음 읽는 저장소는 지금 있는 실패를 모두 본 것으로 적고 알리지 않는다(앱 시작 때 옛 실패가 쏟아지지 않게).
 * - 실행 id 마다 한 번만 알린다. 다시 돌린(re-run) 실행도 id 가 같아 두 번 알리지 않는다.
 * - 지금 체크아웃한 브랜치(`branches`)의 실패만 알린다. 다른 브랜치의 실패도 본 것으로 적어,
 *   나중에 그 브랜치로 옮겼을 때 옛 실패를 알리지 않는다.
 */
export function pickNewFailures(
  seen: CiSeen,
  repoPath: string,
  runs: readonly WorkflowRun[],
  branches: ReadonlySet<string>,
): { notify: WorkflowRun[]; seen: CiSeen } {
  const firstLook = !seen.initializedRepos.has(repoPath);
  const seenRunIds = new Set(seen.seenRunIds);
  const notify: WorkflowRun[] = [];
  for (const run of runs) {
    if (!isFailedRun(run) || seenRunIds.has(run.id)) continue;
    seenRunIds.add(run.id);
    if (!firstLook && branches.has(run.headBranch)) notify.push(run);
  }
  const initializedRepos = firstLook ? new Set([...seen.initializedRepos, repoPath]) : seen.initializedRepos;
  return { notify, seen: { initializedRepos, seenRunIds } };
}
