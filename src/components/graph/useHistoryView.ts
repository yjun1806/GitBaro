import { useCallback, useEffect } from "react";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useSelectionStore } from "@/stores/selection";
import { useFollowStore } from "@/stores/follow";
import {
  historyTargetOf,
  sameViewTarget,
  useHistoryViewStore,
  viewTargetFor,
  type ViewTarget,
} from "@/stores/history-view";
import { useBranches } from "@/api/queries";
import { useBranchRangeStore } from "@/components/branch/branch-range";
import type { BranchInfo, HistoryTarget } from "@/types";

export interface HistoryView {
  /** 체크아웃하지 않고 보는 대상. 현재 체크아웃을 보면 null. */
  target: ViewTarget | null;
  /** 커밋 목록 조회에 넘길 시작점. */
  historyTarget: HistoryTarget;
  /** 지금 체크아웃한 로컬 브랜치. 분리된 HEAD면 null. */
  currentBranch: string | null;
}

/** 브랜치 목록에서 지금 체크아웃한 로컬 브랜치 이름. */
export function checkedOutBranch(branches: readonly BranchInfo[] | undefined): string | null {
  return branches?.find((b) => b.isHead && !b.isRemote)?.name ?? null;
}

/**
 * 보기 대상이 이제 의미가 없는지. 체크아웃한 브랜치를 보는 것은 「현재 체크아웃」과 같고,
 * 지워진 브랜치는 더 볼 수 없다. 브랜치 목록을 아직 모르면 판단하지 않는다.
 */
export function isStaleView(target: ViewTarget | null, branches: readonly BranchInfo[] | undefined): boolean {
  if (!target || target.kind !== "ref" || !branches) return false;
  if (!target.isRemote && target.name === checkedOutBranch(branches)) return true;
  return !branches.some((b) => b.name === target.name && b.isRemote === target.isRemote);
}

/**
 * 지금 연 저장소(워크트리)의 「보는 브랜치」. 체크아웃된 브랜치를 보게 되거나(그 브랜치로
 * 체크아웃한 뒤) 보던 브랜치가 사라지면 현재 체크아웃으로 돌아간다.
 */
export function useHistoryView(): HistoryView {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const stored = useHistoryViewStore((s) => viewTargetFor(s, activeRepoPath));
  const reset = useHistoryViewStore((s) => s.reset);
  const { data: branches } = useBranches(activeRepoPath);
  const stale = isStaleView(stored, branches);
  useEffect(() => {
    if (stale) reset();
  }, [stale, reset]);
  const target = stale ? null : stored;
  return { target, historyTarget: historyTargetOf(target), currentBranch: checkedOutBranch(branches) };
}

/**
 * 보기를 바꾼다(`null`이면 현재 체크아웃으로). 보기와 섞이면 헷갈리는 화면 상태를 함께 정리한다:
 * 브랜치 범위·비교, 커밋 선택, 따라가기. 커밋 안 한 변경 칸을 보고 있었다면 커밋 칸으로 옮긴다
 * (커밋 안 한 변경은 체크아웃한 작업 트리의 것이다).
 */
export function useSetHistoryView(): (target: ViewTarget | null) => void {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  return useCallback(
    (target: ViewTarget | null) => {
      if (!activeRepoPath) return;
      const store = useHistoryViewStore.getState();
      const before = viewTargetFor(store, activeRepoPath);
      store.view(activeRepoPath, target);
      if (sameViewTarget(before, target)) return;
      useBranchRangeStore.getState().clear();
      useSelectionStore.getState().clearCommitSelection();
      const ui = useUIStore.getState();
      if (ui.compareBranch !== null) ui.setCompareBranch(null);
      if (target !== null) {
        useFollowStore.getState().stop();
        if (ui.activeTab === "changes") ui.setActiveTab("history");
      }
    },
    [activeRepoPath],
  );
}
