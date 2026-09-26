/**
 * 탭 머리의 개수 배지. 0이거나 아직 모르면(`null`) 배지를 달지 않는다(`undefined`).
 * `Tab`의 `count`에 그대로 넘긴다.
 */
export function badgeCount(count: number | null | undefined): number | undefined {
  return typeof count === "number" && count > 0 ? count : undefined;
}

/** Actions 탭 배지: 아직 끝나지 않은(진행 중·대기 중) 실행 수. */
export function activeRunCount(runs: readonly { status: string }[]): number {
  return runs.filter((r) => r.status === "in_progress" || r.status === "queued").length;
}
