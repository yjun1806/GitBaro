import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui";
import { usePaneStore } from "./pane-state";

/** 글을 쓰는 곳(입력 칸·편집 가능한 요소)인가. 그곳의 Escape는 그 칸이 먼저 쓴다. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
}

/** 메뉴·창이 떠 있는가. 그때의 Escape는 그것을 닫는 데 쓴다. */
function isOverlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"], [role="alertdialog"]') !== null;
}

/**
 * Escape로 칸을 한 단계씩 되돌린다(5.4): 크게 보기 → 2단계(diff 닫기) → 1단계. 1단계에서 옆 칸까지 닫지는
 * 않는다 — 고른 커밋을 Esc 한 번에 잃지 않게. 입력 칸에 포커스가 있거나 메뉴·창이 떠 있으면 건드리지
 * 않는다.
 */
export function useDiffMaximizeEscape(): void {
  const setMaximized = useUIStore((s) => s.setDiffMaximized);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isEditableTarget(e.target) || isOverlayOpen()) return;
      if (useUIStore.getState().isDiffMaximized) {
        setMaximized(false);
        return;
      }
      const closers = usePaneStore.getState().diffClosers;
      closers[closers.length - 1]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setMaximized]);
}

/** `key`가 바뀌면(다른 저장소·워크스페이스로 옮기면) diff 크게 보기를 끝낸다. */
export function useDiffMaximizeReset(key: string): void {
  const setMaximized = useUIStore((s) => s.setDiffMaximized);
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current !== key) setMaximized(false);
    prev.current = key;
  }, [key, setMaximized]);
}
