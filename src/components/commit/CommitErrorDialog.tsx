import { X, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CommitErrorDialogProps {
  message: string;
  onClose: () => void;
}

export function CommitErrorDialog({ message, onClose }: CommitErrorDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <h2 className="text-base font-semibold text-foreground">
              {t("commit.errorTitle")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <pre className="text-sm text-foreground bg-muted/50 rounded-lg p-3 whitespace-pre-wrap break-words max-h-60 overflow-y-auto font-mono select-text cursor-text">
            {message}
          </pre>
        </div>

        <div className="flex justify-end px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
          >
            {t("commit.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
