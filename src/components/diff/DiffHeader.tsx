import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useHasMaximizedFiles } from "@/components/layout/maximized-files";
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
  /** 줄 수 앞에 둘 것(따라가기의 「4초 전 수정」 등). */
  extra?: ReactNode;
  /** diff를 메인 칸 전체로 키우는 버튼을 둘지(목록 + diff 화면에서만 켠다). */
  maximizable?: boolean;
  /** 주면 찾기 버튼을 둔다(⌘F와 같다). */
  onFind?: () => void;
}

export function DiffHeader({
  filePath,
  status,
  addedLines,
  removedLines,
  viewMode,
  modes,
  onSelectMode,
  extra,
  maximizable = false,
  onFind,
}: DiffHeaderProps) {
  const { t } = useTranslation();

  const dir = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/") + 1)
    : "";
  const filename = filePath.includes("/")
    ? filePath.substring(filePath.lastIndexOf("/") + 1)
    : filePath;

  return (
    <div className="flex items-center gap-3 px-4 h-[36px] bg-card border-b border-(--line) min-w-0">
      <FileStatusBadge status={status} size="md" />

      <div className="flex-1 min-w-0 flex items-center gap-0.5">
        <span className="text-xs text-muted-foreground truncate">{dir}</span>
        <span className="text-sm font-medium text-foreground truncate">
          {filename}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {extra}
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
        {onFind && (
          <button
            type="button"
            onClick={onFind}
            aria-label={t("diffFind.open")}
            title={t("diffFind.open")}
            className={ICON_BUTTON}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        )}
        {maximizable && <FileListButton />}
        {maximizable && <MaximizeButton />}
      </div>
    </div>
  );
}

const ICON_BUTTON =
  "flex items-center justify-center w-6 h-6 rounded-(--radius-chip) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors";

/** 크게 보는 동안 diff 왼쪽 파일 목록을 접고 편다. diff를 연 목록이 있을 때만 나타난다. */
function FileListButton() {
  const { t } = useTranslation();
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const open = useUIStore((s) => s.maximizedFileListOpen);
  const setOpen = useUIStore((s) => s.setMaximizedFileListOpen);
  const hasFiles = useHasMaximizedFiles();
  if (!maximized || !hasFiles) return null;
  const label = open ? t("diff.hideFileList") : t("diff.showFileList");
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={label}
      aria-pressed={open}
      title={label}
      className={ICON_BUTTON}
    >
      {open ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
    </button>
  );
}

/** diff 크게 보기 켜기·끄기. 켜면 그래프 패널과 파일 목록을 숨긴다(Escape로도 되돌린다). */
function MaximizeButton() {
  const { t } = useTranslation();
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const setMaximized = useUIStore((s) => s.setDiffMaximized);
  const label = maximized ? t("diff.restoreSize") : t("diff.maximize");
  return (
    <button
      type="button"
      onClick={() => setMaximized(!maximized)}
      aria-label={label}
      aria-pressed={maximized}
      title={label}
      className={ICON_BUTTON}
    >
      {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
    </button>
  );
}
