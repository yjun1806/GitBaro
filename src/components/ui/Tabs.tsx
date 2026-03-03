import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabColor = "primary" | "info" | "success";
type TabSize = "sm" | "md";

const colorClasses: Record<
  TabColor,
  { activeText: string; indicator: string; badge: string }
> = {
  primary: {
    activeText: "text-foreground",
    indicator: "bg-primary",
    badge: "bg-primary/10 text-primary",
  },
  info: {
    activeText: "text-info",
    indicator: "bg-info",
    badge: "bg-info/10 text-info",
  },
  success: {
    activeText: "text-success",
    indicator: "bg-success",
    badge: "bg-success/10 text-success",
  },
};

const sizeClasses: Record<TabSize, { text: string; badge: string }> = {
  md: { text: "text-sm", badge: "text-xs" },
  sm: { text: "text-xs", badge: "text-[10px]" },
};

interface TabGroupProps {
  children: ReactNode;
  className?: string;
}

export function TabGroup({ children, className }: TabGroupProps) {
  return (
    <div
      role="tablist"
      className={cn("flex border-b border-border", className)}
    >
      {children}
    </div>
  );
}

interface TabProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  count?: number;
  color?: TabColor;
  size?: TabSize;
  disabled?: boolean;
  className?: string;
}

export function Tab({
  active,
  onClick,
  children,
  icon,
  count,
  color = "primary",
  size = "md",
  disabled = false,
  className,
}: TabProps) {
  const colors = colorClasses[color];
  const sizes = sizeClasses[size];

  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 font-medium transition-colors",
        sizes.text,
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
      {active && (
        <span
          className={cn(
            "absolute bottom-0 inset-x-2 h-0.5 rounded-full",
            colors.indicator,
          )}
        />
      )}
    </button>
  );
}
