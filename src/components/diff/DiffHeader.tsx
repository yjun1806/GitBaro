import { useTranslation } from "react-i18next";
import { FileStatusBadge } from "@/lib/file-status";
import type { FileStatus } from "@/types";

interface DiffHeaderProps {
  filePath: string;
  status: FileStatus;
  addedLines: number;
  removedLines: number;
  viewMode: "unified" | "split";
  onToggleView: () => void;
}


export function DiffHeader({
  filePath,
  status,
  addedLines,
  removedLines,
  viewMode,
  onToggleView,
}: DiffHeaderProps) {
  const { t } = useTranslation();

  const dir = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/") + 1)
    : "";
  const filename = filePath.includes("/")
    ? filePath.substring(filePath.lastIndexOf("/") + 1)
    : filePath;

  return (
    <div className="flex items-center gap-3 px-4 h-[36px] bg-surface border-b border-border min-w-0">
      <FileStatusBadge status={status} size="md" />

      <div className="flex-1 min-w-0 flex items-center gap-0.5">
        <span className="text-xs text-muted-foreground truncate">{dir}</span>
        <span className="text-sm font-medium text-foreground truncate">
          {filename}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {addedLines > 0 && (
          <span className="text-xs font-medium text-diff-add-fg">
            +{addedLines}
          </span>
        )}
        {removedLines > 0 && (
          <span className="text-xs font-medium text-diff-del-fg">
            -{removedLines}
          </span>
        )}

        <button
          onClick={onToggleView}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded hover:bg-accent transition-colors"
        >
          {viewMode === "unified" ? t("diff.split") : t("diff.unified")}
        </button>
      </div>
    </div>
  );
}
