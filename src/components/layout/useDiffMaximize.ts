import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui";

/** 글을 쓰는 곳(입력 칸·편집 가능한 요소)인가. 그곳의 Escape는 그 칸이 먼저 쓴다. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
}

/** diff를 크게 보는 중이면 Escape로 되돌린다. 입력 칸에 포커스가 있을 때는 건드리지 않는다. */
export function useDiffMaximizeEscape(): void {
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const setMaximized = useUIStore((s) => s.setDiffMaximized);
  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isEditableTarget(e.target)) return;
      setMaximized(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximized, setMaximized]);
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
