import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { FileStatusBadge } from "@/lib/file-status";
import type { FileStatus } from "@/types";
import type { DiffViewMode } from "./view-mode";

const MODE_LABEL: Record<DiffViewMode, string> = {
  unified: "diff.unified",
  split: "diff.split",
  document: "diff.document",
};

interface DiffHeaderProps {
  filePath: string;
  status: FileStatus;
  addedLines: number;
  removedLines: number;
  viewMode: DiffViewMode;
  /** 이 파일에서 고를 수 있는 모드들 — 안 되는 모드는 아예 나타나지 않는다. */
  modes: DiffViewMode[];
  onSelectMode: (mode: DiffViewMode) => void;
}

export function DiffHeader({
  filePath,
  status,
  addedLines,
  removedLines,
  viewMode,
  modes,
  onSelectMode,
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

        <div className="flex items-center rounded border border-border overflow-hidden">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSelectMode(mode)}
              aria-pressed={mode === viewMode}
              className={clsx(
                "px-2 py-1 text-xs transition-colors",
                mode === viewMode
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              {t(MODE_LABEL[mode])}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
