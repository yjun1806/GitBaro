import { useEffect } from "react";
import { useUIStore } from "@/stores/ui";
import { isDialogOpen } from "@/lib/use-dialog-a11y";

/** ⌘\ — 사이드바 숨기기·보이기. 한국어 자판에서는 같은 키가 `₩`로 오므로 키 자리(`code`)도 본다. */
export function isSidebarToggleShortcut(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "key" | "code">): boolean {
  return e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "\\" || e.code === "Backslash");
}

/** 창 어디서든 ⌘\로 사이드바를 숨기거나 다시 보인다. 모달이 떠 있으면 그 뒤 화면은 건드리지 않는다. */
export function useSidebarToggleShortcut(): void {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSidebarToggleShortcut(e) || isDialogOpen()) return;
      e.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);
}
