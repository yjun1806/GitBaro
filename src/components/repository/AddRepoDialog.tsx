import type { ReactNode } from "react";
import { Download, FolderOpen, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AddRepoDialogProps {
  onClone: () => void;
  onCreate: () => void;
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
      className="flex items-start gap-4 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/10 text-left transition-all"
    >
      <span className="p-2 rounded-lg bg-muted text-muted-foreground shrink-0 mt-0.5">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  );
}

export function AddRepoDialog({
  onClone,
  onCreate,
  onAddExisting,
  onClose,
}: AddRepoDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("repo.addRepository")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-3">
          <OptionCard
            icon={<Download className="w-5 h-5" />}
            title={t("repo.clone")}
            description={t("repo.cloneDescription")}
            onClick={onClone}
          />
          <OptionCard
            icon={<Plus className="w-5 h-5" />}
            title={t("repo.create")}
            description={t("repo.initDescription")}
            onClick={onCreate}
          />
          <OptionCard
            icon={<FolderOpen className="w-5 h-5" />}
            title={t("repo.add")}
            description={t("repo.addDescription")}
            onClick={onAddExisting}
          />
        </div>
      </div>
    </div>
  );
}
