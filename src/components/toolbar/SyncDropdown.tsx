import React from "react";
import { RefreshCw, ArrowDown, ArrowUp, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, formatRelativeTime } from "@/lib/utils";

interface SyncDropdownProps {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  lastFetchedAt: number | null;
  disabled: boolean;
  onFetch: () => void;
  onPull: (rebase?: boolean) => void;
  onPush: (force?: boolean) => void;
  onClose: () => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  badge?: number;
  danger?: boolean;
  highlighted?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function MenuItem({ icon, label, description, badge, danger, highlighted, disabled, onClick }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors",
        "hover:bg-accent",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
        highlighted && "bg-primary/5",
      )}
    >
      <span className={cn(
        "mt-0.5 shrink-0",
        danger ? "text-danger" : highlighted ? "text-primary" : "text-muted-foreground",
      )}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm font-medium leading-tight",
          danger && "text-danger",
        )}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground leading-tight mt-0.5">{description}</p>
      </div>
      {badge !== undefined && badge > 0 && (
        <span className={cn(
          "mt-0.5 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 tabular-nums leading-none",
          "bg-primary/10 text-primary",
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}

export function SyncDropdown({
  ahead,
  behind,
  hasUpstream,
  lastFetchedAt,
  disabled,
  onFetch,
  onPull,
  onPush,
  onClose,
}: SyncDropdownProps) {
  const { t } = useTranslation();
  const exec = (fn: () => void) => {
    fn();
    onClose();
  };

  // upstream이 없으면 Publish Branch만 표시
  if (!hasUpstream) {
    return (
      <div
        className="absolute right-0 top-full mt-2 w-72 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
      >
        <div className="py-1">
          <MenuItem
            icon={<Upload className="w-4 h-4" />}
            label={t("sync.publishBranch")}
            description={t("sync.publishBranchDesc")}
            highlighted
            disabled={disabled}
            onClick={() => exec(() => onPush(false))}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute right-0 top-full mt-2 w-72 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
    >
      {/* Fetch */}
      <div className="py-1">
        <MenuItem
          icon={<RefreshCw className="w-4 h-4" />}
          label={t("sync.fetchOrigin")}
          description={t("sync.fetchDescription")}
          disabled={disabled}
          onClick={() => exec(onFetch)}
        />
      </div>

      <div className="border-t border-border" />

      {/* Pull section */}
      <div className="py-1">
        <MenuItem
          icon={<ArrowDown className="w-4 h-4" />}
          label={t("sync.pullOrigin")}
          description={behind > 0 ? t("sync.pullDescription") : t("sync.noRemoteChanges")}
          badge={behind}
          highlighted={behind > 0}
          disabled={disabled || behind === 0}
          onClick={() => exec(() => onPull(false))}
        />
      </div>

      <div className="border-t border-border" />

      {/* Push section */}
      <div className="py-1">
        <MenuItem
          icon={<ArrowUp className="w-4 h-4" />}
          label={t("sync.pushOrigin")}
          description={ahead > 0 ? t("sync.pushDescription") : t("sync.noLocalCommits")}
          badge={ahead}
          highlighted={ahead > 0}
          disabled={disabled || ahead === 0}
          onClick={() => exec(() => onPush(false))}
        />
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-surface/50 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {lastFetchedAt
            ? t("sync.lastFetched", { time: formatRelativeTime(lastFetchedAt) })
            : t("sync.neverFetched")}
        </p>
      </div>
    </div>
  );
}
