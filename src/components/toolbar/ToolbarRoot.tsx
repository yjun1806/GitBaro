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
import { cn, getErrorMessage } from "@/lib/utils";
import { GhLoginDialog } from "@/components/account/GhLoginDialog";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { HEADER_HEIGHT_CLASS } from "@/lib/layout-tokens";
import { ToolbarDropdownContext, useToolbarDropdown } from "./useToolbarDropdown";
import { BranchZone } from "./BranchZone";
import { WorktreeZone } from "./WorktreeZone";
import { GitActionZone } from "./GitActionZone";
import { AccountZone } from "./AccountZone";
import type { AppSettings } from "@/types";
import { useActiveScope } from "@/hooks/useActiveScope";

export function ToolbarRoot() {
  const dropdown = useToolbarDropdown();
  const { activeDropdown, toggle, close } = dropdown;
  const scope = useActiveScope();

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
    <ToolbarDropdownContext.Provider value={dropdown}>
      {/* @container: 툴바 폭에 따라 git 작업 버튼 이름을 숨긴다(ActionButton의 TOOLBAR_LABEL_CLASS). */}
      <div className={cn("@container flex items-center border-b border-(--line2) bg-(--frame) select-none", HEADER_HEIGHT_CLASS)}>
        {/* macOS 트래픽 라이트는 사이드바 쪽(맨 왼쪽 위 모서리)에 있다 — 그 자리 예약은
            RepoRail의 머리글이 진다(TRAFFIC_LIGHT_INSET_PX, layout-tokens.ts). */}
        {scope?.kind === "workspace" ? (
          <>
            {/* 워크스페이스 리뷰 화면(W4-T3)이 제목을 이 자리에 portal로 그린다. */}
            <div
              className="flex items-center flex-1 min-w-[40px] h-full pl-1"
              data-tauri-drag-region
              data-toolbar-title-slot
            />
            <GitActionZone mode="workspace" paths={scope.paths} />
          </>
        ) : (
          <>
            {/* 지금 맥락 제목 블록: 저장소 아바타 + 이름 + 브랜치(Zone A) + 워크트리 칩(Zone A2).
                시안 `repo_title()`(gen_d2.py:108-112) 자리 — 브랜치 패널·워크트리 패널 모두
                각자의 트리거 바로 아래에 anchor해서 연다(AnchoredPanel). */}
            <div className="flex items-center gap-1.5 h-full pl-1 pr-2 min-w-0 shrink">
              <BranchZone
                isOpen={activeDropdown === "branch"}
                onToggle={() => toggle("branch")}
                onClose={close}
              />
              <WorktreeZone
                isOpen={activeDropdown === "worktree"}
                onToggle={() => toggle("worktree")}
                onClose={close}
              />
            </div>

            {/* Drag region */}
            <div className="flex-1 min-w-4 h-full" data-tauri-drag-region />

            {/* Zone B: git 작업 묶음 */}
            <GitActionZone mode="repo" />
          </>
        )}

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
          className={cn("flex items-center justify-center w-[42px] hover:bg-(--frame-hover) transition-colors text-muted-foreground hover:text-foreground shrink-0", HEADER_HEIGHT_CLASS)}
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
    </ToolbarDropdownContext.Provider>
  );
}
