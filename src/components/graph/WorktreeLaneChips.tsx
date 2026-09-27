import type { MouseEvent } from "react";
import { FolderGit2, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Count } from "@/components/ui/marks";
import { FilterChip } from "@/components/ui/FilterChip";
import type { WorktreeBase } from "@/types";

/** 칩 하나가 나타내는 워크트리(저장소 단계의 레인 하나). */
export interface WorktreeChip {
  path: string;
  /** 체크아웃한 브랜치. detached HEAD면 null(폴더 이름을 대신 쓴다). */
  branch: string | null;
  isMain: boolean;
  /** 지금 연 워크트리(그래프 이력의 주인). 늘 보이므로 끌 수 없다. */
  isCurrent: boolean;
  /** 어디서 갈라졌는지. 메인·detached·아직 모름이면 null. */
  base: WorktreeBase | null;
  /** 커밋하지 않은 파일 수. 모르면 null. */
  dirtyCount: number | null;
  /** 견본 색(그래프에서 그 워크트리의 레인·WIP 행·브랜치 이름표와 같은 색). */
  color: string;
}

export function worktreeChipName(chip: Pick<WorktreeChip, "branch" | "path">): string {
  return chip.branch ?? chip.path.split("/").pop() ?? chip.path;
}

export interface WorktreeLaneChipsProps {
  chips: readonly WorktreeChip[];
  /** 그래프에 보이는 워크트리 경로. */
  visible: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onContextMenu?: (chip: WorktreeChip, e: MouseEvent) => void;
}

/**
 * 저장소 단계 필터 막대의 워크트리 칩(3.14, 5.1). 견본 색이 그래프에서 그 워크트리의 레인 색이다.
 * 지금 연 워크트리는 그래프 이력의 주인이라 늘 켜져 있다(`locked`).
 */
export function WorktreeLaneChips({ chips, visible, onToggle, onContextMenu }: WorktreeLaneChipsProps) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("overlap.chipsLabel")} className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
      {chips.map((chip) => {
        const on = chip.isCurrent || visible.has(chip.path);
        const Icon = chip.isMain ? GitBranch : FolderGit2;
        const from = chip.isMain ? t("overlap.chipMain") : chip.base ? t("overlap.chipFrom", { base: chip.base.name }) : null;
        return (
          <span
            key={chip.path}
            className="contents"
            onContextMenu={
              onContextMenu
                ? (e) => {
                    e.preventDefault();
                    onContextMenu(chip, e);
                  }
                : undefined
            }
          >
            <FilterChip
              pressed={on}
              locked={chip.isCurrent}
              swatchColor={chip.color}
              icon={<Icon className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
              title={[chip.isCurrent ? t("overlap.chipCurrent", { path: chip.path }) : chip.path, from]
                .filter(Boolean)
                .join(" · ")}
              count={
                chip.dirtyCount !== null && chip.dirtyCount > 0 ? (
                  <span title={t("overlap.chipDirty", { count: chip.dirtyCount })}>
                    <Count value={chip.dirtyCount} prefix="●" tone="live" />
                  </span>
                ) : undefined
              }
              onClick={() => onToggle(chip.path)}
            >
              <span className="font-mono">{worktreeChipName(chip)}</span>
            </FilterChip>
          </span>
        );
      })}
    </div>
  );
}
