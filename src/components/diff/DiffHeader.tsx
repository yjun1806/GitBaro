import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useHasMaximizedFiles, useHasMaximizedOrigin } from "@/components/layout/maximized-files";
import { Button } from "@/components/ui/Button";
import { FileStatusLetter } from "@/components/ui/marks";
import { Segmented } from "@/components/ui/Segmented";
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
    // 따라가기(FollowPanel)가 diff 칸 안의 휠·누름·키를 「사용자가 diff를 움직였다」로 보고
    // 멈추는데, 이 머리(모드 전환·찾기·크게 보기 버튼)를 누른 것까지 그렇게 보면 안 된다.
    // 이 표(data-diff-header)로 그 구분을 준다.
    <div
      data-diff-header=""
      className="flex items-center gap-3 px-4 h-8 bg-card border-b border-(--line) min-w-0"
    >
      <FileStatusLetter status={status} />

      <div className="flex-1 min-w-0 flex items-center gap-0.5">
        <span className="text-[11.5px] text-muted-foreground truncate">{dir}</span>
        <span className="text-[12.5px] font-semibold text-foreground truncate">
          {filename}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {extra}
        {addedLines > 0 && (
          <span className="font-mono text-[11.5px] text-diff-add-fg">
            +{addedLines}
          </span>
        )}
        {removedLines > 0 && (
          <span className="font-mono text-[11.5px] text-diff-del-fg">
            {"−"}{removedLines}
          </span>
        )}

        {modes.length > 1 && (
          <Segmented
            size="sm"
            ariaLabel={t("diff.viewModeLabel")}
            value={viewMode}
            onChange={onSelectMode}
            options={modes.map((mode) => ({ value: mode, label: t(MODE_LABEL[mode]) }))}
          />
        )}
        {onFind && (
          <Button iconOnly size="sm" variant="ghost" onClick={onFind} aria-label={t("diffFind.open")} title={t("diffFind.open")}>
            <Search className="w-3.5 h-3.5" />
          </Button>
        )}
        {maximizable && <FileListButton />}
        {maximizable && <MaximizeButton />}
      </div>
    </div>
  );
}

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
    <Button
      iconOnly
      size="sm"
      variant="ghost"
      onClick={() => setOpen(!open)}
      aria-label={label}
      aria-pressed={open}
      title={label}
    >
      {open ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
    </Button>
  );
}

/**
 * diff 크게 보기 켜기·끄기. 켜면 그래프 패널과 파일 목록을 숨긴다(Escape로도 되돌린다). 크게 보는
 * 동안 출처 머리 줄(`MaximizedOriginHeader`)이 있으면 그쪽이 「원래 크기로」를 맡으므로 이 아이콘은
 * 숨긴다(원칙 3, 되돌리는 자리는 하나).
 */
function MaximizeButton() {
  const { t } = useTranslation();
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const setMaximized = useUIStore((s) => s.setDiffMaximized);
  const hasOrigin = useHasMaximizedOrigin();
  if (maximized && hasOrigin) return null;
  const label = maximized ? t("diff.restoreSize") : t("diff.maximize");
  return (
    <Button
      iconOnly
      size="sm"
      variant="ghost"
      onClick={() => setMaximized(!maximized)}
      aria-label={label}
      aria-pressed={maximized}
      title={label}
    >
      {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
    </Button>
  );
}
