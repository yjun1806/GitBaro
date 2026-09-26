import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateLayout = "panel" | "row";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** `panel`(기본): 칸·카드 전체가 빈 때. `row`: 목록의 한 구역이 빈 때. */
  layout?: EmptyStateLayout;
  className?: string;
}

/**
 * 보일 것이 없거나 아직 고르지 않았을 때 그 칸에 놓는 것(3.6). 두 가지뿐이다 — 아이콘을 둥근 원에
 * 넣지 않는다(D15).
 */
export function EmptyState({ icon: Icon, title, description, action, layout = "panel", className }: EmptyStateProps) {
  if (layout === "row") {
    return <p className={cn("px-3 py-2 text-[11.5px] text-muted-foreground animate-content-in", className)}>{title}</p>;
  }
  return (
    <div
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-3 px-4 py-6 text-center animate-content-in",
        className,
      )}
    >
      {Icon && <Icon className="w-6 h-6 text-muted-foreground" aria-hidden="true" />}
      <div className="flex flex-col gap-1 max-w-[280px]">
        <p className="text-[12.5px] font-semibold text-(--fg2)">{title}</p>
        {description && <p className="text-[11.5px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
