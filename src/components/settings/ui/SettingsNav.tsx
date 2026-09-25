import { useId } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsNavItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** 빨강 글자(위험한 칸). */
  danger?: boolean;
}

interface SettingsNavProps<T extends string> {
  items: readonly SettingsNavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
}

/**
 * 설정 화면 왼쪽 칸 목록(층 0 틀 위). 고른 칸은 한 단계 진한 채움과 왼쪽 브랜드 색 막대로 보인다.
 * 위아래 화살표로 칸을 옮긴다.
 */
export function SettingsNav<T extends string>({ items, active, onSelect, ariaLabel }: SettingsNavProps<T>) {
  const prefix = useId();
  const navItemId = (id: string) => `${prefix}-${id}`;
  const move = (from: number, step: number) => {
    const next = (from + step + items.length) % items.length;
    onSelect(items[next].id);
    document.getElementById(navItemId(items[next].id))?.focus();
  };
  return (
    <nav aria-label={ariaLabel} className="flex flex-col gap-0.5">
      {items.map(({ id, label, icon: Icon, danger }, i) => {
        const selected = id === active;
        return (
          <button
            key={id}
            id={navItemId(id)}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, e.key === "ArrowDown" ? 1 : -1);
              }
            }}
            className={cn(
              "relative flex items-center gap-2.5 h-8 pl-3 pr-2 rounded-(--radius-item) text-left text-[13px] outline-none",
              "transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/40",
              selected
                ? "bg-(--frame-sel) text-foreground font-semibold"
                : "text-(--fg2) hover:bg-(--frame-hover) hover:text-foreground",
              danger && !selected && "text-destructive",
            )}
          >
            {selected && (
              <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-(--acc)" />
            )}
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
