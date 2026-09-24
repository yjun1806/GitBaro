import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LiveDot } from "./RowBadges";
import type { LiveEntry } from "./tree-model";

interface LiveNowSectionProps {
  entries: LiveEntry[];
  /** 경로가 실시간 감시 중인지. 아니면 작업 중 점을 흐리게 그린다. */
  isWatched: (path: string) => boolean;
  now: number;
  /** 지금 보고 있는 경로. 같은 줄을 선택된 것으로 그린다. */
  activePath: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (entry: LiveEntry) => void;
}

/** 「지금 파일이 바뀌는 곳」: 10분 안에 파일이 바뀐 저장소·워크트리를 최근 순으로 보여 준다. */
export function LiveNowSection({
  entries,
  isWatched,
  now,
  activePath,
  expanded,
  onToggle,
  onSelect,
}: LiveNowSectionProps) {
  const { t } = useTranslation();
  const listId = useId();

  const ago = (at: number) => {
    const seconds = Math.max(0, Math.floor((now - at) / 1000));
    return seconds < 60
      ? t("sidebarTree.live.seconds", { count: seconds })
      : t("sidebarTree.live.minutes", { count: Math.floor(seconds / 60) });
  };

  return (
    <section aria-label={t("sidebarTree.live.title")} className="shrink-0 mb-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={listId}
        className="w-full flex items-center gap-1.5 min-h-[var(--row)] pl-1.5 pr-2 rounded-[var(--radius-item)] text-left hover:bg-[color-mix(in_srgb,var(--panel)_60%,transparent)]"
      >
        <span className="w-2.5 flex items-center justify-center shrink-0" aria-hidden="true">
          <ChevronDown
            className={cn("w-2.5 h-2.5 text-[var(--faint)] transition-transform", !expanded && "-rotate-90")}
            strokeWidth={2.6}
          />
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "w-[7px] h-[7px] rounded-full shrink-0",
            entries.length > 0
              ? "bg-[var(--live)] shadow-[0_0_0_3px_var(--live-soft)]"
              : "bg-[var(--ln)]",
          )}
        />
        <span className="text-[10.5px] font-bold tracking-[0.06em] text-muted-foreground truncate">
          {t("sidebarTree.live.title")}
        </span>
        <span className="text-[10.5px] text-[var(--faint)] tabular-nums">{entries.length}</span>
      </button>
      {expanded && (
        <ul id={listId} className="flex flex-col">
          {entries.length === 0 && (
            <li className="pl-[22px] pr-2 min-h-[var(--row)] flex items-center text-[11.5px] text-[var(--faint)]">
              {t("sidebarTree.live.empty")}
            </li>
          )}
          {entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                title={entry.path}
                className={cn(
                  "w-full flex items-center gap-2 min-h-[var(--row)] pl-[22px] pr-2 rounded-[var(--radius-item)] text-left",
                  activePath === entry.path
                    ? "bg-card shadow-[var(--shadow-sm)]"
                    : "hover:bg-[color-mix(in_srgb,var(--panel)_60%,transparent)]",
                )}
              >
                <LiveDot watched={isWatched(entry.path)} className="shrink-0" />
                <span className="flex-1 min-w-0 truncate text-xs text-[var(--fg2)]">
                  {entry.repo.name}
                  {entry.branch && (
                    <span className="ml-1 font-mono text-[10.5px] text-[var(--faint)]">{entry.branch}</span>
                  )}
                </span>
                <span className="text-[11px] text-[var(--faint)] tabular-nums shrink-0">{ago(entry.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
