import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Lock } from "lucide-react";
import { WorktreeIcon } from "@/components/ui/WorktreeIcon";
import { cn } from "@/lib/utils";
import type { WorktreeInfo } from "@/types";
import { WorktreeBaseLabel } from "./WorktreeBaseLabel";

// 시안 D6 chip_btn과 같은 값(BranchPanelRow.tsx의 CHIP_BUTTON): 24px 높이, --chip 배경, 11.5px/600.
const CHIP_BUTTON =
  "h-6 px-2.5 rounded-[6px] bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-(--chip)";

interface WorktreePanelRowProps {
  worktree: WorktreeInfo;
  isCurrent: boolean;
  isActive: boolean;
  canRemove: boolean;
  onOpen: () => void;
  onOpenTerminal: () => void;
  onOpenEditor: () => void;
  onRemove: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

/**
 * 워크트리 패널 행(브랜치 패널 `BranchPanelRowView`와 같은 자리·같은 anatomy):
 * 아이콘 · 고정폭 글꼴 브랜치 이름 · 둘째 줄 기반 브랜치(`WorktreeBaseLabel` 재사용) ·
 * 올리면 뜨는 Open / Terminal / Editor / Remove.
 */
export function WorktreePanelRow({
  worktree,
  isCurrent,
  isActive,
  canRemove,
  onOpen,
  onOpenTerminal,
  onOpenEditor,
  onRemove,
  onContextMenu,
}: WorktreePanelRowProps) {
  const { t } = useTranslation();
  const dirName = worktree.path.split("/").filter(Boolean).pop() ?? worktree.path;
  const isMissing = worktree.isPrunable;

  return (
    <div
      data-worktree-path={worktree.path}
      data-active={isActive || undefined}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex items-center gap-2 min-h-[42px] px-3.5 py-1 border-b border-(--line) transition-colors",
        isActive ? "bg-(--acc-sel)" : "hover:bg-(--acc-sel)",
        isMissing && "opacity-60",
      )}
    >
      <span className="w-3.5 shrink-0 flex justify-center">
        {isCurrent ? (
          <Check className="w-[13px] h-[13px] text-(--fg)" strokeWidth={2.5} aria-label={t("branchPanel.current")} />
        ) : (
          <WorktreeIcon className="w-3.5 h-3.5 text-(--faint)" />
        )}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={cn("font-mono text-xs text-(--fg) truncate", isCurrent ? "font-bold" : "font-medium")}>
            {worktree.branch ?? t("worktree.detachedHead")}
          </span>
          {worktree.isLocked && (
            <span title={worktree.lockReason ?? t("worktree.locked")}>
              <Lock className="w-3 h-3 text-warning shrink-0" />
            </span>
          )}
          {isMissing && (
            <span className="shrink-0 text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded">
              {t("worktree.missing")}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-(--faint) truncate">
          {worktree.base ? (
            <WorktreeBaseLabel base={worktree.base} className="text-(--faint)" />
          ) : (
            <span className="truncate">{dirName}</span>
          )}
        </span>
      </span>

      <span className="flex gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" onClick={onOpen} disabled={isMissing} className={CHIP_BUTTON}>
          {t("worktreePanel.open")}
        </button>
        <button type="button" onClick={onOpenTerminal} disabled={isMissing} className={CHIP_BUTTON}>
          {t("worktreePanel.terminal")}
        </button>
        <button type="button" onClick={onOpenEditor} disabled={isMissing} className={CHIP_BUTTON}>
          {t("worktreePanel.editor")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className={cn(CHIP_BUTTON, "hover:text-danger")}
        >
          {t("worktreePanel.remove")}
        </button>
      </span>
    </div>
  );
}
