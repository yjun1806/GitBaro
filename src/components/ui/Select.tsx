import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm",
          "border border-border rounded-lg bg-card text-foreground",
          "outline-none transition-colors",
          open && "ring-2 ring-ring",
          disabled && "opacity-50 cursor-not-allowed",
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
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors",
                option.value === value
                  ? "bg-primary/10 text-primary"
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
