import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { FLOATING_SURFACE } from "./layers";

export type DialogFrameSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<DialogFrameSize, string> = {
  sm: "max-w-[360px]",
  md: "max-w-[440px]",
  lg: "max-w-[620px]",
  xl: "w-[94vw] h-[88vh]",
};

export interface DialogFrameProps {
  title: string;
  titleId?: string;
  onClose?: () => void;
  size?: DialogFrameSize;
  dismissible?: boolean;
  /** 발 오른쪽(취소 → 실행 순 버튼). */
  footer?: ReactNode;
  /** 발 왼쪽(상태 글 등). */
  footerStart?: ReactNode;
  /** 다른 창 위에 겹쳐 뜨는 창의 z-index 등(`Dialog`로 그대로 넘어간다). */
  overlayClassName?: string;
  children: ReactNode;
}

/**
 * 답을 받아야 하는 모달의 모양(3.8). 접근성(`role="dialog"`, 포커스 가두기, Escape)은 `Dialog`가
 * 하고, 이 컴포넌트는 머리·몸·발의 모양만 정한다.
 */
export function DialogFrame({
  title,
  titleId,
  onClose,
  size = "md",
  dismissible = true,
  footer,
  footerStart,
  overlayClassName,
  children,
}: DialogFrameProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const resolvedTitleId = titleId ?? generatedId;
  return (
    <Dialog
      onClose={onClose}
      labelledBy={resolvedTitleId}
      dismissible={dismissible}
      {...(overlayClassName ? { overlayClassName } : {})}
      className={cn(FLOATING_SURFACE, "rounded-(--radius-panel) w-full mx-4 flex flex-col", SIZE_CLASS[size])}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-(--line) shrink-0">
        <h2 id={resolvedTitleId} className="flex-1 min-w-0 text-[14px] font-semibold text-foreground truncate">
          {title}
        </h2>
        {onClose && dismissible && (
          <Button
            iconOnly
            size="md"
            variant="ghost"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">{children}</div>
      {(footer || footerStart) && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-(--line) shrink-0">
          {footerStart}
          <span className="flex-1" />
          {footer}
        </div>
      )}
    </Dialog>
  );
}
