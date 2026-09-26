import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "./layers";

interface TooltipProps {
  label: string;
  children: ReactNode;
  /** 트리거 위(기본)나 아래에 띄운다. 창 맨 위 머리 줄의 버튼은 위에 자리가 없어 아래를 쓴다. */
  side?: "top" | "bottom";
  /** 트리거 가장자리에서 떨어지는 거리(px). 머리 줄 아래로 내리려면 줄 경계까지의 거리를 더해 준다. */
  offset?: number;
  /** 마우스를 올린 뒤 보이기까지 기다리는 시간(ms). 0이면 바로 보인다. */
  delayMs?: number;
  /** 감싸는 span의 클래스(예: flex 안에서 줄어들게 `min-w-0`). */
  className?: string;
}

/**
 * Hover tooltip. Rendered through a portal so it is never clipped by a
 * scrolling/overflow ancestor, and centered on the trigger (above by default).
 */
export function Tooltip({ label, children, side = "top", offset = 6, delayMs = 0, className }: TooltipProps) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const place = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = rect.left + rect.width / 2;
    setCoords({ x, y: side === "top" ? rect.top - offset : rect.bottom + offset });
  };
  const show = () => {
    clearTimer();
    if (delayMs > 0) timer.current = setTimeout(place, delayMs);
    else place();
  };
  const hide = () => {
    clearTimer();
    setCoords(null);
  };

  return (
    <span ref={ref} className={cn("inline-flex", className)} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide}>
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: coords.x, top: coords.y }}
            className={cn(
              "fixed z-[100] -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs pointer-events-none animate-fade-in",
              side === "top" && "-translate-y-full",
              FLOATING_SURFACE,
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
