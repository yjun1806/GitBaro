import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useAccountStore } from "@/stores/account";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { Button } from "@/components/ui/Button";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { cn } from "@/lib/utils";
import { useRepoAccountId, useAssignRepoAccount } from "@/hooks/useRepoAccountId";

interface AccountDropdownProps {
  /** 여는 버튼(`AccountZone`의 트리거). 그 아래(오른쪽 정렬)에 띄운다. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSignIn: () => void;
  onManageAccounts: () => void;
}

export function AccountDropdown({ anchorRef, onClose, onSignIn, onManageAccounts }: AccountDropdownProps) {
  const { t } = useTranslation();
  const accounts = useAccountStore((s) => s.accounts);
  // 열린 저장소의 계정을 보여주고, 고르면 그 저장소에 지정한다.
  const repoAccountId = useRepoAccountId();
  const assignAccount = useAssignRepoAccount();

  // 계정이 없으면 메뉴 항목이 아니라 안내 + 로그인 버튼이라 목록 메뉴(`ContextMenu`) 모양이 아니다.
  if (accounts.length === 0) {
    return (
      <div className={cn("absolute right-0 top-full mt-2 w-56 rounded-(--radius-item) p-3 z-50 animate-pop-in", FLOATING_SURFACE)}>
        <p className="text-[12.5px] text-muted-foreground">{t("account.noAccountsLinked")}</p>
        <Button
          variant="primary"
          size="sm"
          className="w-full mt-2"
          onClick={() => {
            onClose();
            onSignIn();
          }}
        >
          {t("account.signInToGitHub")}
        </Button>
      </div>
    );
  }

  const sections: ContextMenuSection[] = [
    {
      items: accounts.map((account) => ({
        label: account.username,
        icon: <AccountAvatar account={account} size="sm" />,
        checked: account.id === repoAccountId,
        onClick: () => assignAccount(account.id),
      })),
    },
    {
      items: [
        { label: t("account.addAnother"), onClick: onSignIn },
        { label: t("account.manageAccounts"), onClick: onManageAccounts },
      ],
    },
  ];

  return <ContextMenu anchored={{ anchorRef, align: "end" }} onClose={onClose} sections={sections} />;
}
