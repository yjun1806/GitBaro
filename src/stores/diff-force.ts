import { create } from "zustand";

/**
 * 「너무 커서 안 읽은」 diff 중 사용자가 「그래도 보기」를 누른 것들(이번 실행 동안만).
 * 키는 `workingDiffKey`·`commitDiffKey`로 만든다. 쿼리 훅이 이 집합을 읽어 `force`를 쿼리 키와
 * 요청에 넣는다.
 */
interface DiffForceState {
  forced: ReadonlySet<string>;
  force: (key: string) => void;
}

export const useDiffForceStore = create<DiffForceState>((set) => ({
  forced: new Set<string>(),
  force: (key) => set((s) => ({ forced: new Set(s.forced).add(key) })),
}));

export function workingDiffKey(repoPath: string, filePath: string, staged: boolean): string {
  return ["working", repoPath, filePath, staged].join("\0");
}

export function commitDiffKey(repoPath: string, oid: string, filePath: string): string {
  return ["commit", repoPath, oid, filePath].join("\0");
}
