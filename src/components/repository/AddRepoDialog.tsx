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
      className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left transition-all"
    >
      <span className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 shrink-0 mt-0.5">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
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
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            Add Repository
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-3">
          <OptionCard
            icon={<Download className="w-5 h-5" />}
            title={t("repo.clone")}
            description="Clone a repository from GitHub or a remote URL"
            onClick={onClone}
          />
          <OptionCard
            icon={<Plus className="w-5 h-5" />}
            title={t("repo.create")}
            description="Initialize a new Git repository in a folder"
            onClick={onCreate}
          />
          <OptionCard
            icon={<FolderOpen className="w-5 h-5" />}
            title={t("repo.add")}
            description="Add an existing local Git repository"
            onClick={onAddExisting}
          />
        </div>
      </div>
    </div>
  );
}
