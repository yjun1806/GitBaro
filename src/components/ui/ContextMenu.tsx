import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

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

interface ContextMenuProps {
  sections: ContextMenuSection[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ sections, position, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
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
      className="fixed bg-popover border border-border rounded-lg shadow-lg z-[100] py-1 min-w-[200px]"
      style={{ left: position.x, top: position.y }}
    >
      {sections.map((section, si) => (
        <div key={si}>
          {si > 0 && <div className="border-t border-border my-1" />}
          {section.items.map((item) => (
            <button
              key={item.label}
              onClick={(e) => {
                e.stopPropagation();
                if (!item.disabled) {
                  item.onClick();
                  onClose();
                }
              }}
              disabled={item.disabled}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left",
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
