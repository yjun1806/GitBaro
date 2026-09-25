import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSettingsRowIds } from "./row-context";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * 몇 개 안 되는 선택지 중 하나를 고르는 칸(radiogroup). 화살표 키로 옮기면 바로 고른다.
 */
export function Segmented<T extends string>({ value, options, onChange, disabled = false, ariaLabel }: SegmentedProps<T>) {
  const ids = useSettingsRowIds();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || disabled) return;
    e.preventDefault();
    const next = (current + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : ids?.labelId}
      aria-describedby={ids?.descriptionId}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className={cn("inline-flex items-center gap-0.5 p-0.5 rounded-(--radius-item) bg-(--chip)", disabled && "opacity-45")}
    >
      {options.map((option, i) => {
        const selected = i === current;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-[6px] text-[12px] whitespace-nowrap outline-none",
              "transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/40",
              selected
                ? "bg-card text-foreground font-semibold shadow-(--shadow-sm)"
                : "text-(--fg2) hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
