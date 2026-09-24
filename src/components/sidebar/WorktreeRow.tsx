import { FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import type { PathSignals } from "@/lib/repo-tree";
import { worktreeBaseTitle } from "@/lib/worktree-base";
import type { WorktreeBase } from "@/types";
import { BranchLine } from "./BranchLine";
import { LiveDot, RowBadges } from "./RowBadges";
import { TreeRowFrame } from "./TreeRowFrame";
import { BASE_MAX_CHARS, NEUTRAL_TILE, ROW_TITLE, TILE_ICON } from "./row-style";

interface WorktreeRowProps {
  path: string;
  branch: string | null;
  /** 어디서 갈라졌는지. 아직 모르거나 detached면 null. */
  base: WorktreeBase | null;
  level: number;
  depth: number;
  signals: PathSignals | undefined;
  live: boolean;
  watched: boolean;
  selected: boolean;
  onSelect: () => void;
}

/**
 * 워크트리 행: 첫 줄은 폴더 이름, 둘째 줄은 저장소 행과 같은 브랜치 줄(브랜치 + 「· main에서」).
 * 오른쪽 표시는 시안(`gen_d.py`의 `wt_row`)대로 커밋하지 않은 파일 수와 새 커밋 수만 보이고 ↑↓는 그리지 않는다.
 */
export function WorktreeRow({
  path,
  branch,
  base,
  level,
  depth,
  signals,
  live,
  watched,
  selected,
  onSelect,
}: WorktreeRowProps) {
  const { t } = useTranslation();
  const folder = path.split("/").filter(Boolean).pop() ?? path;
  const name = branch ?? folder;
  const baseSuffix = base ? t("sidebarTree.baseSuffix", { base: middleEllipsis(base.name, BASE_MAX_CHARS) }) : undefined;
  const subTitle = [branch, base ? worktreeBaseTitle(base, t) : null].filter(Boolean).join("\n");
  return (
    <TreeRowFrame
      level={level}
      depth={depth}
      treePath={path}
      label={name}
      selected={selected}
      onSelect={onSelect}
      tall
    >
      <span className="relative flex shrink-0" title={t("sidebarTree.worktree")}>
        <span className={NEUTRAL_TILE}>
          <FolderGit2 className={TILE_ICON} aria-hidden="true" />
        </span>
        {live && <LiveDot watched={watched} className="absolute -left-0.5 -top-0.5" />}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-px">
        <span className={`${ROW_TITLE} ${selected ? "font-bold" : "font-medium"}`} title={path}>
          {folder}
        </span>
        <BranchLine branch={branch} suffix={baseSuffix} title={subTitle || undefined} />
      </span>
      <RowBadges dirty={signals?.dirtyCount} newCommits={signals?.newCommits} />
    </TreeRowFrame>
  );
}
