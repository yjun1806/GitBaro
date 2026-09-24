import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { rowMetaItems, syncText } from "./row-meta";

interface RowBadgesProps {
  /** 커밋하지 않은 파일 수 — 주황 점과 숫자 */
  dirty?: number;
  /** 마지막 확인 뒤 새 커밋 수 — 브랜드 색 배지 */
  newCommits?: number;
  ahead?: number;
  behind?: number;
}

/**
 * 행 오른쪽 메타 칸. 순서는 늘 [커밋 안 한 파일(주황 점 + 숫자)] [새 커밋(브랜드 색 배지)] [↑↓(작은 회색)]이고
 * 0인 항목은 빼고 그린다(`rowMetaItems`). 칸마다 최소 폭을 둬서 행끼리 오른쪽 끝과 숫자 자리가 맞는다.
 */
export function RowBadges(props: RowBadgesProps) {
  const { t } = useTranslation();
  const items = rowMetaItems(props);
  if (items.length === 0) return null;

  return (
    <span className="flex items-center justify-end gap-1.5 shrink-0 tabular-nums" data-testid="row-meta">
      {items.map((item) => {
        if (item.kind === "dirty") {
          const label = t("sidebarTree.badge.uncommitted", { count: item.count });
          return (
            <span
              key="dirty"
              role="img"
              aria-label={label}
              title={label}
              data-meta="dirty"
              className="min-w-[26px] flex items-center justify-end gap-[3px] text-[11px] font-bold text-[var(--live)]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--live)] shrink-0" />
              {item.count}
            </span>
          );
        }
        if (item.kind === "newCommits") {
          const label = t("sidebarTree.badge.newCommits", { count: item.count });
          return (
            <span
              key="newCommits"
              role="img"
              aria-label={label}
              title={label}
              data-meta="newCommits"
              className="h-4 min-w-[18px] px-[5px] rounded-full bg-primary text-primary-foreground text-[10.5px] font-bold flex items-center justify-center"
            >
              {item.count}
            </span>
          );
        }
        const label = [
          item.ahead > 0 ? t("sidebarTree.badge.ahead", { count: item.ahead }) : null,
          item.behind > 0 ? t("sidebarTree.badge.behind", { count: item.behind }) : null,
        ]
          .filter(Boolean)
          .join(" / ");
        return (
          <span
            key="sync"
            role="img"
            aria-label={label}
            title={label}
            data-meta="sync"
            className="min-w-[22px] text-right text-[10.5px] text-muted-foreground whitespace-nowrap"
          >
            {syncText(item.ahead, item.behind)}
          </span>
        );
      })}
    </span>
  );
}

interface LiveDotProps {
  /** false면 실시간 감시 밖(20초 폴링으로만 채움)이라 흐리게 그린다. */
  watched: boolean;
  className?: string;
}

/** 작업 중 점: 10분 안에 파일이 바뀐 곳. */
export function LiveDot({ watched, className }: LiveDotProps) {
  const { t } = useTranslation();
  const label = watched ? t("sidebarTree.badge.live") : t("sidebarTree.badge.liveNotWatched");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-watched={watched}
      className={cn(
        "w-[7px] h-[7px] rounded-full bg-[var(--live)] shadow-[0_0_0_2px_var(--frame)]",
        !watched && "opacity-40",
        className,
      )}
    />
  );
}
