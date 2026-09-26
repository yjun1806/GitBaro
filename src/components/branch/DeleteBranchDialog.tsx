import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/marks";
import { Notice } from "@/components/ui/Notice";

interface DeleteBranchDialogProps {
  branchName: string;
  isFullyMerged: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteBranchDialog({
  branchName,
  isFullyMerged,
  onConfirm,
  onClose,
}: DeleteBranchDialogProps) {
  const { t } = useTranslation();

  return (
    <DialogFrame
      title={t("branch.contextMenu.delete")}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm}>
            {t("common.delete")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-foreground">{t("branch.deleteConfirm", { name: branchName })}</p>

        <Code block>{isFullyMerged ? `git branch -d ${branchName}` : `git branch -D ${branchName}`}</Code>

        {!isFullyMerged && (
          <Notice tone="warning" icon={AlertTriangle}>
            {t("branch.deleteUnmergedWarning")}
          </Notice>
        )}
      </div>
    </DialogFrame>
  );
}
