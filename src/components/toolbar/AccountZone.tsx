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
  const triggerRef = useRef<HTMLButtonElement>(null);
  useClickOutside(zoneRef, onClose, isOpen);
  const accounts = useAccountStore((s) => s.accounts);
  // 동기화·커밋에 실제로 쓰이는 계정(열린 저장소의 계정)을 보여준다.
  const repoAccountId = useRepoAccountId();
  const currentAccount = accounts.find((a) => a.id === repoAccountId);

  return (
    // flex로 감싸야 한다. 블록 상자 안의 inline-flex 버튼은 글자 줄 높이만큼 상자를 키워
    // 이 카드만 다른 카드보다 높아진다.
    <div ref={zoneRef} className="relative flex shrink-0">
      <button
        ref={triggerRef}
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
          anchorRef={triggerRef}
          onClose={onClose}
          onSignIn={onSignIn}
          onManageAccounts={onManageAccounts}
        />
      )}
    </div>
  );
}
