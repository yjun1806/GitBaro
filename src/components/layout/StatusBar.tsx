import { GitBranch, Wifi, WifiOff, Loader2, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBranchStore } from "@/stores/branch";
import { useActivityStore } from "@/stores/activity";
import { useUIStore } from "@/stores/ui";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { formatRelativeTime, cn } from "@/lib/utils";

export function StatusBar() {
  const { t } = useTranslation();
  const currentBranch = useBranchStore((s) => s.currentBranch);
  const { isOnline } = useOnlineStatus();
  const isActivityLogOpen = useUIStore((s) => s.isActivityLogOpen);
  const setActivityLogOpen = useUIStore((s) => s.setActivityLogOpen);
  const activeOperations = useActivityStore((s) => s.activeOperations);
  const entries = useActivityStore((s) => s.entries);

  const activeOps = Object.values(activeOperations);
  const isRunning = activeOps.length > 0;
  const lastEntry = entries.find((e) => e.completedAt !== undefined) ?? null;

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-3 h-6 text-xs text-muted-foreground",
        "border-t border-border bg-surface select-none cursor-pointer",
        "hover:bg-accent transition-colors",
      )}
      onClick={() => setActivityLogOpen(!isActivityLogOpen)}
      title={t("activity.title")}
    >
      {currentBranch && (
        <div className="flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          <span>{currentBranch}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {isRunning ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span className="font-mono truncate max-w-[300px]">
              {activeOps[0].operation}
            </span>
            {activeOps[0].progress && (
              <span className="text-muted-foreground">
                — {activeOps[0].progress.message}
                {activeOps[0].progress.percent !== undefined && (
                  <span className="tabular-nums"> {activeOps[0].progress.percent}%</span>
                )}
              </span>
            )}
          </>
        ) : lastEntry ? (
          <>
            <Terminal className="w-3 h-3" />
            <span className="font-mono truncate max-w-[300px]">
              {lastEntry.command}
            </span>
            {lastEntry.durationMs !== undefined && (
              <span className="text-muted-foreground">
                ({lastEntry.durationMs}ms)
              </span>
            )}
            {lastEntry.completedAt && (
              <span className="text-muted-foreground">
                · {formatRelativeTime(lastEntry.completedAt)}
              </span>
            )}
          </>
        ) : null}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {isOnline ? (
          <Wifi className="w-3 h-3 text-success" />
        ) : (
          <WifiOff className="w-3 h-3 text-danger" />
        )}
        <span>{isOnline ? t("status.online") : t("status.offline")}</span>
      </div>
    </div>
  );
}
