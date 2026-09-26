import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "./layers";
import { useMenuKeyboard } from "@/hooks/useMenuKeyboard";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
}

export interface ContextMenuSection {
  items: ContextMenuItem[];
}

/**
 * 우클릭 메뉴를 띄울 자리. 키보드(메뉴 키, Shift+F10)로 열면 좌표가 0이라 누른 요소 아래에 띄운다.
 */
export function contextMenuPoint(e: React.MouseEvent): { x: number; y: number } {
  if (e.clientX === 0 && e.clientY === 0 && e.currentTarget instanceof Element) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: rect.left + 16, y: rect.bottom };
  }
  return { x: e.clientX, y: e.clientY };
}

interface ContextMenuProps {
  sections: ContextMenuSection[];
  position: { x: number; y: number };
  onClose: () => void;
  /** Accessible name for the menu. */
  ariaLabel?: string;
}

export function ContextMenu({ sections, position, onClose, ariaLabel }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { onKeyDown, restoreFocus } = useMenuKeyboard(ref, onClose);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // 메뉴 밖을 스크롤하거나(휠) 창 크기를 바꾸거나 창을 떠나면 닫는다. 메뉴는 연 자리에 고정되어
  // 있어서 아래 목록이 움직이면 엉뚱한 행을 가리킨다. `scroll` 이벤트는 쓰지 않는다 — 우클릭으로
  // 행을 고르면 목록이 그 행을 보이게 스스로 스크롤하는데, 그때 메뉴가 바로 닫히면 안 된다.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.right > vw) {
      el.style.left = `${position.x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      el.style.top = `${position.y - rect.height}px`;
    }
  }, [position]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn("fixed outline-none rounded-lg z-[100] py-1 min-w-[200px] animate-pop-in", FLOATING_SURFACE)}
      style={{ left: position.x, top: position.y }}
    >
      {sections.map((section, si) => (
        <div key={si}>
          {si > 0 && <div role="separator" className="border-t border-border my-1" />}
          {section.items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                if (!item.disabled) {
                  restoreFocus();
                  item.onClick();
                  onClose();
                }
              }}
              disabled={item.disabled}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left outline-none focus-visible:bg-accent",
                item.disabled && "opacity-40 cursor-not-allowed",
                item.variant === "danger"
                  ? "text-danger hover:bg-accent"
                  : "hover:bg-accent",
              )}
            >
              {item.icon && (
                <span className="w-4 h-4 flex items-center justify-center shrink-0">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
