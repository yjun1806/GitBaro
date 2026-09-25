import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ViewedCheckboxProps {
  viewed: boolean;
  /** 파일 경로. 화면 읽기 프로그램이 어느 파일의 표시인지 읽는다. */
  path: string;
  onToggle: () => void;
}

/**
 * 파일 행 끝의 「봤음」 칸. 칸은 작지만 누르는 자리는 행 높이만큼 크다. 행을 고르는 클릭과 겹치지 않게
 * 누름을 행으로 올려 보내지 않는다.
 */
export function ViewedCheckbox({ viewed, path, onToggle }: ViewedCheckboxProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={viewed}
      aria-label={`${t("fileReview.viewed")}: ${path}`}
      title={viewed ? t("fileReview.unmarkViewed") : t("fileReview.markViewed")}
      data-testid="viewed-checkbox"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        // 행의 Enter·Space(파일 고르기)로 올라가지 않게 한다. 버튼 기본 동작이 onClick을 부른다.
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      className="group/viewed flex items-center justify-center w-7 h-7 -mr-2 shrink-0 rounded-(--radius-chip) hover:bg-accent"
    >
      <span
        className={cn(
          "flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border transition-colors",
          viewed
            ? "bg-(--fg2) border-(--fg2) text-(--panel)"
            : "border-(--line2) bg-(--panel) group-hover/viewed:border-(--muted)",
        )}
        aria-hidden="true"
      >
        {viewed && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
      </span>
    </button>
  );
}
