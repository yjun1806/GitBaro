import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { liveDotLabel } from "./row-meta";

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
}

/**
 * 행 오른쪽 표시(많아야 둘): 주황 점 = 커밋 안 한 변경(10분 안에 파일이 바뀌었으면 옅은 테 = 지금 바뀌는 중),
 * 회색 「↑N」 = 올릴 커밋. 자세한 내용은 자세한 정보 카드에 있다.
 */
export function RowSignals({ values, now }: { values: RowSignalValues; now: number }) {
  const { t } = useTranslation();
  const { dirty, live, watched, changedAt, ahead } = values;
  const showDot = dirty > 0 || live;
  if (!showDot && ahead === 0) return null;
  const dotLabel = [
    dirty > 0 ? t("sidebarTree.card.uncommitted", { count: dirty }) : null,
    live ? liveDotLabel(t, watched, now, changedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {showDot && (
        <span
          role="img"
          aria-label={dotLabel}
          title={dotLabel}
          data-signal="dirty"
          data-live={live || undefined}
          data-watched={watched}
          className={cn(
            "w-[7px] h-[7px] rounded-full bg-[var(--live)] shrink-0",
            live && "shadow-[0_0_0_3px_var(--live-soft)]",
            live && !watched && "opacity-40",
          )}
        />
      )}
      {ahead > 0 && (
        <span
          data-signal="ahead"
          title={t("sidebarTree.card.toPush", { count: ahead })}
          className="text-[10.5px] tabular-nums text-muted-foreground"
        >
          ↑{ahead}
        </span>
      )}
    </span>
  );
}
