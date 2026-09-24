import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check } from "lucide-react";
import { WorktreeIcon } from "@/components/ui/WorktreeIcon";
import { laneColor } from "@/components/graph/graph-model";
import { cn, formatRelativeTime } from "@/lib/utils";
import { worktreeBaseTitle } from "@/lib/worktree-base";
import type { WorktreeBase } from "@/types";
import type { BranchPanelRow } from "./branch-panel-model";
import { BranchStatusBadge } from "./BranchStatusBadge";

interface BranchPanelRowViewProps {
  row: BranchPanelRow;
  /** 기반 브랜치. 아직 모르면 undefined, 계산했는데 없으면 null. */
  base: WorktreeBase | null | undefined;
  /** 화살표 키로 고른 행. */
  isActive: boolean;
  canCompare: boolean;
  onPrimary: () => void;
  onCompare: () => void;
  onMerge: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

const CHIP_BUTTON =
  "h-[22px] px-2 rounded-(--radius-chip) bg-card border border-(--line2) text-[11px] font-semibold text-(--fg2) hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card";

/** 행 둘째 줄: 기반 브랜치(또는 기본·원격 표시) · 마지막 커밋 시각 · 작성자. */
export function branchSubtitle(row: BranchPanelRow, base: WorktreeBase | null | undefined, t: TFunction): string {
  const { branch } = row;
  const parts: string[] = [];
  if (branch.isRemote) {
    parts.push(t("branchPanel.remoteOnly"));
  } else if (branch.isDefault) {
    parts.push(t("branchPanel.defaultBranch"));
    const synced = branch.aheadBehind && branch.aheadBehind.ahead === 0 && branch.aheadBehind.behind === 0;
    if (branch.upstream && synced) parts.push(t("branchPanel.sameAsUpstream", { upstream: branch.upstream }));
  } else if (base) {
    const merged = base.aheadOfBase === 0 && base.behindBase > 0;
    const text = merged
      ? t("branchPanel.containedIn", { base: base.name })
      : t("worktree.base.from", { base: base.name });
    parts.push(base.source === "inferred" ? `${text} (${t("worktree.base.inferred")})` : text);
  }
  if (branch.lastCommitTime != null) parts.push(formatRelativeTime(branch.lastCommitTime));
  if (branch.lastCommitAuthor?.name) parts.push(branch.lastCommitAuthor.name);
  return parts.join(" · ");
}

/** 오른쪽 ↑: 기반 브랜치보다 앞선 커밋 수. 기본 브랜치는 원격보다 앞선 커밋 수. */
function aheadCount(row: BranchPanelRow, base: WorktreeBase | null | undefined): number {
  if (row.branch.isDefault) return row.branch.aheadBehind?.ahead ?? 0;
  return base?.aheadOfBase ?? 0;
}

export function BranchPanelRowView({
  row,
  base,
  isActive,
  canCompare,
  onPrimary,
  onCompare,
  onMerge,
  onContextMenu,
}: BranchPanelRowViewProps) {
  const { t } = useTranslation();
  const { branch, worktree, action } = row;
  const isCurrent = action === "current";
  const ahead = aheadCount(row, base);
  const worktreeLabel = worktree
    ? worktree.isMain
      ? t("branchPanel.mainWorktree")
      : (worktree.path.split("/").filter(Boolean).pop() ?? worktree.path)
    : null;

  return (
    <div
      data-branch-name={branch.name}
      data-active={isActive || undefined}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex items-center gap-2 min-h-[42px] px-3.5 py-1 border-b border-(--line) transition-colors",
        isActive ? "bg-(--acc-sel)" : "hover:bg-(--acc-sel)",
      )}
    >
      <span className="w-3.5 shrink-0 flex justify-center">
        {isCurrent && <Check className="w-[13px] h-[13px] text-(--fg)" strokeWidth={2.5} aria-label={t("branchPanel.current")} />}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={cn("font-mono text-xs text-(--fg) truncate", isCurrent ? "font-bold" : "font-medium")}>
            {branch.name}
          </span>
          <BranchStatusBadge branch={branch} />
          {worktreeLabel && worktree && (
            <span
              className="inline-flex items-center gap-1 shrink-0 max-w-[140px] px-[7px] py-px rounded-(--radius-chip) bg-card border text-[10.5px] font-bold text-(--fg2)"
              style={{ borderColor: laneColor(worktree.path, 0) }}
              title={worktree.path}
            >
              <WorktreeIcon className="w-2.5 h-2.5" />
              <span className="truncate">{worktreeLabel}</span>
            </span>
          )}
        </span>
        <span className="text-[11px] text-(--faint) truncate" title={base ? worktreeBaseTitle(base, t) : undefined}>
          {branchSubtitle(row, base, t)}
        </span>
      </span>

      {/* ↑ 수와 버튼은 한 자리에 겹쳐 두고, 행에 올리거나 초점이 오면 버튼을 보인다(시안 D6). */}
      <span className="grid shrink-0 items-center justify-items-end">
        <span
          className={cn(
            "[grid-area:1/1] text-[11px] text-(--faint) tabular-nums transition-opacity group-hover:opacity-0 group-focus-within:opacity-0",
            isActive && "opacity-0",
          )}
          title={base ? worktreeBaseTitle(base, t) : undefined}
        >
          {ahead > 0 ? `↑${ahead}` : ""}
        </span>
        <span
          className={cn(
            "[grid-area:1/1] flex gap-1 transition-opacity opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
            isActive && "opacity-100 pointer-events-auto",
          )}
        >
          {!isCurrent && (
            <button
              type="button"
              onClick={onPrimary}
              className={CHIP_BUTTON}
              title={
                action === "openWorktree" && worktreeLabel
                  ? t("branchPanel.openHint", { name: worktreeLabel })
                  : undefined
              }
            >
              {action === "openWorktree" ? t("branchPanel.open") : t("branchPanel.switch")}
            </button>
          )}
          <button type="button" onClick={onCompare} disabled={!canCompare} className={CHIP_BUTTON}>
            {t("branchPanel.compare")}
          </button>
          <button type="button" onClick={onMerge} disabled={!canCompare} className={CHIP_BUTTON}>
            {t("branchPanel.merge")}
          </button>
        </span>
      </span>
    </div>
  );
}
