import { useRef } from "react";
import { useAccountStore } from "@/stores/account";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useClickOutside } from "./useToolbarDropdown";
import { AccountDropdown } from "./AccountDropdown";
import { toolbarButtonClass } from "./toolbar-button";

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
  // 동기화·커밋에 실제로 쓰이는 계정(열린 저장소의 계정)을 보여준다.
  const repoAccountId = useRepoAccountId();
  const currentAccount = accounts.find((a) => a.id === repoAccountId);

  return (
    <div ref={zoneRef} className="relative shrink-0">
      <button
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={toolbarButtonClass({ open: isOpen })}
      >
        {currentAccount ? (
          <>
            <AccountAvatar account={currentAccount} size="sm" className="w-5! h-5! text-[10px]!" />
            <span className="truncate max-w-[100px] hidden @min-[1100px]:inline">
              {currentAccount.username}
            </span>
          </>
        ) : (
          <span className="w-5 h-5 rounded-full bg-foreground/[0.07] flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground font-bold">?</span>
          </span>
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
