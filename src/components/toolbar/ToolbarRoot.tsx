import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { useAccountStore } from "@/stores/account";
import {
  getAccounts,
  getSettings,
  updateSettings as updateSettingsApi,
  removeAccount as removeAccountApi,
} from "@/api/commands";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";
import { GhLoginDialog } from "@/components/account/GhLoginDialog";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { useToolbarDropdown } from "./useToolbarDropdown";
import { BranchZone } from "./BranchZone";
import { SyncZone } from "./SyncZone";
import { AccountZone } from "./AccountZone";
import type { AppSettings } from "@/types";

export function ToolbarRoot() {
  const { activeDropdown, toggle, close } = useToolbarDropdown();

  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const accounts = useAccountStore((s) => s.accounts);
  const logout = useAccountStore((s) => s.logout);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const setTheme = useUIStore((s) => s.setTheme);
  const { t, i18n } = useTranslation();

  const handleOpenSettings = async () => {
    try {
      const settings = await getSettings();
      setAppSettings(settings);
    } catch {
      setAppSettings({
        theme: "system",
        language: "ko",
        defaultEditor: "",

        autoFetchInterval: 0,
      } as AppSettings);
    }
    setShowSettings(true);
  };

  const handleSyncAccounts = async () => {
    try {
      const loaded = await getAccounts();
      const { setAccounts, setActiveAccount } = useAccountStore.getState();
      setAccounts(loaded);
      if (loaded.length > 0) {
        const currentId = useAccountStore.getState().activeAccountId;
        const stillExists = loaded.some((a) => a.id === currentId);
        if (!stillExists) {
          setActiveAccount(loaded[0].id);
        }
      }
      addToast(t("ghSync.syncSuccess", { count: loaded.length }), "success");
    } catch (err) {
      addToast(t("ghSync.syncFailed", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    try {
      await removeAccountApi(accountId);
      logout(accountId);
    } catch (err) {
      addToast(t("error.failedToLogout", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleUpdateSettings = async (patch: Partial<AppSettings>) => {
    if (!appSettings) return;
    const updated = { ...appSettings, ...patch };
    setAppSettings(updated);
    if (patch.theme) {
      setTheme(patch.theme);
    }
    if (patch.language) {
      i18n.changeLanguage(patch.language);
    }
    try {
      await updateSettingsApi(updated);
    } catch (err) {
      addToast(t("error.failedToUpdateSettings", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleLoginSuccess = () => {
    setShowLoginDialog(false);
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["ghStatus"] });
    queryClient.invalidateQueries({ queryKey: ["tokenValidation"] });
    import("@/api/commands").then(({ getAccounts }) =>
      getAccounts()
        .then((loaded) => {
          const { setAccounts } = useAccountStore.getState();
          setAccounts(loaded);
        })
        .catch(() => {}),
    );
  };

  return (
    <>
      <div className="flex items-center h-[52px] border-b border-border bg-surface select-none">
        {/* Zone A: Branch */}
        <BranchZone
          isOpen={activeDropdown === "branch"}
          onToggle={() => toggle("branch")}
          onClose={close}
        />

        {/* Drag region */}
        <div className="flex-1 min-w-[40px] h-full" data-tauri-drag-region />

        {/* Zone B: Sync */}
        <SyncZone
          isOpen={activeDropdown === "sync"}
          onToggle={() => toggle("sync")}
          onClose={close}
        />

        {/* Divider */}
        <div className="w-px h-6 bg-border shrink-0" />

        {/* Zone C: Account */}
        <AccountZone
          isOpen={activeDropdown === "account"}
          onToggle={() => toggle("account")}
          onClose={close}
          onSignIn={() => setShowLoginDialog(true)}
          onManageAccounts={handleOpenSettings}
        />

        {/* Divider */}
        <div className="w-px h-6 bg-border shrink-0" />

        {/* Zone D: Settings */}
        <button
          onClick={handleOpenSettings}
          className="flex items-center justify-center w-[42px] h-[52px] hover:bg-accent transition-colors text-muted-foreground hover:text-foreground shrink-0"
          title={t("common.settings")}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {showLoginDialog && (
        <GhLoginDialog
          onClose={() => setShowLoginDialog(false)}
          onSuccess={handleLoginSuccess}
        />
      )}

      {showSettings && appSettings && (
        <SettingsPanel
          settings={appSettings}
          accounts={accounts}
          onUpdateSettings={handleUpdateSettings}
          onRemoveAccount={handleRemoveAccount}
          onAddAccount={() => {
            setShowSettings(false);
            setShowLoginDialog(true);
          }}
          onSyncAccounts={handleSyncAccounts}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
