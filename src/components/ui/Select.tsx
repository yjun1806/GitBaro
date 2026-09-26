import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "./layers";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  // Escape closes only the dropdown; preventDefault keeps an enclosing Dialog open.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={ref} className={cn("relative", className)} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "w-full h-7 flex items-center justify-between gap-2 px-2.5 text-[12.5px]",
          "border border-border rounded-(--radius-item) bg-card text-foreground",
          "outline-none transition-colors motion-reduce:transition-none",
          open && "ring-2 ring-ring",
          disabled && "opacity-45 cursor-not-allowed",
          !disabled && !open && "hover:border-muted-foreground/40",
        )}
      >
        <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder ?? ""}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className={cn("absolute left-0 right-0 top-full mt-1 rounded-(--radius-item) p-1 z-50 max-h-48 overflow-y-auto animate-pop-in", FLOATING_SURFACE)}>
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "w-full h-7 flex items-center justify-between gap-2 px-2.5 rounded-(--radius-chip) text-[12.5px] text-left transition-colors motion-reduce:transition-none",
                option.value === value
                  ? "bg-accent text-foreground font-medium"
                  : "text-foreground hover:bg-accent",
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && (
                <Check className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
