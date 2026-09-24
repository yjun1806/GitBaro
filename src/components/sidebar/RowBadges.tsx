import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface RowBadgesProps {
  /** 커밋하지 않은 파일 수 — 주황 점과 숫자 */
  dirty?: number;
  /** 마지막 확인 뒤 새 커밋 수 — 진한 배지 */
  newCommits?: number;
  ahead?: number;
  behind?: number;
}

/**
 * 트리 행 오른쪽 표시 세 가지(D2 시안): ↑↓, 커밋하지 않은 파일 수(주황 점), 새 커밋 수(진한 배지).
 * 값이 0이면 그 표시는 그리지 않는다.
 */
export function RowBadges({ dirty = 0, newCommits = 0, ahead = 0, behind = 0 }: RowBadgesProps) {
  const { t } = useTranslation();
  const hasSync = ahead > 0 || behind > 0;
  if (!hasSync && dirty <= 0 && newCommits <= 0) return null;

  const syncLabel = [
    ahead > 0 ? t("sidebarTree.badge.ahead", { count: ahead }) : null,
    behind > 0 ? t("sidebarTree.badge.behind", { count: behind }) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {hasSync && (
        <span
          role="img"
          aria-label={syncLabel}
          title={syncLabel}
          className="text-[11px] text-[var(--faint)] tabular-nums whitespace-nowrap"
        >
          {ahead > 0 && `↑${ahead}`}
          {ahead > 0 && behind > 0 && " "}
          {behind > 0 && `↓${behind}`}
        </span>
      )}
      {dirty > 0 && (
        <span
          role="img"
          aria-label={t("sidebarTree.badge.uncommitted", { count: dirty })}
          title={t("sidebarTree.badge.uncommitted", { count: dirty })}
          className="flex items-center gap-[3px] text-[11px] font-bold text-[var(--live)] tabular-nums"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--live)]" />
          {dirty}
        </span>
      )}
      {newCommits > 0 && (
        <span
          role="img"
          aria-label={t("sidebarTree.badge.newCommits", { count: newCommits })}
          title={t("sidebarTree.badge.newCommits", { count: newCommits })}
          className="h-[17px] min-w-[17px] px-[5px] rounded-full bg-primary text-primary-foreground text-[10.5px] font-bold flex items-center justify-center tabular-nums"
        >
          {newCommits}
        </span>
      )}
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
