import { useCallback } from "react";
import { useUIStore } from "@/stores/ui";
import { useFollowStore } from "@/stores/follow";
import { useFilesViewStore } from "@/components/review/files-view";

/** 포커스 요청이 이보다 오래됐으면 무시한다(나중에 다른 이유로 커밋 입력이 마운트될 때 튀지 않게). */
export const COMMIT_FOCUS_WINDOW_MS = 1500;

/** 포커스 요청이 아직 유효한가. */
export function isFreshCommitFocus(at: number | null, now: number): boolean {
  return at !== null && now - at >= 0 && now - at < COMMIT_FOCUS_WINDOW_MS;
}

/**
 * 「커밋하기」: 지금 연 워크트리의 커밋하지 않은 변경을 고르고(따라가기를 끝내고) 왼쪽 아래의
 * 스테이징 목록 + 커밋 입력을 연 뒤 요약 칸에 포커스를 옮긴다. diff 크게 보기도 끝낸다(목록이 보여야 한다).
 */
export function useStartCommit(): () => void {
  const stopFollow = useFollowStore((s) => s.stop);
  return useCallback(() => {
    stopFollow();
    const ui = useUIStore.getState();
    ui.setDiffMaximized(false);
    ui.setRepoListOpen(false);
    useFilesViewStore.getState().setRepoTabOpen(false);
    ui.setActiveTab("changes");
    ui.setCommitFocusAt(Date.now());
  }, [stopFollow]);
}
