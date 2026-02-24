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
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
      >
        {currentAccount ? (
          <>
            <AccountAvatar account={currentAccount} size="sm" isActive />
            <span className="text-sm font-medium text-foreground">
              {currentAccount.username}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t("account.switch")}
          </span>
        )}
        {accounts.length > 1 && (
          <span className="ml-0.5 flex items-center justify-center w-4 h-4 text-xs rounded-full bg-muted text-muted-foreground">
            {accounts.length}
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
          {accounts.map((account) => (
            <button
              key={account.id}
              onClick={() => {
                onSwitch(account.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent transition-colors"
            >
              <AccountAvatar account={account} size="sm" />
              <span className="flex-1 text-sm text-left text-foreground">
                {account.username}
              </span>
              {account.id === currentAccountId && (
                <Check className="w-4 h-4 text-primary" />
              )}
            </button>
          ))}

          <div className="my-1 border-t border-border" />

          <button
            onClick={() => {
              onAddAccount();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent transition-colors text-sm text-foreground"
          >
            <Plus className="w-4 h-4 text-muted-foreground" />
            {t("account.add")}
          </button>

          <button
            onClick={() => {
              onManageAccounts();
              setOpen(false);
            }}
            className={clsx(
              "w-full flex items-center gap-2.5 px-3 py-2",
              "hover:bg-accent transition-colors",
              "text-sm text-foreground"
            )}
          >
            <Settings className="w-4 h-4 text-muted-foreground" />
            {t("account.manage")}
          </button>
        </div>
      )}
    </div>
  );
}
