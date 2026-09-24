import { useId } from "react";
import { useTranslation } from "react-i18next";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";
import { LiveDot } from "./RowBadges";
import { liveAvatarStack, type LiveEntry } from "./tree-model";

const AVATAR_STACK_MAX = 3;

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

function repoAvatar(key: string, name: string, path: string, size: number, className?: string) {
  const color = avatarColor(path);
  return (
    <span
      key={key}
      aria-hidden="true"
      className={cn("rounded-full flex items-center justify-center font-extrabold shrink-0", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        backgroundColor: color.background,
        color: color.foreground,
      }}
    >
      {avatarInitial(name)}
    </span>
  );
}

/**
 * 「지금 파일이 바뀌는 곳」 카드(W-Top-T4). 트리 단계가 아니라 알림이라, 계정 머리글과는 다른
 * 생김새(▾ 없음, 대문자 라벨 없음)로 사이드바 맨 위에 검색 줄 바로 아래 고정한다. 접으면 한 줄
 * (점 · 「지금 바뀌는 중 N」 · 저장소 아바타 무더기 · 가장 최근 시각)이고, 펼치면 저장소마다
 * 한 줄씩(계정/저장소 행보다 작은 글자, 옅은 선택 배경)을 보여 준다.
 */
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
  const hasActivity = entries.length > 0;
  const stack = liveAvatarStack(entries, AVATAR_STACK_MAX);

  const ago = (at: number) => {
    const seconds = Math.max(0, Math.floor((now - at) / 1000));
    return seconds < 60
      ? t("sidebarTree.live.seconds", { count: seconds })
      : t("sidebarTree.live.minutes", { count: Math.floor(seconds / 60) });
  };

  return (
    <section
      aria-label={t("sidebarTree.live.title")}
      className="shrink-0 mx-0.5 mb-2 rounded-(--radius-item) border border-(--line2) bg-(--acc-faint) overflow-hidden"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={listId}
        className="w-full flex items-center gap-2 h-8 px-2 text-left hover:bg-[color-mix(in_srgb,var(--panel)_50%,transparent)]"
      >
        <span
          aria-hidden="true"
          className={cn(
            "w-[7px] h-[7px] rounded-full shrink-0",
            hasActivity ? "bg-[var(--live)] shadow-[0_0_0_3px_var(--live-soft)]" : "bg-[var(--ln)]",
          )}
        />
        <span className="text-[11.5px] font-semibold text-(--fg2) truncate">
          {t("sidebarTree.live.collapsedTitle", { count: entries.length })}
        </span>
        {!expanded && hasActivity && (
          <>
            <span className="flex items-center shrink-0 -space-x-1.5 ml-0.5">
              {stack.shown.map((repo) =>
                repoAvatar(repo.path, repo.name, repo.path, 16, "ring-2 ring-(--acc-faint) text-[9px]"),
              )}
              {stack.overflow > 0 && (
                <span
                  aria-hidden="true"
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold bg-muted text-muted-foreground ring-2 ring-(--acc-faint)"
                >
                  {t("sidebarTree.live.overflow", { count: stack.overflow })}
                </span>
              )}
            </span>
            <span className="flex-1" />
            <span className="text-[10.5px] text-[var(--faint)] tabular-nums shrink-0">{ago(entries[0].at)}</span>
          </>
        )}
      </button>
      {expanded && (
        <ul id={listId} className="flex flex-col border-t border-(--line2)">
          {entries.length === 0 && (
            <li className="px-2.5 h-6 flex items-center text-[11px] text-[var(--faint)]">
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
                  "w-full flex items-center gap-1.5 h-6 px-2.5 text-left",
                  activePath === entry.path
                    ? "bg-[color-mix(in_srgb,var(--acc)_8%,transparent)]"
                    : "hover:bg-[color-mix(in_srgb,var(--panel)_50%,transparent)]",
                )}
              >
                <LiveDot watched={isWatched(entry.path)} className="shrink-0" />
                {repoAvatar(`${entry.path}-avatar`, entry.repo.name, entry.repo.path, 14, "text-[8px]")}
                <span className="flex-1 min-w-0 truncate text-[12px] text-[var(--fg2)]">
                  {entry.repo.name}
                  {entry.branch && (
                    <span className="ml-1 font-mono text-[10.5px] text-[var(--faint)]">{entry.branch}</span>
                  )}
                </span>
                <span className="text-[10.5px] text-[var(--faint)] tabular-nums shrink-0">{ago(entry.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
