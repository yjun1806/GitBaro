import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Code, Info, Palette, RefreshCw, SlidersHorizontal, Users } from "lucide-react";
import type { AppSettings, GitHubAccount } from "@/types";
import { notificationSettingsOf } from "@/lib/notify/target";
import { usePreferencesStore } from "@/stores/preferences";
import { AccountSettings } from "./AccountSettings";
import { NotificationSettings } from "./NotificationSettings";
import { AutoSyncFields } from "./AutoSyncFields";
import { GeneralSection } from "./app/GeneralSection";
import { AppearanceSection } from "./app/AppearanceSection";
import { ToolsSection } from "./app/ToolsSection";
import { AboutSection } from "./app/AboutSection";
import { SettingsShell } from "./ui/SettingsShell";
import { SettingsSection } from "./ui/SettingsSection";
import type { SettingsNavItem } from "./ui/SettingsNav";

export type AppSettingsSection = "general" | "appearance" | "accounts" | "tools" | "notifications" | "sync" | "about";

interface SettingsPanelProps {
  settings: AppSettings;
  accounts: GitHubAccount[];
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onRemoveAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onSyncAccounts: () => Promise<void>;
  onClose: () => void;
  /** 처음 보일 칸. 계정 메뉴의 「계정 관리」는 계정 칸으로 연다. */
  initialSection?: AppSettingsSection;
}

/**
 * 앱 전체 설정 창. 왼쪽에서 칸을 고르면 오른쪽에 그 칸의 카드가 나온다.
 * 바꾸는 즉시 저장한다(저장 버튼 없음). 저장소 하나에만 적용하는 설정은 저장소 설정 창에 있다.
 */
export function SettingsPanel({
  settings,
  accounts,
  onUpdateSettings,
  onRemoveAccount,
  onAddAccount,
  onSyncAccounts,
  onClose,
  initialSection = "general",
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<AppSettingsSection>(initialSection);
  const defaultAutoSync = usePreferencesStore((s) => s.defaultAutoSync);
  const setPreferences = usePreferencesStore((s) => s.setPreferences);

  const items: SettingsNavItem<AppSettingsSection>[] = [
    { id: "general", label: t("settingsPanel.nav.general"), icon: SlidersHorizontal },
    { id: "appearance", label: t("settingsPanel.nav.appearance"), icon: Palette },
    { id: "accounts", label: t("settingsPanel.nav.accounts"), icon: Users },
    { id: "tools", label: t("settingsPanel.nav.tools"), icon: Code },
    { id: "notifications", label: t("settingsPanel.nav.notifications"), icon: Bell },
    { id: "sync", label: t("settingsPanel.nav.sync"), icon: RefreshCw },
    { id: "about", label: t("settingsPanel.nav.about"), icon: Info },
  ];

  return (
    <SettingsShell
      title={t("settings.title")}
      subtitle={t("settingsPanel.subtitle")}
      items={items}
      active={active}
      onSelect={setActive}
      onClose={onClose}
    >
      {active === "general" && <GeneralSection settings={settings} onUpdateSettings={onUpdateSettings} />}
      {active === "appearance" && <AppearanceSection settings={settings} onUpdateSettings={onUpdateSettings} />}
      {active === "accounts" && (
        <AccountSettings
          accounts={accounts}
          onRemove={onRemoveAccount}
          onAddAccount={onAddAccount}
          onSyncAccounts={onSyncAccounts}
        />
      )}
      {active === "tools" && <ToolsSection settings={settings} onUpdateSettings={onUpdateSettings} />}
      {active === "notifications" && (
        <NotificationSettings
          value={notificationSettingsOf(settings.notifications)}
          onChange={(notifications) => onUpdateSettings({ notifications })}
        />
      )}
      {active === "sync" && (
        <SettingsSection title={t("settingsPanel.sync.title")} description={t("settingsPanel.sync.description")}>
          <AutoSyncFields value={defaultAutoSync} onChange={(next) => setPreferences({ defaultAutoSync: next })} />
        </SettingsSection>
      )}
      {active === "about" && <AboutSection />}
    </SettingsShell>
  );
}
