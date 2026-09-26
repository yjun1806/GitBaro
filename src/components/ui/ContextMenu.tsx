import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "./layers";
import { useMenuKeyboard } from "@/hooks/useMenuKeyboard";
import { clampPanelToViewport } from "@/lib/panel-position";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  /** 둘째 줄(강제 push 같은 위험한 항목의 설명). */
  description?: string;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
  /** 고른 항목(드롭다운에서 지금 값). 앞 자리에 체크가 선다. */
  checked?: boolean;
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

export interface ContextMenuAnchor {
  /** 메뉴를 여는 트리거 버튼. 그 아래(왼쪽 정렬)에 띄운다. */
  anchorRef: RefObject<HTMLElement | null>;
  /** 트리거의 왼쪽(기본) 또는 오른쪽 끝에 맞춘다. */
  align?: "start" | "end";
}

interface ContextMenuProps {
  sections: ContextMenuSection[];
  onClose: () => void;
  /** Accessible name for the menu. */
  ariaLabel?: string;
  /** 우클릭 등 고정 좌표에 띄울 때. `anchored`와 함께 주면 `anchored`가 앞선다. */
  position?: { x: number; y: number };
  /** ▾ 버튼 같은 트리거 아래에 띄우는 드롭다운. */
  anchored?: ContextMenuAnchor;
}

/** `anchored`일 때 트리거 아래(또는 위) 자리를 잰다. 잴 수 없으면(테스트 등) 원점에 그대로 둔다. */
function useAnchoredPosition(menuRef: RefObject<HTMLElement | null>, anchor: ContextMenuAnchor | undefined) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      const anchorEl = anchor.anchorRef.current;
      const menu = menuRef.current;
      if (!anchorEl || !menu) return;
      const a = anchorEl.getBoundingClientRect();
      const applied = menu.style.maxHeight;
      menu.style.maxHeight = "";
      const m = menu.getBoundingClientRect();
      menu.style.maxHeight = applied;
      const left = anchor.align === "end" ? a.right - m.width : a.left;
      const clamped = clampPanelToViewport(
        { left, top: a.top, bottom: a.bottom, width: a.width },
        { width: m.width, height: m.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPosition({ top: clamped.top, left: clamped.left });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.anchorRef, anchor?.align]);

  return position;
}

export function ContextMenu({ sections, position, anchored, onClose, ariaLabel }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { onKeyDown, restoreFocus } = useMenuKeyboard(ref, onClose);
  const anchoredPosition = useAnchoredPosition(ref, anchored);
  const fixedPoint = position ?? { x: 0, y: 0 };
  const style: { left: number; top: number; visibility?: "visible" | "hidden" } = anchored
    ? { left: (anchoredPosition ?? { top: 0, left: 0 }).left, top: (anchoredPosition ?? { top: 0, left: 0 }).top, visibility: anchoredPosition ? "visible" : "hidden" }
    : { left: fixedPoint.x, top: fixedPoint.y };

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

  // Adjust position to stay within viewport(고정 좌표일 때만 — anchored는 `clampPanelToViewport`가 이미 처리한다).
  useEffect(() => {
    if (anchored || !ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const p = position ?? { x: 0, y: 0 };

    if (rect.right > vw) {
      el.style.left = `${p.x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      el.style.top = `${p.y - rect.height}px`;
    }
  }, [position, anchored]);

  const hasChecks = sections.some((s) => s.items.some((item) => item.checked !== undefined));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn("fixed outline-none rounded-(--radius-item) p-1 z-[100] min-w-[200px] animate-pop-in", FLOATING_SURFACE)}
      style={style}
    >
      {sections.map((section, si) => (
        <div key={si}>
          {si > 0 && <div role="separator" className="border-t border-border my-1 -mx-1" />}
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
                "w-full flex items-center gap-2 min-h-7 px-2.5 rounded-(--radius-chip) text-[12.5px] transition-colors motion-reduce:transition-none text-left outline-none focus-visible:bg-accent",
                item.disabled && "opacity-45 cursor-not-allowed",
                item.variant === "danger" ? "text-danger hover:bg-accent" : "hover:bg-accent",
              )}
            >
              {(item.icon || hasChecks) && (
                <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                  {item.checked ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" /> : item.icon}
                </span>
              )}
              <span className="flex-1 min-w-0 flex flex-col items-start">
                <span className="truncate">{item.label}</span>
                {item.description && <span className="text-[11.5px] text-muted-foreground truncate">{item.description}</span>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
