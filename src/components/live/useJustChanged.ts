import { useEffect, useRef, useState } from "react";
import type { WipFile } from "@/types";

/** 방금 바뀐 파일들과 그 때(epoch ms). `at`을 `key`로 써서 같은 파일이 또 바뀌면 다시 비춘다. */
export interface JustChanged {
  paths: ReadonlySet<string>;
  at: number;
}

/**
 * 직전 목록 `prev`(경로 → 수정 시각, 초)에 견줘 `next`에서 **방금 바뀐** 파일의 경로. 수정 시각이
 * 새로워진 파일과 처음 나타난 파일이다. 수정 시각을 모르는 파일(삭제됨)은 세지 않는다.
 */
export function justChangedPaths(prev: ReadonlyMap<string, number | null>, next: readonly WipFile[]): string[] {
  return next
    .filter((f) => {
      if (f.modifiedAt === null) return false;
      const before = prev.get(f.path);
      return before === undefined || before === null || f.modifiedAt > before;
    })
    .map((f) => f.path);
}

/**
 * 따라가기 목록에서 방금 바뀐 파일(다시 읽은 목록에서 수정 시각이 새로워졌거나 새로 나타난 파일).
 * 처음 받은 목록은 모두 「이미 있던 것」이라 비추지 않는다. 결과는 다음 변경까지 그대로다 —
 * 1초마다 다시 그리는 시각 표시가 비추기를 끊지 않게 상태로 둔다.
 */
export function useJustChanged(files: readonly WipFile[] | undefined): JustChanged | null {
  const prev = useRef<ReadonlyMap<string, number | null> | null>(null);
  const [changed, setChanged] = useState<JustChanged | null>(null);

  useEffect(() => {
    if (!files) return;
    const before = prev.current;
    prev.current = new Map(files.map((f) => [f.path, f.modifiedAt]));
    if (before === null) return;
    const paths = justChangedPaths(before, files);
    if (paths.length > 0) setChanged({ paths: new Set(paths), at: Date.now() });
  }, [files]);

  return changed;
}
