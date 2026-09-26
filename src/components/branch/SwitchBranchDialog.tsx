import { useState, useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/marks";

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
  const titleId = useId();
  const [action, setAction] = useState<StashAction>("leave");

  return (
    <DialogFrame
      title={t("branch.switchBranch")}
      titleId={titleId}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={() => onConfirm(action)}>
            {t("branch.switchBranch")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-foreground">
          {t("branch.uncommittedChanges")}
        </p>

        <div className="border border-border rounded-(--radius-item) overflow-hidden">
          {/* Leave changes (stash) */}
          <label
            className={cn(
              "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
              action === "leave" ? "bg-(--acc-sel)" : "hover:bg-accent",
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
              <p className="text-[12.5px] font-medium text-foreground">
                {t("branch.leaveChanges", { branch: currentBranch })}
              </p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">
                {t("branch.leaveChangesDesc")}
              </p>
              <Code className="mt-1 block w-fit ml-6">git stash && git checkout {targetBranch}</Code>
            </div>
          </label>

          <div className="border-t border-border" />

          {/* Bring changes */}
          <label
            className={cn(
              "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
              action === "bring" ? "bg-(--acc-sel)" : "hover:bg-accent",
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
              <p className="text-[12.5px] font-medium text-foreground">
                {t("branch.bringChanges", { branch: targetBranch })}
              </p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">
                {t("branch.bringChangesDesc")}
              </p>
              <Code className="mt-1 block w-fit ml-6">git checkout {targetBranch}</Code>
            </div>
          </label>
        </div>
      </div>
    </DialogFrame>
  );
}
