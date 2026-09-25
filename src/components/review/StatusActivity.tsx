import { useTranslation } from "react-i18next";
import { History, Loader2, WifiOff } from "lucide-react";
import { useActivityStore } from "@/stores/activity";
import { useUIStore } from "@/stores/ui";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { cn } from "@/lib/utils";

/**
 * git 상태 줄 오른쪽 끝: 오프라인 표시(오프라인일 때만)와 작업 기록 버튼. git 명령이 도는 동안에는
 * 버튼 자리에 그 명령과 진행률이 보이고, 누르면 작업 기록이 열린다(예전 맨 아래 상태 막대의 역할).
 */
export function StatusActivity() {
  const { t } = useTranslation();
  const { isOnline } = useOnlineStatus();
  const isLogOpen = useUIStore((s) => s.isActivityLogOpen);
  const setLogOpen = useUIStore((s) => s.setActivityLogOpen);
  const running = useActivityStore((s) => Object.values(s.activeOperations)[0] ?? null);
  const label = t("activity.title");

  return (
    <>
      {!isOnline && (
        <span className="inline-flex items-center gap-1 shrink-0 text-danger" data-testid="offline">
          <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
          {t("status.offline")}
        </span>
      )}
      <button
        type="button"
        onClick={() => setLogOpen(!isLogOpen)}
        aria-pressed={isLogOpen}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center gap-1.5 shrink-0 min-w-0 h-6 px-1.5 rounded-(--radius-chip) text-muted-foreground",
          "hover:bg-accent hover:text-foreground transition-colors",
          isLogOpen && "bg-accent text-foreground",
        )}
      >
        {running ? (
          <>
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span className="font-mono truncate max-w-[220px]" data-testid="running-op">
              {running.operation}
            </span>
            {running.progress?.percent !== undefined && (
              <span className="shrink-0 tabular-nums">{running.progress.percent}%</span>
            )}
          </>
        ) : (
          <History className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
