import { useState, useId } from "react";
import { LogOut, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { Dialog } from "@/components/ui/Dialog";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./ui/SettingsSection";
import { SETTINGS_BUTTON, SETTINGS_BUTTON_DANGER } from "./ui/styles";

interface AccountSettingsProps {
  accounts: GitHubAccount[];
  onRemove: (accountId: string) => void;
  onAddAccount: () => void;
  onSyncAccounts: () => Promise<void>;
}

/** 설정의 「계정」 칸: 로그인한 GitHub 계정 목록, 추가, gh에서 다시 불러오기, 로그아웃(확인 창). */
export function AccountSettings({
  accounts,
  onRemove,
  onAddAccount,
  onSyncAccounts,
}: AccountSettingsProps) {
  const { t } = useTranslation();
  const logoutTitleId = useId();
  const [confirmLogoutId, setConfirmLogoutId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await onSyncAccounts();
    } finally {
      setIsSyncing(false);
    }
  };

  const confirmAccount = accounts.find((a) => a.id === confirmLogoutId);

  const handleLogout = (accountId: string) => {
    onRemove(accountId);
    setConfirmLogoutId(null);
  };

  return (
    <>
      <SettingsSection
        description={t("settingsPanel.accounts.description")}
        action={
          <div className="flex gap-1.5">
            <button type="button" onClick={handleSync} disabled={isSyncing} className={SETTINGS_BUTTON}>
              <RefreshCw className={cn("w-3.5 h-3.5", isSyncing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              {t("ghSync.syncButton")}
            </button>
            <button type="button" onClick={onAddAccount} className={SETTINGS_BUTTON}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              {t("account.add")}
            </button>
          </div>
        }
      >
        {accounts.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">{t("settingsPanel.accounts.empty")}</p>
        ) : (
          accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-3 px-4 py-2.5 min-h-[52px]">
              <AccountAvatar account={account} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground truncate">{account.username}</p>
                {account.email && <p className="text-[12px] text-muted-foreground truncate">{account.email}</p>}
              </div>
              <button type="button" onClick={() => setConfirmLogoutId(account.id)} className={SETTINGS_BUTTON_DANGER}>
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                {t("account.logout")}
              </button>
            </div>
          ))
        )}
      </SettingsSection>

      {/* 로그아웃 확인 창 */}
      {confirmAccount && (
        <Dialog
          onClose={() => setConfirmLogoutId(null)}
          labelledBy={logoutTitleId}
          overlayClassName="z-[60] bg-(--overlay)"
          className={cn(FLOATING_SURFACE, "rounded-(--radius-panel) w-full max-w-sm p-6 flex flex-col items-center gap-4")}
        >
          <AccountAvatar account={confirmAccount} size="lg" />
          <div className="text-center">
            <p id={logoutTitleId} className="text-sm font-semibold text-foreground">
              {t("account.logoutConfirm", { username: confirmAccount.username })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{confirmAccount.email}</p>
          </div>
          <div className="flex gap-3 w-full mt-2">
            <button
              type="button"
              onClick={() => setConfirmLogoutId(null)}
              className="flex-1 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => handleLogout(confirmAccount.id)}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors"
            >
              {t("account.logout")}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
