import { useState, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "./layers";

interface TooltipProps {
  label: string;
  children: ReactNode;
}

/**
 * Immediate hover tooltip. Rendered through a portal so it is never clipped by
 * a scrolling/overflow ancestor, and positioned above the trigger's center.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setCoords({ x: rect.left + rect.width / 2, y: rect.top });
  };
  const hide = () => setCoords(null);

  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: coords.x, top: coords.y }}
            className={cn("fixed z-[100] -mt-1.5 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-2 py-1 text-xs pointer-events-none", FLOATING_SURFACE)}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
