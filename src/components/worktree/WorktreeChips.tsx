import { FolderGit2, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { WorktreeBase } from "@/types";

/** 칩 하나가 나타내는 워크트리. */
export interface WorktreeChip {
  path: string;
  /** 체크아웃한 브랜치. detached HEAD면 null(폴더 이름을 대신 쓴다). */
  branch: string | null;
  isMain: boolean;
  /** 지금 연 워크트리(그래프 이력의 주인). 늘 표시하므로 끌 수 없다. */
  isCurrent: boolean;
  /** 어디서 갈라졌는지. 메인·detached·아직 모름이면 null. */
  base: WorktreeBase | null;
  /** 커밋하지 않은 파일 수. 모르면 null. */
  dirtyCount: number | null;
  /** 아이콘 색(그래프의 그 워크트리 WIP 행과 같은 색). */
  color: string;
}

export interface WorktreeChipsProps {
  chips: readonly WorktreeChip[];
  /** 그래프에 보이는 워크트리 경로. */
  visible: ReadonlySet<string>;
  onToggle: (path: string) => void;
}

export function worktreeChipName(chip: Pick<WorktreeChip, "branch" | "path">): string {
  return chip.branch ?? chip.path.split("/").pop() ?? chip.path;
}

/**
 * 그래프 패널 위의 워크트리 칩 줄(시안 D5). 칩을 눌러 그 워크트리의 WIP 행과 커밋을
 * 그래프에 함께 그릴지 고른다. 지금 연 워크트리는 강조 테두리로 표시하고 늘 보인다.
 */
export function WorktreeChips({ chips, visible, onToggle }: WorktreeChipsProps) {
  const { t } = useTranslation();
  const shown = chips.filter((c) => c.isCurrent || visible.has(c.path)).length;
  return (
    <div
      role="group"
      aria-label={t("overlap.chipsLabel")}
      className="flex items-center gap-2 px-3 py-2 shrink-0 overflow-x-auto border-b border-(--line) bg-(--acc-faint)"
    >
      {chips.map((chip) => {
        const on = chip.isCurrent || visible.has(chip.path);
        const name = worktreeChipName(chip);
        const Icon = chip.isMain ? GitBranch : FolderGit2;
        return (
          <button
            key={chip.path}
            type="button"
            aria-pressed={on}
            aria-disabled={chip.isCurrent || undefined}
            title={chip.isCurrent ? t("overlap.chipCurrent", { path: chip.path }) : chip.path}
            onClick={() => {
              if (!chip.isCurrent) onToggle(chip.path);
            }}
            className={cn(
              "flex items-center gap-2 shrink-0 h-[30px] px-2.5 rounded-(--radius-item) border text-[12px] transition-colors",
              chip.isCurrent
                ? "border-(--acc) bg-card"
                : on
                  ? "border-(--line2) bg-card hover:bg-accent"
                  : "border-dashed border-(--line2) bg-transparent opacity-60 hover:opacity-100",
            )}
          >
            <Icon className="w-3 h-3 shrink-0" style={{ color: chip.color }} aria-hidden="true" />
            <span className={cn("font-mono text-foreground", chip.isCurrent ? "font-bold" : "font-medium")}>
              {name}
            </span>
            <span className="text-[11px] text-(--faint)">
              {chip.isMain
                ? t("overlap.chipMain")
                : chip.base
                  ? t("overlap.chipFrom", { base: chip.base.name })
                  : null}
            </span>
            {chip.dirtyCount !== null && chip.dirtyCount > 0 && (
              <span
                title={t("overlap.chipDirty", { count: chip.dirtyCount })}
                className="flex items-center gap-[3px] text-[11px] font-bold text-(--live)"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-(--live)" aria-hidden="true" />
                {chip.dirtyCount}
              </span>
            )}
          </button>
        );
      })}
      <span className="flex-1" />
      <span className="shrink-0 text-[11.5px] text-muted-foreground">
        {t("overlap.chipsShown", { count: shown })}
      </span>
    </div>
  );
}
