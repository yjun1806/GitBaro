import { useTranslation } from "react-i18next";

export interface ViewedProgressProps {
  viewed: number;
  total: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** 목록 머리의 「파일 N개 중 M개 봤음」과 얇은 진행 막대, 봤음 행 접기 단추. */
export function ViewedProgress({ viewed, total, collapsed, onToggleCollapsed }: ViewedProgressProps) {
  const { t } = useTranslation();
  const ratio = total === 0 ? 0 : Math.min(1, viewed / total);
  return (
    <div className="flex items-center gap-2 pt-0.5" data-testid="viewed-progress">
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {t("fileReview.progress", { count: total, viewed })}
      </span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={viewed}
        aria-label={t("fileReview.progress", { count: total, viewed })}
        className="flex-1 min-w-8 h-1 rounded-full bg-(--line) overflow-hidden"
      >
        <div className="h-full rounded-full bg-(--fg2) transition-[width]" style={{ width: `${ratio * 100}%` }} />
      </div>
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-pressed={collapsed}
        disabled={viewed === 0}
        className="shrink-0 h-6 px-2 rounded-(--radius-chip) text-[11px] font-semibold text-(--fg2) hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        {collapsed ? t("fileReview.expandViewed") : t("fileReview.collapseViewed")}
      </button>
    </div>
  );
}
