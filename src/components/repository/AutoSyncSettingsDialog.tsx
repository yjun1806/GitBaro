import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useRepositoryStore } from "@/stores/repository";
import { useAutoSyncStore } from "@/stores/auto-sync";
import { AUTO_SYNC_INTERVALS, AUTO_SYNC_MODES, resolveAutoSync } from "@/lib/auto-sync";
import { cn } from "@/lib/utils";
import type { AutoSyncIntervalMinutes, AutoSyncMode, RepoInfo } from "@/types";

interface AutoSyncSettingsDialogProps {
  repo: RepoInfo;
  onClose: () => void;
}

/** 저장소 하나의 원격 자동 최신화 방식과 주기를 고르는 창. */
export function AutoSyncSettingsDialog({ repo, onClose }: AutoSyncSettingsDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const current = useRepositoryStore((s) => resolveAutoSync(s.autoSyncByRepo, repo.path));
  const setAutoSync = useRepositoryStore((s) => s.setAutoSync);
  const [mode, setMode] = useState<AutoSyncMode>(current.mode);
  const [intervalMinutes, setIntervalMinutes] = useState<AutoSyncIntervalMinutes>(
    current.intervalMinutes,
  );

  const intervalOptions = AUTO_SYNC_INTERVALS.map((minutes) => ({
    value: String(minutes),
    label: t("autoSync.interval", { count: minutes }),
  }));

  const handleSave = () => {
    setAutoSync(repo.path, { mode, intervalMinutes });
    onClose();
  };

  return (
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      className="bg-card rounded-xl shadow-2xl w-full max-w-md mx-4"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="min-w-0">
          <h3 id={titleId} className="text-base font-semibold text-primary">
            {t("autoSync.dialogTitle")}
          </h3>
          <p className="text-xs text-muted-foreground truncate">{repo.name}</p>
        </div>
        <button
          onClick={onClose}
          aria-label={t("common.cancel")}
          className="text-muted-foreground hover:text-primary"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground mb-1.5">
            {t("autoSync.modeLabel")}
          </legend>
          {AUTO_SYNC_MODES.map((option) => (
            <label
              key={option}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                mode === option ? "border-primary/40 bg-primary/5" : "border-border hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name="auto-sync-mode"
                value={option}
                checked={mode === option}
                onChange={() => setMode(option)}
                className="mt-0.5 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(`autoSync.mode.${option}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`autoSync.modeDescription.${option}`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {mode === "pull" && (
          <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
            <span>{t("autoSync.pullSafety")}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("autoSync.intervalLabel")}</p>
          <Select
            value={String(intervalMinutes)}
            options={intervalOptions}
            disabled={mode === "off"}
            onChange={(value) => {
              const minutes = AUTO_SYNC_INTERVALS.find((m) => String(m) === value);
              if (minutes !== undefined) setIntervalMinutes(minutes);
            }}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-sm rounded-lg hover:bg-muted text-muted-foreground"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-1.5 text-sm rounded-lg font-medium transition-colors bg-primary hover:bg-primary-hover text-primary-foreground"
        >
          {t("autoSync.save")}
        </button>
      </div>
    </Dialog>
  );
}

/** 어느 메뉴에서 열었든 설정 창을 한 곳에서 띄운다. 메뉴는 누르는 즉시 닫히기 때문이다. */
export function AutoSyncSettingsDialogHost() {
  const repoPath = useAutoSyncStore((s) => s.settingsRepoPath);
  const closeSettings = useAutoSyncStore((s) => s.closeSettings);
  const repo = useRepositoryStore((s) => s.repos.find((r) => r.path === repoPath) ?? null);
  if (!repo) return null;
  return <AutoSyncSettingsDialog key={repo.path} repo={repo} onClose={closeSettings} />;
}
