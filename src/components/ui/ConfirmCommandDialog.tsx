import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmCommandDialogProps {
  title: string;
  description?: string;
  command: string;
  warnings?: string[];
  confirmLabel?: string;
  confirmVariant?: "primary" | "destructive";
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmCommandDialog({
  title,
  description,
  command,
  warnings,
  confirmLabel,
  confirmVariant = "primary",
  onConfirm,
  onClose,
}: ConfirmCommandDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-primary">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}

          {/* Command preview */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">
              {t("common.commandPreview")}
            </p>
            <div className="font-mono text-xs bg-muted rounded px-3 py-2 text-primary">
              {command}
            </div>
          </div>

          {/* Warnings */}
          {warnings && warnings.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg px-3 py-2.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg hover:bg-muted text-muted-foreground"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className={`px-4 py-1.5 text-sm rounded-lg font-medium ${
              confirmVariant === "destructive"
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-accent hover:bg-accent/80 text-white"
            }`}
          >
            {confirmLabel ?? t("common.proceed")}
          </button>
        </div>
      </div>
    </div>
  );
}
