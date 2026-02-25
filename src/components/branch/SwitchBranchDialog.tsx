import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type StashAction = "leave" | "bring";

interface SwitchBranchDialogProps {
  currentBranch: string;
  targetBranch: string;
  onConfirm: (action: StashAction) => void;
  onClose: () => void;
}

export function SwitchBranchDialog({
  currentBranch,
  targetBranch,
  onConfirm,
  onClose,
}: SwitchBranchDialogProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState<StashAction>("leave");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("branch.switchBranch")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          <p className="text-sm text-foreground">
            {t("branch.uncommittedChanges")}
          </p>

          <div className="border border-border rounded-lg overflow-hidden">
            {/* Leave changes (stash) */}
            <label
              className={cn(
                "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                action === "leave" ? "bg-primary/5" : "hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name="stashAction"
                value="leave"
                checked={action === "leave"}
                onChange={() => setAction("leave")}
                className="mt-1 accent-primary"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("branch.leaveChanges", { branch: currentBranch })}
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                  {t("branch.leaveChangesDesc")}
                </p>
              </div>
            </label>

            <div className="border-t border-border" />

            {/* Bring changes */}
            <label
              className={cn(
                "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                action === "bring" ? "bg-primary/5" : "hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name="stashAction"
                value="bring"
                checked={action === "bring"}
                onChange={() => setAction("bring")}
                className="mt-1 accent-primary"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("branch.bringChanges", { branch: targetBranch })}
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                  {t("branch.bringChangesDesc")}
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => onConfirm(action)}
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors"
          >
            {t("branch.switchBranch")}
          </button>
        </div>
      </div>
    </div>
  );
}
