import { AlertTriangle, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ConflictBannerProps {
  conflictedFiles: string[];
  onOpenMergeTool: () => void;
}

export function ConflictBanner({ conflictedFiles, onOpenMergeTool }: ConflictBannerProps) {
  const { t } = useTranslation();

  if (conflictedFiles.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mx-3 my-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-sm font-semibold text-red-700 dark:text-red-300">
          {t("conflict.title")}
        </span>
        <span className="ml-auto text-xs text-red-500 dark:text-red-400">
          {t("conflict.files", { count: conflictedFiles.length })}
        </span>
      </div>

      <ul className="flex flex-col gap-0.5 pl-6">
        {conflictedFiles.map((file) => (
          <li key={file} className="text-xs text-red-600 dark:text-red-400 font-mono truncate">
            {file}
          </li>
        ))}
      </ul>

      <button
        onClick={onOpenMergeTool}
        className="flex items-center gap-2 self-start mt-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
      >
        <Wrench className="w-3.5 h-3.5" />
        {t("conflict.openTool")}
      </button>
    </div>
  );
}
