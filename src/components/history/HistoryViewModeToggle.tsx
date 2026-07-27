import { useTranslation } from "react-i18next";
import { Bot, GitCommit } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HistoryViewMode } from "@/stores/ui";

interface HistoryViewModeToggleProps {
  mode: HistoryViewMode;
  onChange: (mode: HistoryViewMode) => void;
  className?: string;
}

const MODES: readonly { mode: HistoryViewMode; icon: typeof GitCommit; labelKey: string }[] = [
  { mode: "commits", icon: GitCommit, labelKey: "history.viewMode.commits" },
  { mode: "sessions", icon: Bot, labelKey: "history.viewMode.sessions" },
];

/**
 * Commits, or commits grouped by the session that produced them. A session is
 * a way of viewing history (spec V30), which is why this is a mode rather than
 * a place of its own.
 */
export function HistoryViewModeToggle({
  mode,
  onChange,
  className,
}: HistoryViewModeToggleProps) {
  const { t } = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t("history.title")}
      className={cn("flex items-center gap-1", className)}
    >
      {MODES.map((entry) => {
        const Icon = entry.icon;
        const isActive = mode === entry.mode;
        return (
          <button
            key={entry.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(entry.mode)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium leading-none transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3 shrink-0" />
            {t(entry.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
