import { useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { cn } from "@/lib/utils";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("repo.selectDefaultAccount")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description */}
        <div className="px-6 pt-4 pb-2">
          <p className="text-xs text-muted-foreground">
            {t("repo.selectDefaultAccountDesc")}
          </p>
        </div>

        {/* Account list */}
        <div className="px-6 py-3 flex flex-col gap-1">
          {accounts.map((account) => (
            <button
              key={account.id}
              onClick={() => setSelectedId(account.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                selectedId === account.id
                  ? "bg-primary/10 border border-primary/30"
                  : "hover:bg-accent border border-transparent",
              )}
            >
              <AccountAvatar account={account} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {account.username}
                </p>
                {account.email && (
                  <p className="text-xs text-muted-foreground truncate">
                    {account.email}
                  </p>
                )}
              </div>
              {selectedId === account.id && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={() => onSelect(null)}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("repo.skipAccountSelect")}
          </button>
          <button
            onClick={() => onSelect(selectedId)}
            disabled={!selectedId}
            className={cn(
              "px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors",
              !selectedId && "opacity-50 cursor-not-allowed",
            )}
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
