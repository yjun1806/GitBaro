import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import { useAutoSyncStore, type AutoSyncResult } from "@/stores/auto-sync";
import { canAutoSync, resolveAutoSync } from "@/lib/auto-sync";
import { cn, formatRelativeTime } from "@/lib/utils";

/** "2분 전" 같은 상대 시각이 멈춰 보이지 않도록 다시 그리는 간격. */
const RELATIVE_TIME_REFRESH_MS = 30 * 1000;

function useNowTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), RELATIVE_TIME_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
}

/**
 * 툴바 동기화 버튼 옆의 작은 안내. 열린 저장소의 자동 최신화 방식·주기와
 * 마지막 자동 결과를 보여주고, 누르면 설정 창을 연다. 꺼 두었으면 아무것도 그리지 않는다.
 */
export function AutoSyncHint() {
  const { t } = useTranslation();
  useNowTick();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerPath = useOwnerRepoPath();
  const setting = useRepositoryStore((s) =>
    ownerPath ? resolveAutoSync(s.autoSyncByRepo, ownerPath) : null,
  );
  // 계정과 원격이 있어야 자동 최신화가 돈다(canAutoSync). 없으면 안내도 하지 않는다.
  const canRun = useRepositoryStore((s) => {
    const repo = s.repos.find((r) => r.path === ownerPath);
    return repo ? canAutoSync(repo) : false;
  });
  const lastResult = useAutoSyncStore((s) =>
    ownerPath ? s.lastResultByRepo[ownerPath] ?? null : null,
  );
  const openSettings = useAutoSyncStore((s) => s.openSettings);

  if (!ownerPath || !setting || setting.mode === "off" || !canRun) return null;

  // 연결된 워크트리는 자동으로 받지 않는다. 그 안에서는 확인만 한다고 알린다.
  const inLinkedWorktree = activeRepoPath !== null && activeRepoPath !== ownerPath;
  const effectiveMode = setting.mode === "pull" && inLinkedWorktree ? "fetch" : setting.mode;
  const interval = t("autoSync.intervalShort", { count: setting.intervalMinutes });
  const modeLabel = t(`autoSync.hint.${effectiveMode}`, { interval });

  const tooltip = [
    inLinkedWorktree && setting.mode === "pull" ? t("autoSync.worktreeNote") : null,
    lastResult && !lastResult.ok ? lastResult.error : null,
    t("autoSync.openSettings"),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return (
    <button
      type="button"
      onClick={() => openSettings(ownerPath)}
      title={tooltip}
      className="flex flex-col items-end justify-center h-8 px-1.5 mr-1 rounded-md leading-tight hover:bg-accent transition-colors"
    >
      <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
        {modeLabel}
      </span>
      {lastResult && <LastResultLine result={lastResult} />}
    </button>
  );
}

function LastResultLine({ result }: { result: AutoSyncResult }) {
  const { t } = useTranslation();
  const time = formatRelativeTime(Math.floor(result.at / 1000));
  const text = !result.ok
    ? t("autoSync.last.failed", { time })
    : result.fastForwarded > 0
      ? t("autoSync.last.pulled", { time, count: result.fastForwarded })
      : t("autoSync.last.fetched", { time });
  return (
    <span
      className={cn(
        "text-[10px] whitespace-nowrap",
        result.ok ? "text-muted-foreground/70" : "text-warning",
      )}
    >
      {text}
    </span>
  );
}
