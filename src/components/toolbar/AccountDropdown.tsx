import { useRef } from "react";
import { Check } from "lucide-react";
import { useAccountStore } from "@/stores/account";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { useClickOutside } from "./useToolbarDropdown";

interface AccountDropdownProps {
  onClose: () => void;
  onSignIn: () => void;
  onManageAccounts: () => void;
}

export function AccountDropdown({
  onClose,
  onSignIn,
  onManageAccounts,
}: AccountDropdownProps) {
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, onClose);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1"
    >
      {accounts.length === 0 ? (
        <div className="px-3 py-2">
          <p className="text-sm text-muted-foreground">No accounts linked</p>
          <button
            onClick={() => {
              onClose();
              onSignIn();
            }}
            className="mt-2 w-full py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
          >
            Sign in to GitHub
          </button>
        </div>
      ) : (
        <>
          {accounts.map((account) => (
            <button
              key={account.id}
              onClick={() => {
                setActiveAccount(account.id);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent transition-colors text-left"
            >
              <AccountAvatar account={account} size="sm" />
              <span className="text-sm truncate flex-1">{account.username}</span>
              {account.id === activeAccountId && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </button>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <button
              onClick={() => {
                onClose();
                onSignIn();
              }}
              className="w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors text-left"
            >
              Add another account
            </button>
            <button
              onClick={() => {
                onClose();
                onManageAccounts();
              }}
              className="w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors text-left"
            >
              Manage Accounts
            </button>
          </div>
        </>
      )}
    </div>
  );
}
