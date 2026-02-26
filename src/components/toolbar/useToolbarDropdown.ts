import { useState, useEffect, useCallback, type RefObject } from "react";

export type DropdownId = "branch" | "sync" | "account" | null;

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
