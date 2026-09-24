import { useTranslation } from "react-i18next";
import { GitCommitHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStartCommit } from "./useStartCommit";

export interface CommitNowButtonProps {
  /** 커밋하지 않은 파일 수. */
  count: number;
  /** `row`: WIP 행 끝의 작은 버튼. `header`: 그래프 패널 머리의 버튼. */
  variant?: "row" | "header";
}

/**
 * 「커밋하기 (N)」. 지금 연 워크트리의 스테이징 목록과 커밋 입력을 열고 요약 칸에 포커스를 둔다.
 * 툴바와 상관없이 메인 칸 안에서 직접 커밋하는 길을 보여 준다.
 */
export function CommitNowButton({ count, variant = "row" }: CommitNowButtonProps) {
  const { t } = useTranslation();
  const startCommit = useStartCommit();
  return (
    <button
      type="button"
      onClick={startCommit}
      data-commit-now=""
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-(--radius-chip) font-semibold transition-colors",
        "bg-primary text-primary-foreground hover:bg-primary-hover",
        variant === "row" ? "h-[22px] px-2 text-[11px]" : "h-6 px-2.5 text-[11.5px]",
      )}
    >
      <GitCommitHorizontal className="w-3 h-3" aria-hidden="true" />
      {t("commit.commitNow", { count })}
    </button>
  );
}
