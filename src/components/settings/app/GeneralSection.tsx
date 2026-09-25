import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RotateCcw } from "lucide-react";
import type { AppSettings } from "@/types";
import { QUIET_MINUTES_OPTIONS, usePreferencesStore } from "@/stores/preferences";
import { useUIStore } from "@/stores/ui";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Switch } from "../ui/Switch";
import { SettingsSelect } from "../ui/controls";
import { SETTINGS_BUTTON } from "../ui/styles";

interface GeneralSectionProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}

/** 「일반」 칸: 언어, 사이드바 숨기기와 조용한 저장소, 새 워크트리 위치. */
export function GeneralSection({ settings, onUpdateSettings }: GeneralSectionProps) {
  const { t } = useTranslation();
  const collapseQuietRepos = usePreferencesStore((s) => s.collapseQuietRepos);
  const quietMinutes = usePreferencesStore((s) => s.quietMinutes);
  const worktreeParentDir = usePreferencesStore((s) => s.worktreeParentDir);
  const setPreferences = usePreferencesStore((s) => s.setPreferences);
  const sidebarHidden = useUIStore((s) => s.sidebarHidden);
  const setSidebarHidden = useUIStore((s) => s.setSidebarHidden);

  const handlePickWorktreeDir = async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: worktreeParentDir ?? undefined });
    if (typeof picked === "string") setPreferences({ worktreeParentDir: picked });
  };

  return (
    <>
      <SettingsSection>
        <SettingsRow label={t("settings.language")}>
          <SettingsSelect
            value={settings.language}
            options={[
              { value: "en", label: "English" },
              { value: "ko", label: "한국어" },
            ]}
            onChange={(language) => onUpdateSettings({ language })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settingsPanel.general.sidebar")}>
        <SettingsRow
          label={t("settingsPanel.general.hideSidebar")}
          description={t("settingsPanel.general.hideSidebarDescription")}
        >
          <Switch checked={sidebarHidden} onChange={setSidebarHidden} />
        </SettingsRow>
        <SettingsRow
          label={t("settingsPanel.general.collapseQuiet")}
          description={t("settingsPanel.general.collapseQuietDescription")}
        >
          <Switch checked={collapseQuietRepos} onChange={(checked) => setPreferences({ collapseQuietRepos: checked })} />
        </SettingsRow>
        <SettingsRow
          label={t("settingsPanel.general.quietMinutes")}
          description={t("settingsPanel.general.quietMinutesDescription")}
        >
          <SettingsSelect
            value={String(quietMinutes)}
            disabled={!collapseQuietRepos}
            options={QUIET_MINUTES_OPTIONS.map((m) => ({
              value: String(m),
              label: t("settingsPanel.general.minutes", { count: m }),
            }))}
            onChange={(value) => setPreferences({ quietMinutes: Number(value) })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settingsPanel.general.worktrees")}>
        <SettingsRow
          stacked
          label={t("settingsPanel.general.worktreeDir")}
          description={t("settingsPanel.general.worktreeDirDescription")}
        >
          <div className="flex items-center gap-2 min-w-0">
            <code
              className="flex-1 min-w-0 truncate rounded-(--radius-chip) bg-(--chip) px-2 py-1 font-mono text-[11.5px] text-(--fg2)"
              title={worktreeParentDir ?? undefined}
            >
              {worktreeParentDir ?? t("settingsPanel.general.worktreeDirDefault")}
            </code>
            <button type="button" onClick={handlePickWorktreeDir} className={SETTINGS_BUTTON}>
              <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
              {t("settingsPanel.general.chooseFolder")}
            </button>
            {worktreeParentDir && (
              <button type="button" onClick={() => setPreferences({ worktreeParentDir: null })} className={SETTINGS_BUTTON}>
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                {t("settingsPanel.useDefault")}
              </button>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
