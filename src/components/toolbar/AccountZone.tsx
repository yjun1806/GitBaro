import { useRef } from "react";
import { useAccountStore } from "@/stores/account";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { useClickOutside } from "./useToolbarDropdown";
import { AccountDropdown } from "./AccountDropdown";

interface AccountZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSignIn: () => void;
  onManageAccounts: () => void;
}

export function AccountZone({
  isOpen,
  onToggle,
  onClose,
  onSignIn,
  onManageAccounts,
}: AccountZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  useClickOutside(zoneRef, onClose, isOpen);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const currentAccount = accounts.find((a) => a.id === activeAccountId);

  return (
    <div ref={zoneRef} className="relative shrink-0">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 h-[52px] hover:bg-accent transition-colors"
      >
        {currentAccount ? (
          <>
            <AccountAvatar account={currentAccount} size="sm" />
            <span className="text-sm font-medium truncate max-w-[100px] hidden min-[1100px]:inline">
              {currentAccount.username}
            </span>
          </>
        ) : (
          <div className="w-6 h-6 rounded-full bg-muted/20 flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground font-bold">?</span>
          </div>
        )}
      </button>

      {isOpen && (
        <AccountDropdown
          onClose={onClose}
          onSignIn={onSignIn}
          onManageAccounts={onManageAccounts}
        />
      )}
    </div>
  );
}
