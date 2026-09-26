import type { AppSettings, WorkingBranch } from "@/types";

/** 「최근 N일」 규칙의 기본 N. Rust `DEFAULT_WORKING_BRANCH_RECENT_DAYS`와 같다. */
export const DEFAULT_WORKING_BRANCH_RECENT_DAYS = 7;
const MAX_WORKING_BRANCH_RECENT_DAYS = 365;

/** 설정의 N. 없거나 1~365의 정수가 아니면 기본값이다. */
export function workingBranchRecentDays(settings: Pick<AppSettings, "workingBranchRecentDays"> | null | undefined): number {
  const days = settings?.workingBranchRecentDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1) return DEFAULT_WORKING_BRANCH_RECENT_DAYS;
  return Math.min(days, MAX_WORKING_BRANCH_RECENT_DAYS);
}

/** 브랜치가 사이드바 줄을 갖는 이유. 하나라도 있으면 줄을 갖는다. */
export type WorkingBranchReason = "worktree" | "unpushed" | "openPr" | "recent";

export interface WorkingBranchContext {
  /** 열린 PR의 head 브랜치 이름(이 저장소의 PR 목록에서). */
  openPrHeads: ReadonlySet<string>;
  /** `workingBranchRecentDays()`의 N. */
  recentDays: number;
  /** 지금 시각(유닉스 밀리초). */
  now: number;
}

/**
 * 「작업 중인 브랜치」 규칙. 기본 브랜치는 줄을 따로 갖지 않는다(저장소 줄이 대신한다). 그 밖의 로컬 브랜치는
 * 워크트리에 체크아웃됨 · 원격 어디에도 없는 커밋이 있음 · 열린 PR이 있음 · 최근 N일 안에 커밋했고 기본 브랜치에
 * 병합되지 않음 중 하나라도 맞으면 줄을 갖는다. 맞는 이유를 이 순서로 돌려준다.
 */
export function workingBranchReasons(branch: WorkingBranch, ctx: WorkingBranchContext): WorkingBranchReason[] {
  if (branch.isDefault) return [];
  const reasons: WorkingBranchReason[] = [];
  if (branch.worktreePath !== null) reasons.push("worktree");
  if (branch.unpushed > 0) reasons.push("unpushed");
  if (ctx.openPrHeads.has(branch.name)) reasons.push("openPr");
  const since = ctx.now / 1000 - ctx.recentDays * 24 * 60 * 60;
  if (branch.lastCommitTime >= since && !branch.mergedIntoDefault) reasons.push("recent");
  return reasons;
}
