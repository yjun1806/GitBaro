import { useState } from "react";
import { LogOut, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "@/components/account/AccountAvatar";

interface AccountSettingsProps {
  accounts: GitHubAccount[];
  onRemove: (accountId: string) => void;
  onAddAccount: () => void;
  onSyncAccounts: () => Promise<void>;
}

export function AccountSettings({
  accounts,
  onRemove,
  onAddAccount,
  onSyncAccounts,
}: AccountSettingsProps) {
  const { t } = useTranslation();
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex items-center gap-3 p-3 rounded-xl border border-border"
          >
            <AccountAvatar account={account} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {account.username}
              </p>
              <p className="text-xs text-muted-foreground">{account.email}</p>
            </div>

            <button
              onClick={() => setConfirmLogoutId(account.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t("account.logout")}
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onAddAccount}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border hover:border-primary hover:bg-primary/10 text-sm text-muted-foreground hover:text-primary transition-all"
        >
          <Plus className="w-4 h-4" />
          {t("account.add")}
        </button>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          title={t("ghSync.syncButton")}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border hover:border-primary hover:bg-primary/10 text-sm text-muted-foreground hover:text-primary transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
          {t("ghSync.syncButton")}
        </button>
      </div>

      {/* 로그아웃 확인 모달 */}
      {confirmAccount && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col items-center gap-4">
            <AccountAvatar account={confirmAccount} size="lg" />
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">
                {t("account.logoutConfirm", { username: confirmAccount.username })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {confirmAccount.email}
              </p>
            </div>
            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setConfirmLogoutId(null)}
                className="flex-1 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => handleLogout(confirmAccount.id)}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors"
              >
                {t("account.logout")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
