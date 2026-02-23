import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "./AccountAvatar";

interface AccountSwitcherProps {
  accounts: GitHubAccount[];
  currentAccountId: string | null;
  onSwitch: (accountId: string) => void;
  onAddAccount: () => void;
  onManageAccounts: () => void;
}

export function AccountSwitcher({
  accounts,
  currentAccountId,
  onSwitch,
  onAddAccount,
  onManageAccounts,
}: AccountSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentAccount = accounts.find((a) => a.id === currentAccountId);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        {currentAccount ? (
          <>
            <AccountAvatar account={currentAccount} size="sm" isActive />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {currentAccount.username}
            </span>
          </>
        ) : (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("account.switch")}
          </span>
        )}
        {accounts.length > 1 && (
          <span className="ml-0.5 flex items-center justify-center w-4 h-4 text-xs rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            {accounts.length}
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
          {accounts.map((account) => (
            <button
              key={account.id}
              onClick={() => {
                onSwitch(account.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <AccountAvatar account={account} size="sm" />
              <span className="flex-1 text-sm text-left text-gray-700 dark:text-gray-200">
                {account.username}
              </span>
              {account.id === currentAccountId && (
                <Check className="w-4 h-4 text-blue-500" />
              )}
            </button>
          ))}

          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

          <button
            onClick={() => {
              onAddAccount();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm text-gray-700 dark:text-gray-200"
          >
            <Plus className="w-4 h-4 text-gray-400" />
            {t("account.add")}
          </button>

          <button
            onClick={() => {
              onManageAccounts();
              setOpen(false);
            }}
            className={clsx(
              "w-full flex items-center gap-2.5 px-3 py-2",
              "hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors",
              "text-sm text-gray-700 dark:text-gray-200"
            )}
          >
            <Settings className="w-4 h-4 text-gray-400" />
            {t("account.manage")}
          </button>
        </div>
      )}
    </div>
  );
}
