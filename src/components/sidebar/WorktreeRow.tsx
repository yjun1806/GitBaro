import { FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorktreeBaseLabel } from "@/components/worktree/WorktreeBaseLabel";
import type { PathSignals } from "@/lib/repo-tree";
import type { WorktreeBase } from "@/types";
import { LiveDot, RowBadges } from "./RowBadges";
import { TreeRowFrame } from "./TreeRowFrame";

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

/** 워크트리 행: 브랜치 이름과 「어디서 갈라졌는지」(`WorktreeBaseLabel`), 오른쪽 표시. */
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
  const name = branch ?? path.split("/").pop() ?? path;
  return (
    <TreeRowFrame
      level={level}
      depth={depth}
      label={name}
      selected={selected}
      onSelect={onSelect}
    >
      <span className="relative w-5 flex justify-center shrink-0" title={t("sidebarTree.worktree")}>
        <FolderGit2 className="w-[13px] h-[13px] text-muted-foreground" aria-hidden="true" />
        {live && <LiveDot watched={watched} className="absolute -left-0.5 -top-0.5" />}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-px" title={path}>
        <span className="font-mono text-[11.5px] text-[var(--fg2)] truncate">{name}</span>
        {base && <WorktreeBaseLabel base={base} />}
      </span>
      <RowBadges
        dirty={signals?.dirtyCount}
        newCommits={signals?.newCommits}
        ahead={signals?.ahead}
        behind={signals?.behind}
      />
    </TreeRowFrame>
  );
}
