import { useState } from "react";
import { UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "./AccountAvatar";

interface GhAccountDetectedDialogProps {
  accounts: GitHubAccount[];
  onConfirm: (selected: GitHubAccount[]) => void;
  onSignInNew: () => void;
}

export function GhAccountDetectedDialog({
  accounts,
  onConfirm,
  onSignInNew,
}: GhAccountDetectedDialogProps) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(accounts.map((a) => a.id)),
  );

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = accounts.filter((a) => selectedIds.has(a.id));
    onConfirm(selected);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10">
            <UserCheck className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground">
              {t("ghSync.detected.title")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("ghSync.detected.description")}
            </p>
          </div>
        </div>

        {/* Account list with checkboxes */}
        <div className="flex flex-col gap-2">
          {accounts.map((account) => {
            const checked = selectedIds.has(account.id);
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => toggleAccount(account.id)}
                className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  checked
                    ? "bg-primary/5 border-primary/30"
                    : "bg-card border-border opacity-60"
                }`}
              >
                {/* Checkbox */}
                <div
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                    checked
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/30"
                  }`}
                >
                  {checked && (
                    <svg
                      className="w-3 h-3 text-primary-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>

                <AccountAvatar account={account} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {account.username}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {account.email}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("ghSync.detected.confirm", { count: selectedIds.size })}
          </button>
          <button
            onClick={onSignInNew}
            className="w-full py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            {t("ghSync.detected.signInNew")}
          </button>
        </div>
      </div>
    </div>
  );
}
