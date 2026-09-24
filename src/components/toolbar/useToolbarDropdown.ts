import { createContext, useContext, useState, useEffect, useCallback, type RefObject } from "react";

export type DropdownId = "branch" | "worktree" | "account" | null;

export function useToolbarDropdown() {
  const [activeDropdown, setActiveDropdown] = useState<DropdownId>(null);

  const toggle = useCallback((id: Exclude<DropdownId, null>) => {
    setActiveDropdown((prev) => (prev === id ? null : id));
  }, []);

  const close = useCallback(() => {
    setActiveDropdown(null);
  }, []);

  return { activeDropdown, toggle, close };
}

type ToolbarDropdownControls = ReturnType<typeof useToolbarDropdown>;

/**
 * 툴바 드롭다운 상태를 툴바 안의 버튼들이 같이 쓰게 한다. `ToolbarRoot`가 채운다.
 * 툴바 밖(테스트 등)에서는 아무것도 열지 않는 기본값을 쓴다.
 */
export const ToolbarDropdownContext = createContext<ToolbarDropdownControls>({
  activeDropdown: null,
  toggle: () => {},
  close: () => {},
});

export function useToolbarDropdownContext(): ToolbarDropdownControls {
  return useContext(ToolbarDropdownContext);
}

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose, enabled]);
}
