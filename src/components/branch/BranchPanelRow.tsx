import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Count, RefLabel } from "@/components/ui/marks";
import { laneColor } from "@/components/graph/graph-model";
import { cn, formatRelativeTime } from "@/lib/utils";
import { worktreeBaseTitle } from "@/lib/worktree-base";
import type { BranchBaseInfo } from "@/types";
import type { BranchPanelRow } from "./branch-panel-model";
import { BranchStatusBadge } from "./BranchStatusBadge";

interface BranchPanelRowViewProps {
  row: BranchPanelRow;
  /** 기반 브랜치 정보. 아직 못 받았거나 묻지 않는 행(기본·원격)이면 undefined. */
  baseInfo: BranchBaseInfo | undefined;
  /** 화살표 키로 고른 행. */
  isActive: boolean;
  canCompare: boolean;
  /** 그래프가 체크아웃하지 않고 이 브랜치를 보는 중인지. */
  isViewed?: boolean;
  /** 행을 누르면: 체크아웃하지 않고 이 브랜치의 이력을 본다. */
  onView: () => void;
  /** 「체크아웃」(다른 워크트리가 쓰는 브랜치는 「이동」) 버튼. */
  onPrimary: () => void;
  onCompare: () => void;
  onMerge: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

/**
 * 행 둘째 줄(시안 D6). 칸마다 보이는 것이 다르다.
 * - 기본 브랜치: 「기본 브랜치 · origin/main과 같음」
 * - 워크트리 칸: 기반 브랜치 · 작성자 (누가 그 워크트리에서 일하는지)
 * - 로컬 칸: 기반 브랜치 · 마지막 커밋 시각. merge된 브랜치는 「X에 merge됨 · 정리 가능」
 * - 원격 칸: 「원격에만 있음 · 마지막 커밋 시각」
 */
export function branchSubtitle(row: BranchPanelRow, baseInfo: BranchBaseInfo | undefined, t: TFunction): string {
  const { branch, section } = row;
  const time = branch.lastCommitTime != null ? formatRelativeTime(branch.lastCommitTime) : null;
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

  if (branch.isRemote) return join(t("branchPanel.remoteOnly"), time);
  if (branch.isDefault) {
    const synced = branch.aheadBehind && branch.aheadBehind.ahead === 0 && branch.aheadBehind.behind === 0;
    return join(
      t("branchPanel.defaultBranch"),
      branch.upstream && synced ? t("branchPanel.sameAsUpstream", { upstream: branch.upstream }) : null,
    );
  }
  const base = baseInfo?.base ?? null;
  if (base && baseInfo?.mergedIntoBase) {
    return join(t("branchPanel.mergedInto", { base: base.name }), t("branchPanel.canCleanUp"));
  }
  const from = base ? t("worktree.base.from", { base: base.name }) : null;
  const baseText = base && base.source === "inferred" ? `${from} (${t("worktree.base.inferred")})` : from;
  if (section === "inWorktree") return join(baseText, branch.lastCommitAuthor?.name);
  return join(baseText, time);
}

/** 오른쪽 ↑: 기반 브랜치보다 앞선 커밋 수. 기본 브랜치는 원격보다 앞선 커밋 수. */
function aheadCount(row: BranchPanelRow, baseInfo: BranchBaseInfo | undefined): number {
  if (row.branch.isDefault) return row.branch.aheadBehind?.ahead ?? 0;
  return baseInfo?.base?.aheadOfBase ?? 0;
}

export function BranchPanelRowView({
  row,
  baseInfo,
  isActive,
  canCompare,
  isViewed = false,
  onView,
  onPrimary,
  onCompare,
  onMerge,
  onContextMenu,
}: BranchPanelRowViewProps) {
  const { t } = useTranslation();
  const { branch, worktree, action } = row;
  const isCurrent = action === "current";
  const ahead = aheadCount(row, baseInfo);
  const base = baseInfo?.base ?? null;
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
      {/* 행 본문을 누르면 체크아웃하지 않고 그 브랜치를 본다. 체크아웃은 오른쪽 버튼으로만 한다. */}
      <button
        type="button"
        onClick={onView}
        title={t(isCurrent ? "branchPanel.viewCurrentHint" : "branchPanel.viewHint", { name: branch.name })}
        className="flex-1 min-w-0 flex items-center gap-2 self-stretch text-left"
      >
      <span className="w-3.5 shrink-0 flex justify-center">
        {isCurrent ? (
          <Check className="w-[13px] h-[13px] text-(--fg)" strokeWidth={2.5} aria-label={t("branchPanel.current")} />
        ) : isViewed ? (
          <Eye className="w-[13px] h-[13px] text-info" strokeWidth={2.5} aria-label={t("branchPanel.viewing")} />
        ) : null}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={cn("font-mono text-[11.5px] text-(--fg) truncate", isCurrent ? "font-bold" : "font-medium")}>
            {branch.name}
          </span>
          <BranchStatusBadge branch={branch} />
          {worktreeLabel && worktree && (
            <RefLabel
              name={worktreeLabel}
              kind="worktree"
              laneColor={laneColor(worktree.path, 0)}
              className="max-w-[140px]"
            />
          )}
        </span>
        <span className="text-[11.5px] text-muted-foreground truncate" title={base ? worktreeBaseTitle(base, t) : undefined}>
          {branchSubtitle(row, baseInfo, t)}
        </span>
      </span>
      </button>

      {/* ↑ 수와 버튼은 한 자리에 겹쳐 두고, 행에 올리거나 초점이 오면 버튼을 보인다(시안 D6). */}
      <span className="grid shrink-0 items-center justify-items-end">
        <span
          className={cn(
            "[grid-area:1/1] transition-opacity group-hover:opacity-0 group-focus-within:opacity-0",
            isActive && "opacity-0",
          )}
          title={base ? worktreeBaseTitle(base, t) : undefined}
        >
          {ahead > 0 && <Count value={ahead} prefix="↑" tone="sync" />}
        </span>
        <span
          className={cn(
            "[grid-area:1/1] flex gap-1 transition-opacity opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
            isActive && "opacity-100 pointer-events-auto",
          )}
        >
          {!isCurrent && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onPrimary}
              title={
                action === "openWorktree" && worktreeLabel
                  ? t("branchPanel.openHint", { name: worktreeLabel })
                  : undefined
              }
            >
              {action === "openWorktree" ? t("branchPanel.open") : t("branchPanel.switch")}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onCompare} disabled={!canCompare}>
            {t("branchPanel.compare")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onMerge} disabled={!canCompare}>
            {t("branchPanel.merge")}
          </Button>
        </span>
      </span>
    </div>
  );
}
