import { ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { usePaneStore } from "./pane-state";

/**
 * 2단계 좁은 커밋 목록의 머리 줄(D47). 탭 줄·필터 막대 대신 지금 보는 것의 이름과 「그래프 펼치기」만
 * 둔다. 펼치면 1단계 폭(그래프 46%)으로 돌아가고, 고른 행·파일은 그대로 둔다.
 */
export function NarrowPaneHeader({ label }: { label: string }) {
  const { t } = useTranslation();
  const setGraphExpanded = usePaneStore((s) => s.setGraphExpanded);
  return (
    <div className="flex items-center gap-2 h-8 pl-3 pr-1.5 shrink-0 border-b border-(--line)">
      <span className="flex-1 min-w-0 truncate text-[12.5px] font-bold text-foreground">{label}</span>
      <Button
        iconOnly
        size="sm"
        variant="ghost"
        onClick={() => setGraphExpanded(true)}
        aria-label={t("layout.expandGraph")}
        title={t("layout.expandGraph")}
      >
        <ChevronsRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
