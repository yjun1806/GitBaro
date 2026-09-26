import { useTranslation } from "react-i18next";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/marks";

interface CommitErrorDialogProps {
  message: string;
  onClose: () => void;
}

export function CommitErrorDialog({ message, onClose }: CommitErrorDialogProps) {
  const { t } = useTranslation();

  return (
    <DialogFrame
      title={t("commit.errorTitle")}
      onClose={onClose}
      size="md"
      footer={
        <Button variant="primary" size="md" onClick={onClose}>
          {t("commit.close")}
        </Button>
      }
    >
      <Code block className="max-h-60 overflow-y-auto select-text cursor-text break-words">
        {message}
      </Code>
    </DialogFrame>
  );
}
