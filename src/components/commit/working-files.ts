import { groupFilesByDirectory } from "@/lib/group-files";
import type { MaximizedFileItem } from "@/components/layout/maximized-files";
import type { StatusEntry } from "@/types";

/** 작업 중인 변경의 행 하나를 가리키는 값. 일부만 스테이징한 파일은 두 행이라 쪽까지 넣는다. */
export function workingFileKey(path: string, staged: boolean): string {
  return `${staged ? "staged" : "unstaged"}:${path}`;
}

/** `workingFileKey`를 되돌린다. */
export function parseWorkingFileKey(key: string): { path: string; staged: boolean } {
  const at = key.indexOf(":");
  return { staged: key.slice(0, at) === "staged", path: key.slice(at + 1) };
}

/**
 * 스테이징 목록(`ChangesView`)과 같은 순서의 행: 스테이징됨 → 스테이징 안 됨, 각 쪽 안은 폴더별.
 * 크게 보는 diff 옆 파일 목록이 쓴다.
 */
export function workingFileItems(
  entries: readonly StatusEntry[],
  labels: { staged: string; unstaged: string },
): MaximizedFileItem[] {
  const side = (staged: boolean) =>
    groupFilesByDirectory(entries.filter((e) => e.staged === staged)).flatMap((g) =>
      g.files.map((e) => ({
        key: workingFileKey(e.path, staged),
        path: e.path,
        status: e.status,
        additions: e.insertions,
        deletions: e.deletions,
        group: staged ? labels.staged : labels.unstaged,
      })),
    );
  return [...side(true), ...side(false)];
}
