import type {
  AutoSyncIntervalMinutes,
  AutoSyncMode,
  AutoSyncSetting,
  AutoSyncSnapshot,
  RepoInfo,
} from "@/types";

/** 설정하지 않은 저장소의 기본값. 예전 전역 백그라운드 fetch(3분 주기)와 같다. */
export const DEFAULT_AUTO_SYNC: AutoSyncSetting = { mode: "fetch", intervalMinutes: 3 };

export const AUTO_SYNC_INTERVALS: readonly AutoSyncIntervalMinutes[] = [1, 3, 5, 10, 30];

export const AUTO_SYNC_MODES: readonly AutoSyncMode[] = ["off", "fetch", "pull"];

/**
 * 작업 트리에서 파일이 바뀐 뒤 이만큼은 자동으로 받지 않는다.
 * 에이전트가 파일을 쓰는 중이면 상태가 잠깐 깨끗해 보여도 곧 다시 바뀐다.
 */
export const ACTIVITY_QUIET_MS = 2 * 60 * 1000;

/** 저장소 설정을 찾는다. 없으면 기본값. */
export function resolveAutoSync(
  settings: Record<string, AutoSyncSetting>,
  repoPath: string,
): AutoSyncSetting {
  return settings[repoPath] ?? DEFAULT_AUTO_SYNC;
}

export type AutoSyncDecision = "skip" | "fetch" | "fetch+ff";

export interface AutoSyncDecisionInput extends AutoSyncSnapshot {
  mode: AutoSyncMode;
  /** 이 작업 트리에서 마지막으로 파일 변경을 본 시각(ms). 감시하지 않는 저장소면 null. */
  lastActivityAt: number | null;
  now: number;
}

/**
 * 자동 최신화에서 무엇을 할지 정한다.
 *
 * - off → 아무것도 하지 않는다
 * - fetch → 확인만 한다
 * - pull → 아래 조건이 모두 맞을 때만 fast-forward까지 한다. 하나라도 어긋나면
 *   조용히 확인(fetch)만 한 것으로 끝낸다.
 *   추적 브랜치가 있고, detached HEAD가 아니고, 뒤처지기만 했고(ahead 0, behind > 0),
 *   작업 트리가 깨끗하고, merge·rebase 등이 진행 중이 아니고,
 *   최근 2분 안에 파일 변경이 없었다.
 *
 * 백엔드(`auto_fast_forward`)도 git 상태 조건을 한 번 더 확인한다.
 */
export function decideAutoSync(input: AutoSyncDecisionInput): AutoSyncDecision {
  if (input.mode === "off") return "skip";
  if (input.mode === "fetch") return "fetch";

  const recentlyActive =
    input.lastActivityAt !== null && input.now - input.lastActivityAt < ACTIVITY_QUIET_MS;
  const canFastForward =
    input.hasUpstream &&
    !input.detached &&
    input.ahead === 0 &&
    input.behind > 0 &&
    input.isClean &&
    !input.operationInProgress &&
    !recentlyActive;
  return canFastForward ? "fetch+ff" : "fetch";
}

/** 다음 실행 시각(ms). 한 번도 돌지 않았으면 지금 바로. 끈 저장소는 null. */
export function nextAutoSyncAt(
  setting: AutoSyncSetting,
  lastRunAt: number | null,
): number | null {
  if (setting.mode === "off") return null;
  if (lastRunAt === null) return 0;
  return lastRunAt + setting.intervalMinutes * 60 * 1000;
}

export function isAutoSyncDue(
  setting: AutoSyncSetting,
  lastRunAt: number | null,
  now: number,
): boolean {
  const next = nextAutoSyncAt(setting, lastRunAt);
  return next !== null && next <= now;
}

/** 자동 최신화할 수 있는 저장소: 계정과 원격이 있어야 한다. */
export function canAutoSync(repo: RepoInfo): boolean {
  return repo.accountId !== null && repo.remotes.length > 0;
}

/**
 * 지금 돌 차례인 저장소를 오래 기다린 순서로 돌려준다.
 * 호출하는 쪽은 이 순서대로 하나씩 실행해 네트워크 요청이 몰리지 않게 한다.
 */
export function pickDueRepos(
  repos: RepoInfo[],
  settings: Record<string, AutoSyncSetting>,
  lastRunAt: Record<string, number>,
  now: number,
): RepoInfo[] {
  return repos
    .filter(canAutoSync)
    .map((repo) => ({
      repo,
      next: nextAutoSyncAt(resolveAutoSync(settings, repo.path), lastRunAt[repo.path] ?? null),
    }))
    .filter((entry): entry is { repo: RepoInfo; next: number } =>
      entry.next !== null && entry.next <= now,
    )
    .sort((a, b) => a.next - b.next)
    .map((entry) => entry.repo);
}
