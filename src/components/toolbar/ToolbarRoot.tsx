import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Folder,
  GitBranch,
  GitMerge,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";
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
import { WorktreeZone } from "./WorktreeZone";
import { SyncZone } from "./SyncZone";
import { AccountZone } from "./AccountZone";
import type { AppSettings } from "@/types";
import { useActiveScope } from "@/hooks/useActiveScope";
import { useWorkspaceStore } from "@/stores/workspace";

/** 워크스페이스 모드에서 꺼 두는 저장소 전용 동작. 시안 툴바의 두 묶음과 같은 순서다. */
const REPO_ONLY_ACTIONS: { key: string; icon: LucideIcon; labelKey: string }[][] = [
  [
    { key: "fetch", icon: RefreshCw, labelKey: "activeScope.actions.fetch" },
    { key: "pull", icon: ArrowDown, labelKey: "activeScope.actions.pull" },
    { key: "push", icon: ArrowUp, labelKey: "activeScope.actions.push" },
  ],
  [
    { key: "branch", icon: GitBranch, labelKey: "activeScope.actions.branch" },
    { key: "merge", icon: GitMerge, labelKey: "activeScope.actions.merge" },
    { key: "stash", icon: Archive, labelKey: "activeScope.actions.stash" },
  ],
];

/**
 * 워크스페이스를 고른 동안 저장소 전용 영역(브랜치·워크트리·동기화) 대신 보이는 자리.
 * 여러 저장소 Fetch·Pull·Push는 W5에서 붙는다. 그때까지 모든 버튼을 끄고 「저장소를 고르세요」를 알린다.
 * 꺼진 버튼은 마우스 이벤트를 받지 않아 툴팁이 뜨지 않으므로, 툴팁은 감싼 span에 단다.
 */
function WorkspaceModeZone({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const name = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === workspaceId)?.name ?? "",
  );
  const hint = t("activeScope.pickRepo");
  return (
    <>
      <div className="flex items-center gap-2 min-w-0 pl-3 pr-2 shrink">
        <Folder className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-semibold truncate max-w-[240px]">{name}</span>
      </div>
      <div className="flex-1 min-w-[40px] h-full" data-tauri-drag-region />
      {REPO_ONLY_ACTIONS.map((group) => (
        <div
          key={group.map((a) => a.key).join("-")}
          role="group"
          className="flex items-center gap-0.5 mx-1 shrink-0"
        >
          {group.map(({ key, icon: Icon, labelKey }) => (
            <span key={key} title={hint} className="inline-flex">
              <button
                type="button"
                disabled
                aria-disabled="true"
                aria-label={`${t(labelKey)} — ${hint}`}
                data-action={key}
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground opacity-50 cursor-not-allowed"
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {t(labelKey)}
              </button>
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

export function ToolbarRoot() {
  const { activeDropdown, toggle, close } = useToolbarDropdown();
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
    <>
      <div className="flex items-center h-[52px] border-b border-border bg-surface select-none">
        {scope?.kind === "workspace" ? (
          <WorkspaceModeZone workspaceId={scope.id} />
        ) : (
          <>
            {/* Zone A: Branch */}
            <BranchZone
              isOpen={activeDropdown === "branch"}
              onToggle={() => toggle("branch")}
              onClose={close}
            />

            {/* Zone A2: Worktree */}
            <WorktreeZone
              isOpen={activeDropdown === "worktree"}
              onToggle={() => toggle("worktree")}
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
