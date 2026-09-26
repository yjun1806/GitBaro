import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warning" | "danger" | "success" | "neutral";

const TONE_SURFACE_CLASS: Record<NoticeTone, string> = {
  info: "bg-info/10 border-info/20",
  warning: "bg-warning/10 border-warning/20",
  danger: "bg-danger/10 border-danger/20",
  success: "bg-success/10 border-success/20",
  neutral: "bg-(--chip) border-transparent",
};

const TONE_TEXT_CLASS: Record<NoticeTone, string> = {
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
  success: "text-success",
  neutral: "text-(--fg2)",
};

export interface NoticeProps {
  tone: NoticeTone;
  icon?: LucideIcon;
  title?: string;
  children?: ReactNode;
  /** 오른쪽 끝 버튼(`Button sm`, 최대 둘). */
  actions?: ReactNode;
  /** 칸 맨 위에 붙는 띠 변형: 모서리 없이 아래 테두리만. */
  banner?: boolean;
  role?: "status" | "alert";
}

/**
 * 그 칸의 내용과 함께 계속 보여야 하는 줄 안 안내(3.7). 옅은 톤 채움 + 톤 테두리 + 아이콘.
 * 왼쪽 막대는 쓰지 않는다.
 */
export function Notice({ tone, icon: Icon, title, children, actions, banner = false, role }: NoticeProps) {
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "flex items-start gap-2 px-3 py-2",
        banner ? "border-b" : "rounded-(--radius-item) border",
        TONE_SURFACE_CLASS[tone],
      )}
    >
      {Icon && <Icon className={cn("w-3.5 h-3.5 mt-px shrink-0", TONE_TEXT_CLASS[tone])} aria-hidden="true" />}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {title && <p className="text-[12.5px] font-semibold text-foreground">{title}</p>}
        {children && (
          <div className={cn("text-[11.5px]", title ? "text-(--fg2)" : TONE_TEXT_CLASS[tone])}>{children}</div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
