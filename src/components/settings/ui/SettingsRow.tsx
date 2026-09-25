import { useId, type ReactNode } from "react";
import { RowContext } from "./row-context";
import { cn } from "@/lib/utils";

interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** 오른쪽 컨트롤. */
  children?: ReactNode;
  /** 컨트롤이 넓으면(입력칸·목록) 이름 아래 한 줄을 다 쓰게 둔다. */
  stacked?: boolean;
  className?: string;
}

/**
 * 설정 카드 안 한 줄: 왼쪽에 이름과 설명, 오른쪽에 컨트롤(macOS 시스템 설정과 같은 모양).
 * 안의 컨트롤은 `useSettingsRowIds`로 이 줄의 이름·설명에 연결된다.
 */
export function SettingsRow({ label, description, children, stacked = false, className }: SettingsRowProps) {
  const labelId = useId();
  const descriptionId = useId();
  const ids = { labelId, descriptionId: description ? descriptionId : undefined };
  return (
    <RowContext.Provider value={ids}>
      <div
        className={cn(
          "flex gap-x-6 gap-y-2.5 px-4 py-3 min-h-[52px]",
          stacked ? "flex-col" : "items-center justify-between",
          className,
        )}
      >
        <div className="min-w-0 flex flex-col gap-0.5">
          <span id={labelId} className="text-[13px] font-medium text-foreground">
            {label}
          </span>
          {description && (
            <span id={descriptionId} className="text-[12px] leading-[17px] text-muted-foreground">
              {description}
            </span>
          )}
        </div>
        {children !== undefined && <div className={cn("min-w-0", !stacked && "shrink-0")}>{children}</div>}
      </div>
    </RowContext.Provider>
  );
}
