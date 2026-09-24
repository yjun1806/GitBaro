import { create } from "zustand";
import type { HistoryTarget } from "@/types";
import { useRepositoryStore } from "./repository";

/**
 * 체크아웃하지 않고 보는 대상. 「현재 체크아웃」을 보는 상태는 `null`로 둔다.
 * - `ref`: 로컬 또는 원격 브랜치 하나(`isRemote`면 `origin/x` 같은 원격 이름)
 * - `all`: 모든 브랜치
 */
export type ViewTarget = { kind: "ref"; name: string; isRemote: boolean } | { kind: "all" };

interface HistoryViewState {
  /** 보기를 시작한 저장소(워크트리) 경로. 다른 경로에서는 보기가 없는 것으로 친다. */
  repoPath: string | null;
  target: ViewTarget | null;
  /** `repoPath`에서 `target`을 본다. `null`이면 현재 체크아웃으로 돌아간다. */
  view: (repoPath: string, target: ViewTarget | null) => void;
  /** 현재 체크아웃으로 돌아간다. */
  reset: () => void;
}

/**
 * 「보는 브랜치」 상태. 저장소·워크트리마다 따로이고, 저장소를 바꾸면 처음(현재 체크아웃)으로
 * 돌아간다. 앱을 다시 켜면 남지 않는다(저장하지 않는다).
 */
export const useHistoryViewStore = create<HistoryViewState>()((set) => ({
  repoPath: null,
  target: null,
  view: (repoPath, target) => set(target ? { repoPath, target } : { repoPath: null, target: null }),
  reset: () => set({ repoPath: null, target: null }),
}));

/** `repoPath`에서 보는 대상. 다른 저장소에서 시작한 보기거나 보기가 없으면 null. */
export function viewTargetFor(
  state: Pick<HistoryViewState, "repoPath" | "target">,
  repoPath: string | null,
): ViewTarget | null {
  return repoPath !== null && state.repoPath === repoPath ? state.target : null;
}

/** 보는 대상 → 백엔드 `get_commit_history`의 시작점. 보기가 없으면 HEAD. */
export function historyTargetOf(target: ViewTarget | null): HistoryTarget {
  if (!target) return { kind: "head" };
  return target.kind === "all" ? { kind: "all" } : { kind: "ref", name: target.name };
}

/** 두 보기 대상이 같은지. */
export function sameViewTarget(a: ViewTarget | null, b: ViewTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "all" || b.kind === "all") return a.kind === b.kind;
  return a.name === b.name;
}

// 저장소(워크트리 포함)를 바꾸면 보기를 끝낸다. 보던 브랜치가 새 저장소에는 없을 수 있다.
let prevRepoPath = useRepositoryStore.getState().activeRepoPath;
useRepositoryStore.subscribe((state) => {
  if (state.activeRepoPath !== prevRepoPath) {
    prevRepoPath = state.activeRepoPath;
    useHistoryViewStore.getState().reset();
  }
});
