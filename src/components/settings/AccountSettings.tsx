import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
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
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const handleRemove = (accountId: string) => {
    onRemove(accountId);
    setConfirmRemove(null);
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
              {account.tokenExpiresAt && (
                <p className="text-xs text-amber-500 mt-0.5">
                  Token expires {new Date(account.tokenExpiresAt * 1000).toLocaleDateString()}
                </p>
              )}
            </div>

            {confirmRemove === account.id ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("account.removeConfirm", { username: account.username })}
                </span>
                <button
                  onClick={() => setConfirmRemove(null)}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRemove(account.id)}
                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRemove(account.id)}
                className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title={t("account.remove")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
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
    </div>
  );
}
