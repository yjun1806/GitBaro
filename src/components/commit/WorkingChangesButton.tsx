import { useTranslation } from "react-i18next";
import { FileDiff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpenWorkingChanges } from "./useOpenWorkingChanges";

export interface WorkingChangesButtonProps {
  /** 커밋 안 한 파일 수. */
  count: number;
  /** `row`: WIP 행 끝의 작은 버튼. `header`: 패널 머리·상태 줄의 버튼. */
  variant?: "row" | "header";
}

/**
 * 「작업 중인 변경 N」. 지금 연 워크트리의 스테이징 목록과 커밋 입력을 열고 파일 목록에 포커스를 둔다.
 * 이동만 한다 — 이름에 「커밋」 동사를 쓰지 않는 이유다.
 */
export function WorkingChangesButton({ count, variant = "row" }: WorkingChangesButtonProps) {
  const { t } = useTranslation();
  const open = useOpenWorkingChanges();
  return (
    <button
      type="button"
      onClick={open}
      data-working-changes=""
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-(--radius-chip) font-semibold transition-colors",
        "bg-(--chip) text-(--fg2) hover:bg-accent",
        variant === "row" ? "h-[22px] px-2 text-[11px]" : "h-6 px-2.5 text-[11.5px]",
      )}
    >
      <FileDiff className="w-3 h-3" aria-hidden="true" />
      {t("commit.workingChanges", { count })}
    </button>
  );
}
