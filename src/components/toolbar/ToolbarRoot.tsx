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
import { SettingsPanel, type AppSettingsSection } from "@/components/settings/SettingsPanel";
import { HEADER_HEIGHT_CLASS } from "@/lib/layout-tokens";
import { HiddenSidebarLead } from "@/components/layout/SidebarToggle";
import { ToolbarDropdownContext, useToolbarDropdown } from "./useToolbarDropdown";
import { BranchZone } from "./BranchZone";
import { WorktreeZone } from "./WorktreeZone";
import { CrumbSeparator, RepoCrumb } from "./RepoCrumb";
import { GitActionZone } from "./GitActionZone";
import { AccountZone } from "./AccountZone";
import { ActionGroup } from "./ActionButton";
import { TOOLBAR_GROUP_SHRINKABLE, TOOLBAR_ICON, toolbarButtonClass } from "./toolbar-button";
import type { AppSettings } from "@/types";
import { useActiveScope } from "@/hooks/useActiveScope";

export function ToolbarRoot() {
  const dropdown = useToolbarDropdown();
  const { activeDropdown, toggle, close } = dropdown;
  const scope = useActiveScope();

  const [showLoginDialog, setShowLoginDialog] = useState(false);
  /** 다시 로그인할 계정. 로그인 창이 GitHub에서 이 계정으로 승인하라고 안내한다. */
  const [loginHint, setLoginHint] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<AppSettingsSection>("general");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const accounts = useAccountStore((s) => s.accounts);
  const logout = useAccountStore((s) => s.logout);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const setTheme = useUIStore((s) => s.setTheme);
  const sidebarHidden = useUIStore((s) => s.sidebarHidden);
  const { t, i18n } = useTranslation();

  const handleOpenSettings = async (section: AppSettingsSection = "general") => {
    setSettingsSection(section);
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
      {/* 머리 줄: 44px 한 줄 flex(items-center). 안의 모든 버튼은 28px 툴바 버튼(toolbar-button.ts)이라
          한 가로 중심선에 놓인다. 오른쪽 버튼은 관련된 것끼리 흰 카드(34px, TOOLBAR_GROUP)에 담고
          카드 사이는 6px 틈으로 나눈다. 좌우 여백 8px. 사이드바를 숨기면 왼쪽 여백 대신 트래픽 라이트
          자리가 맨 앞에 온다. */}
      <div
        className={cn(
          "@container flex items-center gap-1.5 border-b border-(--line) bg-(--frame) select-none",
          sidebarHidden ? "pr-2" : "px-2",
          HEADER_HEIGHT_CLASS,
        )}
      >
        {/* macOS 트래픽 라이트는 창의 맨 왼쪽 위에 있다. 사이드바가 보이면 그 자리 예약은 RepoRail의
            머리글이 지고, 숨기면 여기서 예약하고 사이드바를 다시 여는 버튼을 둔다(TRAFFIC_LIGHT_INSET_PX). */}
        <HiddenSidebarLead />
        {scope?.kind === "workspace" ? (
          <>
            {/* 워크스페이스 리뷰 화면(W4-T3)이 제목을 이 자리에 portal로 그린다. */}
            <div
              className="flex items-center flex-1 min-w-[40px] h-full"
              data-tauri-drag-region
              data-toolbar-title-slot
            />
            <GitActionZone mode="workspace" paths={scope.paths} />
          </>
        ) : (
          <>
            {/* 지금 맥락 경로: 저장소 › 폴더(워크트리) › 브랜치. 사이드바 계층과 같은 순서다.
                오른쪽 묶음과 같은 흰 카드(TOOLBAR_GROUP_SHRINKABLE)에 담아 머리 줄 모양을 통일한다.
                폴더 칸은 워크트리 패널을, 브랜치 칸은 브랜치 패널을 각자의 트리거 아래에 연다. */}
            <nav aria-label={t("toolbar.placePath")} className={TOOLBAR_GROUP_SHRINKABLE}>
              <RepoCrumb />
              <CrumbSeparator />
              <WorktreeZone
                isOpen={activeDropdown === "worktree"}
                onToggle={() => toggle("worktree")}
                onClose={close}
              />
              <CrumbSeparator />
              <BranchZone
                isOpen={activeDropdown === "branch"}
                onToggle={() => toggle("branch")}
                onClose={close}
              />
            </nav>

            {/* Drag region */}
            <div className="flex-1 min-w-4 h-full" data-tauri-drag-region />

            {/* Zone B: git 작업 묶음 */}
            <GitActionZone mode="repo" />
          </>
        )}

        {/* Zone C·D: 계정 + 설정 */}
        <ActionGroup label={t("toolbar.accountGroup")}>
          <AccountZone
            isOpen={activeDropdown === "account"}
            onToggle={() => toggle("account")}
            onClose={close}
            onSignIn={() => {
              setLoginHint(null);
              setShowLoginDialog(true);
            }}
            onManageAccounts={() => void handleOpenSettings("accounts")}
          />
          <button
            onClick={() => void handleOpenSettings()}
            className={toolbarButtonClass({ iconOnly: true })}
            title={t("common.settings")}
            aria-label={t("common.settings")}
          >
            <Settings className={TOOLBAR_ICON} />
          </button>
        </ActionGroup>
      </div>

      {showLoginDialog && (
        <GhLoginDialog
          expectedUsername={loginHint ?? undefined}
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
            setLoginHint(null);
            setShowLoginDialog(true);
          }}
          onSignInAgain={(username) => {
            setShowSettings(false);
            setLoginHint(username);
            setShowLoginDialog(true);
          }}
          onSyncAccounts={handleSyncAccounts}
          onClose={() => setShowSettings(false)}
          initialSection={settingsSection}
        />
      )}
    </ToolbarDropdownContext.Provider>
  );
}
