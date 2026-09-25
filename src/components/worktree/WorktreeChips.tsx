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
  /** 견본 색(그래프에서 그 워크트리의 레인·WIP 행·브랜치 이름표와 같은 색). */
  color: string;
}

export interface WorktreeChipsProps {
  chips: readonly WorktreeChip[];
  /** 그래프에 보이는 워크트리 경로. */
  visible: ReadonlySet<string>;
  onToggle: (path: string) => void;
  /** 꺼 둔 워크트리를 모두 켠다(「워크트리 N개 더 · 함께 보기」). */
  onShowAll?: () => void;
  /** 다른 워크트리를 모두 끈다(「지금 워크트리만」). */
  onShowCurrentOnly?: () => void;
  /** 칩 우클릭. */
  onContextMenu?: (chip: WorktreeChip, e: React.MouseEvent) => void;
}

export function worktreeChipName(chip: Pick<WorktreeChip, "branch" | "path">): string {
  return chip.branch ?? chip.path.split("/").pop() ?? chip.path;
}

/**
 * 그래프 패널 위의 「함께 보는 워크트리」 줄(시안 D5). 범례이자 켜고 끄는 칩이다: 칩의 견본 색이
 * 그래프에서 그 워크트리의 레인 색이다. 처음에는 지금 연 워크트리만 켜져 있고, 끝의 버튼으로
 * 나머지를 한 번에 켠다. 지금 연 워크트리는 강조 테두리로 표시하고 늘 보인다.
 */
export function WorktreeChips({
  chips,
  visible,
  onToggle,
  onShowAll,
  onShowCurrentOnly,
  onContextMenu,
}: WorktreeChipsProps) {
  const { t } = useTranslation();
  const hiddenCount = chips.filter((c) => !c.isCurrent && !visible.has(c.path)).length;
  const othersShown = chips.some((c) => !c.isCurrent && visible.has(c.path));
  return (
    <div
      role="group"
      aria-label={t("overlap.chipsLabel")}
      className="flex items-center gap-2 px-3 py-2 shrink-0 overflow-x-auto border-b border-(--line) bg-(--acc-faint)"
    >
      <span className="shrink-0 text-[11.5px] font-semibold text-muted-foreground">{t("overlap.legendLabel")}</span>
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
            onContextMenu={
              onContextMenu
                ? (e) => {
                    e.preventDefault();
                    onContextMenu(chip, e);
                  }
                : undefined
            }
            className={cn(
              "flex items-center gap-2 shrink-0 h-[30px] px-2.5 rounded-(--radius-item) border text-[12px] transition-colors",
              chip.isCurrent
                ? "border-(--acc) bg-card"
                : on
                  ? "border-(--line2) bg-card hover:bg-accent"
                  : "border-dashed border-(--line2) bg-transparent opacity-60 hover:opacity-100",
            )}
          >
            <span
              aria-hidden="true"
              data-testid="chip-swatch"
              className={cn("w-2.5 h-2.5 rounded-[3px] shrink-0", !on && "opacity-40")}
              style={{ background: chip.color }}
            />
            <Icon className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className={cn("font-mono text-foreground", chip.isCurrent ? "font-bold" : "font-medium")}>
              {name}
            </span>
            <span
              className="text-[11px] text-(--faint)"
              title={chip.isMain ? t("worktree.primaryFolderHint") : undefined}
            >
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
      {hiddenCount > 0 && onShowAll ? (
        <button
          type="button"
          onClick={onShowAll}
          className="shrink-0 h-6 px-2.5 rounded-(--radius-chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
        >
          {t("overlap.showMore", { count: hiddenCount })}
        </button>
      ) : othersShown && onShowCurrentOnly ? (
        <button
          type="button"
          onClick={onShowCurrentOnly}
          className="shrink-0 h-6 px-2.5 rounded-(--radius-chip) text-[11.5px] font-semibold text-muted-foreground hover:bg-accent transition-colors"
        >
          {t("overlap.showCurrentOnly")}
        </button>
      ) : null}
    </div>
  );
}
