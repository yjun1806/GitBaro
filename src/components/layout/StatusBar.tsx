import { GitBranch, Wifi, WifiOff, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBranchStore } from "@/stores/branch";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  lastFetchTime?: number | null;
  isOnline?: boolean;
}

export function StatusBar({ lastFetchTime = null, isOnline = true }: StatusBarProps) {
  const { t } = useTranslation();
  const currentBranch = useBranchStore((s) => s.currentBranch);

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-3 h-6 text-xs text-muted-foreground",
        "border-t border-border bg-surface select-none",
      )}
    >
      {currentBranch && (
        <div className="flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          <span>{currentBranch}</span>
        </div>
      )}

      {lastFetchTime !== null && (
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{t("status.fetched", { time: formatRelativeTime(lastFetchTime) })}</span>
        </div>
      )}

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
