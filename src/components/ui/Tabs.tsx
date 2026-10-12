import { useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSlidingIndicator } from "./use-sliding-indicator";

type TabSize = "sm" | "md";
/**
 * "fill": tabs share the bar width equally (side panels).
 * "inline": tabs sit side by side at their own width, like the graph panel
 * header in the design (12.5px, underline in the accent colour).
 */
type TabVariant = "fill" | "inline";

// 색 변형은 하나다(D26) — 탭 이름은 언제나 상태를 말로 적고, 색은 활성 밑줄에만 쓴다(원칙 2).
const TAB_COLORS = {
  activeText: "text-foreground",
  indicator: "bg-primary",
  // 탭 개수 배지는 버튼·탭 안의 예외로 채운 알약을 유지한다(D35) — 강조가 아니라 회색이다.
  badge: "bg-foreground/10 text-foreground",
};

const sizeClasses: Record<TabSize, { text: string; badge: string }> = {
  md: { text: "text-[12.5px]", badge: "text-[10.5px]" },
  sm: { text: "text-[11.5px]", badge: "text-[10px]" },
};

interface TabGroupProps {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}

/**
 * 탭 줄. 활성 탭 밑줄은 탭마다 따로 그리지 않고 줄에 하나만 두어 탭 사이를 미끄러진다(transitions.dev: tabs-sliding).
 * 탭(`Tab`)은 `data-indicator-inset`으로 밑줄이 양옆에서 얼마나 들어올지 알려 준다.
 */
export function TabGroup({ children, className, "aria-label": ariaLabel }: TabGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(groupRef, indicatorRef, '[role="tab"][aria-selected="true"]', (tab) => {
    const inset = Number(tab.dataset.indicatorInset ?? 0);
    return { left: tab.offsetLeft + inset, width: Math.max(0, tab.offsetWidth - inset * 2) };
  });
  return (
    <div
      ref={groupRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative flex border-b border-border", className)}
    >
      {children}
      <span
        ref={indicatorRef}
        aria-hidden="true"
        data-tab-indicator=""
        className={cn(
          "absolute bottom-0 left-0 h-0.5 w-0 rounded-full opacity-0 pointer-events-none motion-slide-indicator",
          TAB_COLORS.indicator,
        )}
      />
    </div>
  );
}

interface TabProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  count?: number;
  size?: TabSize;
  disabled?: boolean;
  variant?: TabVariant;
  className?: string;
}

export function Tab({
  active,
  onClick,
  children,
  icon,
  count,
  size = "md",
  disabled = false,
  variant = "fill",
  className,
}: TabProps) {
  const colors = TAB_COLORS;
  const sizes = sizeClasses[size];

  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      // 밑줄은 탭 폭에서 양옆 8px씩 들어온다(채움 변형). 밑줄 자체는 `TabGroup`이 그린다.
      data-indicator-inset={variant === "fill" ? 8 : 0}
      className={cn(
        "relative flex items-center justify-center gap-1.5 px-3 transition-colors duration-(--tabs-dur) ease-(--tabs-ease)",
        variant === "fill"
          ? cn("flex-1 py-2.5 font-medium", sizes.text)
          : cn("h-8 shrink-0 text-[12.5px]", active ? "font-bold" : "font-medium"),
        active
          ? colors.activeText
          : "text-muted-foreground hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "tabular-nums px-1.5 py-0.5 rounded-full font-semibold",
            sizes.badge,
            active ? colors.badge : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
