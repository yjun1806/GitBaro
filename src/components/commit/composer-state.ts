import type { GitOperation } from "@/types";

/**
 * 커밋하지 않은 변경이 하나도 없으면 커밋 입력을 접고 「변경 없음」만 보여 준다. 다만 병합·되돌리기가
 * 멈춰 있으면(merge 상태) 파일이 없어도 커밋으로 마무리할 수 있어야 하므로 접지 않는다.
 * 변경 수를 아직 모르면(null) 접지 않는다(불러오는 동안 입력이 사라졌다 나타나지 않게).
 */
export function isComposerCollapsed(entryCount: number | null, merging: boolean): boolean {
  return entryCount === 0 && !merging;
}

/**
 * 커밋할 수 있는지. 요약이 있고, 스테이지한 파일이 있어야 한다. 다만 병합(merge)이 멈춰 있으면
 * 스테이지한 파일이 없어도 병합 커밋으로 마무리할 수 있다(충돌을 모두 해결했고 바뀐 파일이 없을 때).
 * 되돌리기·cherry-pick·rebase는 바뀐 것이 없으면 git이 빈 커밋을 거부하므로 여기에 넣지 않는다.
 */
export function canCommit(summary: string, stagedCount: number, operation: GitOperation | null | undefined): boolean {
  return summary.trim().length > 0 && (stagedCount > 0 || operation === "merge");
}
