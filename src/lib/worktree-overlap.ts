/**
 * 같은 저장소의 워크트리 여럿이 같은 파일을 고치는지 가려내는 순수 함수(D5 ⧉ 「같은 파일」).
 *
 * - 1차 판정은 파일 경로만 본다. 같은 저장소의 워크트리는 루트 기준 경로가 같으므로 문자열로 비교한다.
 * - 줄 범위는 이미 불러온 diff로만 계산한다. 이 모듈은 diff를 읽지 않는다.
 */
import type { DiffOutput } from "@/types";

/** 같은 저장소의 다른 워크트리와 그 워크트리의 커밋하지 않은 파일. */
export interface SiblingWorktreeFiles {
  path: string;
  branch: string | null;
  /** 저장소 루트 기준 경로. 이름을 바꾼 파일은 옛 경로도 넣는다. */
  files: readonly string[];
}

/** 파일 하나를 함께 고치는 다른 워크트리. */
export interface OverlapWorktree {
  path: string;
  branch: string | null;
}

/** 줄 범위(양 끝 포함, 1부터). */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * 이 워크트리의 파일 중 다른 워크트리도 고치고 있는 파일 → 그 워크트리들(입력 순서).
 * 겹치지 않는 파일은 결과에 없다.
 */
export function findSameFileWorktrees(
  files: readonly string[],
  siblings: readonly SiblingWorktreeFiles[],
): ReadonlyMap<string, readonly OverlapWorktree[]> {
  const out = new Map<string, OverlapWorktree[]>();
  if (files.length === 0 || siblings.length === 0) return out;
  const mine = new Set(files);
  for (const sibling of siblings) {
    const seen = new Set<string>();
    for (const file of sibling.files) {
      if (!mine.has(file) || seen.has(file)) continue;
      seen.add(file);
      out.set(file, [...(out.get(file) ?? []), { path: sibling.path, branch: sibling.branch }]);
    }
  }
  return out;
}

/** 겹치거나 맞닿은 범위를 합치고 시작 줄 순으로 정렬한다. */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  const sorted = [...ranges]
    .filter((r) => r.start <= r.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.reduce<LineRange[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r.start <= last.end + 1) {
      return [...acc.slice(0, -1), { start: last.start, end: Math.max(last.end, r.end) }];
    }
    return [...acc, { start: r.start, end: r.end }];
  }, []);
}

/**
 * diff의 변경 구간(새 쪽 줄 번호). hunk 머리(`@@ -61,9 +61,15 @@`)의 새 쪽 범위를 그대로
 * 한 구간으로 친다(시안 D5의 「61–69행」이 hunk 머리에서 온다). 새 쪽 줄이 없는 hunk(지우기만
 * 한 자리)는 그 자리 한 줄로 친다. 바이너리 diff는 빈 목록.
 */
export function changedLineRanges(diff: Pick<DiffOutput, "hunks" | "binary">): LineRange[] {
  if (diff.binary) return [];
  return mergeRanges(
    diff.hunks.map((hunk) => {
      const start = Math.max(1, hunk.newStart);
      return { start, end: start + Math.max(0, hunk.newLines - 1) };
    }),
  );
}

/** 두 범위 목록이 함께 덮는 줄(합친 범위). 없으면 빈 목록. */
export function intersectRanges(a: readonly LineRange[], b: readonly LineRange[]): LineRange[] {
  const out: LineRange[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (start <= end) out.push({ start, end });
    }
  }
  return mergeRanges(out);
}

/** 「61–69, 112–130」처럼 쓴다. 한 줄이면 번호 하나. 너무 많으면 앞의 `limit`개와 「…」. */
export function formatRanges(ranges: readonly LineRange[], limit = 3): string {
  const parts = ranges
    .slice(0, limit)
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`));
  return ranges.length > limit ? `${parts.join(", ")}, …` : parts.join(", ");
}

/** 두 워크트리의 같은 파일 diff를 견준 결과. 어느 한쪽 diff가 아직 없으면 null. */
export interface LineOverlap {
  mine: LineRange[];
  theirs: LineRange[];
  /** 두 쪽이 함께 고친 줄. 비어 있으면 서로 다른 줄을 고치는 중이다. */
  shared: LineRange[];
}

/**
 * 이미 불러온 두 diff로 줄 범위를 견준다. 두 diff는 각자의 HEAD·인덱스 기준이라
 * 줄 번호는 근사값이다(같은 기반에서 갈라진 워크트리라면 대개 맞다).
 */
export function compareLineRanges(
  mine: Pick<DiffOutput, "hunks" | "binary"> | null | undefined,
  theirs: Pick<DiffOutput, "hunks" | "binary"> | null | undefined,
): LineOverlap | null {
  if (!mine || !theirs || mine.binary || theirs.binary) return null;
  const a = changedLineRanges(mine);
  const b = changedLineRanges(theirs);
  return { mine: a, theirs: b, shared: intersectRanges(a, b) };
}
