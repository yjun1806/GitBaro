import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAccountStore } from "@/stores/account";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { cn } from "@/lib/utils";
import { useRepoAccountId, useAssignRepoAccount } from "@/hooks/useRepoAccountId";
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
  const { t } = useTranslation();
  const accounts = useAccountStore((s) => s.accounts);
  // 열린 저장소의 계정을 보여주고, 고르면 그 저장소에 지정한다.
  const repoAccountId = useRepoAccountId();
  const assignAccount = useAssignRepoAccount();
  return (
    <div
      className={cn("absolute right-0 top-full mt-2 w-56 rounded-lg z-50 py-1 animate-pop-in", FLOATING_SURFACE)}
    >
      {accounts.length === 0 ? (
        <div className="px-3 py-2">
          <p className="text-sm text-muted-foreground">{t("account.noAccountsLinked")}</p>
          <button
            onClick={() => {
              onClose();
              onSignIn();
            }}
            className="mt-2 w-full py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
          >
            {t("account.signInToGitHub")}
          </button>
        </div>
      ) : (
        <>
          {accounts.map((account) => (
            <button
              key={account.id}
              onClick={() => {
                assignAccount(account.id);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent transition-colors text-left"
            >
              <AccountAvatar account={account} size="sm" />
              <span className="text-sm truncate flex-1">{account.username}</span>
              {account.id === repoAccountId && (
                <Check className="w-4 h-4 text-foreground shrink-0" />
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
              {t("account.addAnother")}
            </button>
            <button
              onClick={() => {
                onClose();
                onManageAccounts();
              }}
              className="w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors text-left"
            >
              {t("account.manageAccounts")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
