import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSettingsRowIds } from "@/components/settings/ui/row-context";

export interface SegmentedOption<T extends string> {
  value: T;
  /** 보통 글자 하나면 충분하지만, 고정폭으로 끼워 넣을 값(커밋 짧은 SHA 등)이 있으면 조각을 그대로 받는다. */
  label: ReactNode;
  icon?: ReactNode;
  /** 이 조각만 끈다(그룹 전체를 끄는 `disabled` prop과 별개). 끈 조각은 고를 수도, 화살표로 옮겨갈 수도 없다. */
  disabled?: boolean;
  /** 조각에 붙일 title(끈 이유 등 풍선말). */
  title?: string;
}

export type SegmentedSize = "md" | "sm";

const PIECE_SIZE_CLASS: Record<SegmentedSize, string> = {
  md: "h-6 px-2.5 text-[12.5px]",
  sm: "h-5 px-2 text-[11.5px]",
};

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** `md`(설정, 작업 전환) 조각 24px · `sm`(목록 필터, diff 보기 방식, 이미지 비교 방식) 조각 20px. */
  size?: SegmentedSize;
  /** 칸 너비를 다 채우고 조각을 똑같이 나눈다(작업 전환처럼 두 조각이 한 줄을 나눠 가질 때). 기본은 내용만큼만. */
  fill?: boolean;
}

/**
 * 몇 개 안 되는 선택지 중 하나를 고르는 칸(radiogroup, 3.11). 화살표 키로 옮기면 바로 고른다.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  size = "md",
  fill = false,
}: SegmentedProps<T>) {
  const ids = useSettingsRowIds();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  // 고른 조각이 꺼져 있으면(예: 보던 중 다른 브랜치로 바뀜) Tab이 닿을 곳이 없어진다 —
  // 그때는 첫 켜진 조각으로 옮겨 로빙 탭인덱스를 지킨다.
  const rovingIndex = options[current]?.disabled ? options.findIndex((o) => !o.disabled) : current;

  /** `from`에서 `step` 방향으로 다음에 고를 수 있는(꺼지지 않은) 조각. 모두 꺼져 있으면 null. */
  const nextEnabledIndex = (from: number, step: 1 | -1): number | null => {
    for (let i = 1; i <= options.length; i++) {
      const idx = (((from + step * i) % options.length) + options.length) % options.length;
      if (!options[idx].disabled) return idx;
    }
    return null;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || disabled) return;
    e.preventDefault();
    const next = nextEnabledIndex(current, step);
    if (next === null) return;
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
      className={cn(
        "items-center gap-0.5 p-0.5 rounded-(--radius-item) bg-(--chip)",
        fill ? "flex w-full" : "inline-flex",
      )}
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
            title={option.title}
            tabIndex={i === rovingIndex ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-(--radius-chip) whitespace-nowrap outline-none",
              "transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/40",
              "disabled:opacity-45 disabled:pointer-events-none",
              PIECE_SIZE_CLASS[size],
              fill && "flex-1",
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
