import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";

export interface WorkspaceTitleProps {
  name: string;
  accountLabel: string;
  /** 워크스페이스의 저장소 수. */
  total: number;
  /** 그중 지금 보이는 저장소 수. */
  shown: number;
}

/**
 * 워크스페이스 리뷰 화면의 제목. 「워크스페이스 · 계정 · 저장소 N개 중 M개 표시」
 * (시안 `gen_d.py`의 툴바 왼쪽 제목). `WorkspaceReview`가 툴바의 제목 자리에 portal로 그린다.
 */
export function WorkspaceTitle({ name, accountLabel, total, shown }: WorkspaceTitleProps) {
  const { t } = useTranslation();
  return (
    // 툴바의 창 끌기 영역 안에 놓이므로 포인터를 받지 않는다(끌기가 제목을 지나 동작하게).
    <div className="flex items-center gap-2.5 min-w-0 shrink-0 px-0.5 pointer-events-none">
      <span className="flex items-center justify-center w-7 h-7 shrink-0 rounded-lg bg-card shadow-(--shadow-sm)">
        <Folder className="w-[15px] h-[15px] text-foreground" aria-hidden="true" />
      </span>
      <span className="flex flex-col min-w-0 leading-[17px]">
        <h1 className="truncate text-[14px] font-bold text-foreground">{name}</h1>
        <span className="truncate text-[11.5px] text-muted-foreground" data-testid="workspace-title-subtitle">
          {t("review.subtitle", { account: accountLabel, count: total, shown })}
        </span>
      </span>
    </div>
  );
}
