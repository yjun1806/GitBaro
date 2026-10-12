import { ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";

/**
 * 2단계 좁은 커밋 목록의 머리 줄(D47). 탭 줄·필터 막대 대신 지금 보는 것의 이름과 「목록 닫고 그래프
 * 넓게 보기」만 둔다. 누르면 `onClose`가 고른 행·파일을 모두 풀어 옆 칸이 닫히고(0단계) 그래프가
 * 전체 폭이 된다. 목록의 스크롤은 그대로 두고, 키보드 초점은 그래프 목록(`data-graph-list`)으로 옮긴다.
 */
export function NarrowPaneHeader({ label, onClose }: { label: string; onClose: () => void }) {
  const { t } = useTranslation();
  const handleClose = (e: React.MouseEvent<HTMLButtonElement>) => {
    // 이 버튼은 곧 사라지므로, 그 전에 같은 그래프 칸 안의 목록으로 초점을 옮긴다.
    e.currentTarget.closest("[data-pane-level]")?.querySelector<HTMLElement>("[data-graph-list]")?.focus({ preventScroll: true });
    onClose();
  };
  return (
    <div className="flex items-center gap-2 h-8 pl-3 pr-1.5 shrink-0 border-b border-(--line)">
      <span className="flex-1 min-w-0 truncate text-[12.5px] font-bold text-foreground">{label}</span>
      <Button
        iconOnly
        size="sm"
        variant="ghost"
        onClick={handleClose}
        aria-label={t("layout.closeNarrowList")}
        title={t("layout.closeNarrowList")}
      >
        <ChevronsRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
