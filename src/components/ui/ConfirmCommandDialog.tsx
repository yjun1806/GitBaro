import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DialogFrame } from "./DialogFrame";
import { Button } from "./Button";
import { Code } from "./marks";
import { Notice } from "./Notice";

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
    <DialogFrame
      title={title}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={confirmVariant === "destructive" ? "danger" : "primary"}
            size="md"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel ?? t("common.proceed")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {description && <p className="text-[12.5px] text-muted-foreground">{description}</p>}

        <div className="flex flex-col gap-1.5">
          <p className="text-[11.5px] font-semibold text-(--fg2)">{t("common.commandPreview")}</p>
          <Code block>{command}</Code>
        </div>

        {warnings && warnings.length > 0 && (
          <Notice tone="warning" icon={AlertTriangle}>
            <ul className="flex flex-col gap-1">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
    </DialogFrame>
  );
}
