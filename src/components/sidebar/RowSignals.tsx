import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { liveDotLabel } from "./row-meta";
import { Count, Dot } from "@/components/ui/marks";

export interface RowSignalValues {
  /** 커밋 안 한 파일 수 */
  dirty: number;
  /** 10분 안에 파일이 바뀌었는지(「지금 바뀌는 중」) */
  live: boolean;
  /** 실시간 감시 중인지. 아니면 점을 흐리게 그린다. */
  watched: boolean;
  /** 마지막으로 파일이 바뀐 시각(ms). `live`일 때만 쓴다. */
  changedAt: number;
  /** 올릴 커밋 수 */
  ahead: number;
  /** 받을 커밋 수 */
  behind: number;
}

/**
 * 행 오른쪽 표시(많아야 셋): 주황 점과 숫자 = 커밋 안 한 파일(10분 안에 파일이 바뀌었으면 점에 옅은 테 = 지금 바뀌는 중),
 * 「↓N」 = 받을 커밋, 「↑N」 = 올릴 커밋. 자세한 내용은 자세한 정보 카드에 있다.
 */
export function RowSignals({ values, now }: { values: RowSignalValues; now: number }) {
  const { t } = useTranslation();
  const { dirty, live, watched, changedAt, ahead, behind } = values;
  const showDot = dirty > 0 || live;
  if (!showDot && ahead === 0 && behind === 0) return null;
  const dotLabel = [
    dirty > 0 ? t("sidebarTree.card.uncommitted", { count: dirty }) : null,
    live ? liveDotLabel(t, watched, now, changedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="flex items-center gap-2 shrink-0 text-[10.5px] leading-none tabular-nums">
      {showDot && (
        <span
          role="img"
          aria-label={dotLabel}
          title={dotLabel}
          data-signal="dirty"
          data-live={live || undefined}
          data-watched={watched}
          className={cn(
            "flex items-center gap-1 font-semibold text-(--live) animate-fade-in",
            live && !watched && "opacity-40",
          )}
        >
          <Dot on live={live} />
          {dirty > 0 && <Count value={dirty} tone="live" />}
        </span>
      )}
      {behind > 0 && (
        <span
          data-signal="behind"
          title={t("sidebarTree.badge.behind", { count: behind })}
          className="text-(--fg2) animate-fade-in"
        >
          <Count value={behind} prefix="↓" tone="sync" />
        </span>
      )}
      {ahead > 0 && (
        <span
          data-signal="ahead"
          title={t("sidebarTree.card.toPush", { count: ahead })}
          className="text-(--fg2) animate-fade-in"
        >
          <Count value={ahead} prefix="↑" tone="sync" />
        </span>
      )}
    </span>
  );
}
