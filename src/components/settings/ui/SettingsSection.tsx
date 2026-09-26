import { useId, type ReactNode } from "react";
import { PANEL_SURFACE } from "@/components/ui/layers";
import { SectionLabel } from "@/components/ui/PanelHeader";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  title?: string;
  description?: ReactNode;
  /** 제목 줄 오른쪽 작은 버튼(예: 「다시 찾기」). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 설정 화면의 묶음 하나: 작은 제목 + 흰 카드(층 2). 카드 안 줄(`SettingsRow`)은 가는 선으로 나눈다.
 */
export function SettingsSection({ title, description, action, children, className }: SettingsSectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cn("flex flex-col gap-2", className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 flex flex-col gap-0.5">
            {title && <SectionLabel id={titleId} title={title} className="px-1 pt-0 pb-0" />}
            {description && <p className="px-1 text-[11.5px] leading-[17px] text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn(PANEL_SURFACE, "flex flex-col divide-y divide-(--line) overflow-hidden")}>{children}</div>
    </section>
  );
}
