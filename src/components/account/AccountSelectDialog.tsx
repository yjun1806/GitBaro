import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { cn } from "@/lib/utils";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";

interface AccountSelectDialogProps {
  accounts: GitHubAccount[];
  activeAccountId: string | null;
  onSelect: (accountId: string | null) => void;
  onClose: () => void;
}

export function AccountSelectDialog({
  accounts,
  activeAccountId,
  onSelect,
  onClose,
}: AccountSelectDialogProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(activeAccountId);

  return (
    <DialogFrame
      title={t("repo.selectDefaultAccount")}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onSelect(null)}>
            {t("repo.skipAccountSelect")}
          </Button>
          <Button variant="primary" size="md" onClick={() => onSelect(selectedId)} disabled={!selectedId}>
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-[11.5px] text-muted-foreground mb-3">{t("repo.selectDefaultAccountDesc")}</p>

      <div className="flex flex-col gap-1">
        {accounts.map((account) => (
          <button
            key={account.id}
            onClick={() => setSelectedId(account.id)}
            className={cn(
              "w-full flex items-center gap-3 min-h-11 px-3 rounded-(--radius-item) text-left transition-colors motion-reduce:transition-none",
              selectedId === account.id ? "bg-(--acc-sel)" : "hover:bg-accent",
            )}
          >
            <AccountAvatar account={account} size="sm" />
            <div className="flex-1 min-w-0">
              <p className={cn("text-[12.5px] text-foreground truncate", selectedId === account.id ? "font-semibold" : "font-medium")}>
                {account.username}
              </p>
              {account.email && (
                <p className="text-[11.5px] text-muted-foreground truncate">
                  {account.email}
                </p>
              )}
            </div>
            {selectedId === account.id && (
              <Check className="w-4 h-4 text-foreground shrink-0" />
            )}
          </button>
        ))}
      </div>
    </DialogFrame>
  );
}
