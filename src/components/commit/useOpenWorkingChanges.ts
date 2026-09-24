import { useCallback } from "react";
import { useUIStore } from "@/stores/ui";
import { useFollowStore } from "@/stores/follow";
import { useSelectionStore } from "@/stores/selection";
import { useFilesViewStore } from "@/components/review/files-view";

/** 포커스 요청이 이보다 오래됐으면 무시한다(나중에 다른 이유로 파일 목록이 마운트될 때 튀지 않게). */
export const WORKING_FOCUS_WINDOW_MS = 1500;

/** 포커스 요청이 아직 유효한가. */
export function isFreshWorkingFocus(at: number | null, now: number): boolean {
  return at !== null && now - at >= 0 && now - at < WORKING_FOCUS_WINDOW_MS;
}

/**
 * 「작업 중인 변경」: 지금 연 워크트리의 스테이징 목록 + 커밋 입력을 왼쪽 아래에 열고 파일 목록에
 * 포커스를 옮긴다. 커밋은 하지 않는다(커밋은 입력칸의 「<브랜치>에 커밋」 버튼만 한다).
 * 따라가기·커밋 선택·diff 크게 보기·「main 대비 변경」 탭을 끝낸다(목록이 보여야 한다).
 */
export function useOpenWorkingChanges(): () => void {
  const stopFollow = useFollowStore((s) => s.stop);
  return useCallback(() => {
    stopFollow();
    useSelectionStore.getState().clearCommitSelection();
    const ui = useUIStore.getState();
    ui.setDiffMaximized(false);
    ui.setRepoListOpen(false);
    useFilesViewStore.getState().setRepoTabOpen(false);
    ui.setActiveTab("changes");
    ui.setWorkingFocusAt(Date.now());
  }, [stopFollow]);
}
