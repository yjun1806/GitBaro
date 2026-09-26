import type { ReactNode } from "react";
import { Download, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DialogFrame } from "@/components/ui/DialogFrame";

interface AddRepoDialogProps {
  onClone: () => void;
  onAddExisting: () => void;
  onClose: () => void;
}

interface OptionCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function OptionCard({ icon, title, description, onClick }: OptionCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-4 p-4 rounded-(--radius-item) border border-border hover:bg-accent text-left transition-colors motion-reduce:transition-none"
    >
      <span className="p-2 rounded-(--radius-item) bg-muted text-muted-foreground shrink-0 mt-0.5">
        {icon}
      </span>
      <div>
        <p className="text-[12.5px] font-semibold text-foreground">{title}</p>
        <p className="text-[11.5px] text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  );
}

export function AddRepoDialog({
  onClone,
  onAddExisting,
  onClose,
}: AddRepoDialogProps) {
  const { t } = useTranslation();

  return (
    <DialogFrame title={t("repo.addRepository")} onClose={onClose} size="sm">
      <div className="flex flex-col gap-3">
        <OptionCard
          icon={<Download className="w-5 h-5" />}
          title={t("repo.clone")}
          description={t("repo.cloneDescription")}
          onClick={onClone}
        />
        {/* "Create new repository" (git init) is hidden until it is implemented. */}
        <OptionCard
          icon={<FolderOpen className="w-5 h-5" />}
          title={t("repo.add")}
          description={t("repo.addDescription")}
          onClick={onAddExisting}
        />
      </div>
    </DialogFrame>
  );
}
