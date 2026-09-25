import { useTranslation } from "react-i18next";
import type { AppSettings } from "@/types";
import { useUIStore, type DiffLineMode } from "@/stores/ui";
import { CODE_FONT_SIZES, usePreferencesStore } from "@/stores/preferences";
import { ThemeSelector } from "../ThemeSelector";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Segmented } from "../ui/Segmented";

interface AppearanceSectionProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}

/** 「모양」 칸: 테마, diff 기본 보기와 코드 글자 크기. */
export function AppearanceSection({ settings, onUpdateSettings }: AppearanceSectionProps) {
  const { t } = useTranslation();
  const diffLineMode = useUIStore((s) => s.diffLineMode);
  const setDiffLineMode = useUIStore((s) => s.setDiffLineMode);
  const codeFontSize = usePreferencesStore((s) => s.codeFontSize);
  const setPreferences = usePreferencesStore((s) => s.setPreferences);

  return (
    <>
      <SettingsSection>
        <SettingsRow label={t("settings.theme")}>
          <ThemeSelector value={settings.theme} onChange={(theme) => onUpdateSettings({ theme })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settingsPanel.appearance.diff")}>
        <SettingsRow
          label={t("settingsPanel.appearance.diffLayout")}
          description={t("settingsPanel.appearance.diffLayoutDescription")}
        >
          <Segmented<DiffLineMode>
            value={diffLineMode}
            onChange={setDiffLineMode}
            options={[
              { value: "unified", label: t("diff.unified") },
              { value: "split", label: t("diff.split") },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settingsPanel.appearance.codeFontSize")}
          description={
            <span className="font-mono text-foreground" style={{ fontSize: codeFontSize }}>
              {t("settingsPanel.appearance.codeSample")}
            </span>
          }
        >
          <Segmented
            value={String(codeFontSize)}
            onChange={(value) => setPreferences({ codeFontSize: Number(value) })}
            options={CODE_FONT_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
