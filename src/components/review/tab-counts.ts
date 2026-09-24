import type { BranchChanges } from "@/types";

/**
 * 탭 머리의 개수 배지. 0이거나 아직 모르면(`null`) 배지를 달지 않는다(`undefined`).
 * `Tab`의 `count`에 그대로 넘긴다.
 */
export function badgeCount(count: number | null | undefined): number | undefined {
  return typeof count === "number" && count > 0 ? count : undefined;
}

/**
 * 워크트리 하나의 「파일별 변경」 파일 수: main에서 갈라진 뒤 커밋한 파일과 커밋하지 않은 파일의 합집합.
 * - 커밋한 파일은 main 대비 변경(`changes.committed`)에서, 커밋하지 않은 파일은 파일 감시로 바로
 *   갱신되는 `status`에서 센다. 같은 파일이 두 곳에 있으면 한 번만 센다(스테이징·작업 트리 두 행도).
 * - 둘 다 아직 모르면 null.
 */
export function changedFileCount(
  changes: Pick<BranchChanges, "committed"> | undefined,
  uncommitted: readonly { path: string }[] | undefined,
): number | null {
  if (changes === undefined && uncommitted === undefined) return null;
  const paths = new Set<string>();
  for (const f of changes?.committed ?? []) paths.add(f.path);
  for (const e of uncommitted ?? []) paths.add(e.path);
  return paths.size;
}

/** 여러 워크트리의 파일 수 합. 하나도 모르면 null. */
export function sumCounts(counts: readonly (number | null)[]): number | null {
  const known = counts.filter((c): c is number => c !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/** Actions 탭 배지: 아직 끝나지 않은(진행 중·대기 중) 실행 수. */
export function activeRunCount(runs: readonly { status: string }[]): number {
  return runs.filter((r) => r.status === "in_progress" || r.status === "queued").length;
}
