import { useTranslation } from "react-i18next";
import { History, WifiOff } from "lucide-react";
import { useActivityStore } from "@/stores/activity";
import { useUIStore } from "@/stores/ui";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSteadyValue } from "@/hooks/useSteadyValue";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

/** 이보다 짧게 끝나는 명령은 표시하지 않는다. 사이드바 fetch 표시의 박자(`BUSY_TIMING`)와 같다. */
export const SHOW_AFTER_MS = 300;
/** 명령이 끝난 뒤 표시를 남겨 두는 시간. 워크스페이스의 저장소를 차례로 fetch할 때 사이사이 깜박이지 않게 한다. */
export const HOLD_MS = 800;

/**
 * git 상태 줄 오른쪽 끝: 오프라인 표시(오프라인일 때만)와 작업 기록 버튼. git 명령이 도는 동안에는
 * 버튼 자리에 그 명령과 진행률이 보이고, 누르면 작업 기록이 열린다(예전 맨 아래 상태 막대의 역할).
 */
export function StatusActivity() {
  const { t } = useTranslation();
  const { isOnline } = useOnlineStatus();
  const isLogOpen = useUIStore((s) => s.isActivityLogOpen);
  const setLogOpen = useUIStore((s) => s.setActivityLogOpen);
  // 새로 시작한 명령은 SHOW_AFTER_MS가 지나야 보이고, 보이는 중이면 다음 명령으로 바로 바뀌며, 모두 끝나도 HOLD_MS 동안 남는다.
  // 진행률이 갱신될 때마다 새 객체로 오므로(activity.ts의 updateProgress), 명령 id로 정체성을 잡아
  // 그 갱신이 SHOW_AFTER_MS 타이머를 되돌리지 않게 한다.
  const running = useSteadyValue(
    useActivityStore((s) => Object.values(s.activeOperations)[0] ?? null),
    { showAfterMs: SHOW_AFTER_MS, holdMs: HOLD_MS },
    (op) => op.id,
  );
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
        aria-busy={running !== null}
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
            <Spinner />
            {/* 폭을 고정해 명령이 바뀌어도(fetch → pull) 옆 요소가 밀리지 않는다. */}
            <span className="w-[7.5rem] truncate text-left" data-testid="running-op">
              {t(`activity.op.${running.operation}`)}
              {running.progress?.percent !== undefined && (
                <span className="tabular-nums"> {t("activity.progress", { percent: running.progress.percent })}</span>
              )}
            </span>
          </>
        ) : (
          <History className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
