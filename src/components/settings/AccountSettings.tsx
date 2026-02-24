import { useState } from "react";
import { LogOut, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "@/components/account/AccountAvatar";

interface AccountSettingsProps {
  accounts: GitHubAccount[];
  onRemove: (accountId: string) => void;
  onAddAccount: () => void;
}

export function AccountSettings({
  accounts,
  onRemove,
  onAddAccount,
}: AccountSettingsProps) {
  const { t } = useTranslation();
  const [confirmLogoutId, setConfirmLogoutId] = useState<string | null>(null);

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
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700"
          >
            <AccountAvatar account={account} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {account.username}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{account.email}</p>
            </div>

            <button
              onClick={() => setConfirmLogoutId(account.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t("account.logout")}
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={onAddAccount}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("account.add")}
      </button>

      {/* 로그아웃 확인 모달 */}
      {confirmAccount && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col items-center gap-4">
            <AccountAvatar account={confirmAccount} size="lg" />
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {t("account.logoutConfirm", { username: confirmAccount.username })}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {confirmAccount.email}
              </p>
            </div>
            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setConfirmLogoutId(null)}
                className="flex-1 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleLogout(confirmAccount.id)}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-colors"
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
