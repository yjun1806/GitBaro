import { useId, useState } from "react";
import { UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { GitHubAccount } from "@/types";
import { AccountAvatar } from "./AccountAvatar";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";

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
  const groupId = useId();
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
    <DialogFrame
      title={t("ghSync.detected.title")}
      size="md"
      dismissible={false}
      overlayClassName="z-[60] bg-(--overlay)"
    >
      <div className="flex flex-col items-center gap-3 text-center mb-4">
        <UserCheck className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-[11.5px] text-muted-foreground">{t("ghSync.detected.description")}</p>
      </div>

      {/* Account list with checkboxes */}
      <div role="group" aria-label={t("ghSync.detected.title")} id={groupId} className="flex flex-col gap-2 mb-5">
        {accounts.map((account) => {
          const checked = selectedIds.has(account.id);
          return (
            <label
              key={account.id}
              className={clsx(
                "flex items-center gap-3 p-3 rounded-(--radius-item) border text-left transition-colors motion-reduce:transition-none cursor-pointer",
                checked ? "bg-primary/5 border-primary/30" : "bg-card border-border opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleAccount(account.id)}
                className="accent-primary w-4 h-4 shrink-0"
              />
              <AccountAvatar account={account} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-foreground">
                  {account.username}
                </p>
                <p className="text-[11.5px] text-muted-foreground truncate">
                  {account.email}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="primary" size="md" className="w-full" onClick={handleConfirm} disabled={selectedIds.size === 0}>
          {t("ghSync.detected.confirm", { count: selectedIds.size })}
        </Button>
        <Button variant="secondary" size="md" className="w-full" onClick={onSignInNew}>
          {t("ghSync.detected.signInNew")}
        </Button>
      </div>
    </DialogFrame>
  );
}
