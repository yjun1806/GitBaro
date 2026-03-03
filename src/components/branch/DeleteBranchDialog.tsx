import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("branch.contextMenu.delete")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-3">
          <p className="text-sm text-foreground">
            {t("branch.deleteConfirm", { name: branchName })}
          </p>

          <p className="font-mono text-xs text-muted-foreground mt-2">
            {isFullyMerged ? `git branch -d ${branchName}` : `git branch -D ${branchName}`}
          </p>

          {!isFullyMerged && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning leading-relaxed">
                {t("branch.deleteUnmergedWarning")}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg transition-colors"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
