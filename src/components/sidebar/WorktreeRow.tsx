import { FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PathSignals } from "@/lib/repo-tree";
import { worktreeBaseTitle } from "@/lib/worktree-base";
import type { WorktreeBase } from "@/types";
import { LiveDot } from "./LiveDot";
import { RowSubline } from "./RowSubline";
import { TreeRowFrame } from "./TreeRowFrame";
import { liveDotLabel, metaLineParts, metaLineText } from "./row-meta";
import { NEUTRAL_TILE, ROW_TITLE, TILE_ICON } from "./row-style";

interface WorktreeRowProps {
  path: string;
  branch: string | null;
  /** 어디서 갈라졌는지. 아직 모르거나 detached면 null. 둘째 줄이 아니라 툴팁에 넣는다. */
  base: WorktreeBase | null;
  level: number;
  depth: number;
  signals: PathSignals | undefined;
  live: boolean;
  watched: boolean;
  /** 마지막으로 파일이 바뀐 시각(ms). `live`일 때만 쓴다. */
  changedAt: number;
  now: number;
  selected: boolean;
  onSelect: () => void;
}

/**
 * 워크트리 행: 첫 줄은 폴더 이름, 둘째 줄은 저장소 행과 같은 「⎇ 브랜치 · 수정 N · 새 커밋 N」.
 * 워크트리는 ↑↓를 그리지 않는다(시안 `gen_d.py`의 `wt_row`). 기반 브랜치(「main에서」)는 폭을 아끼려고 툴팁에 둔다.
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
  changedAt,
  now,
  selected,
  onSelect,
}: WorktreeRowProps) {
  const { t } = useTranslation();
  const folder = path.split("/").filter(Boolean).pop() ?? path;
  const name = branch ?? folder;
  const parts = metaLineParts({ dirty: signals?.dirtyCount, newCommits: signals?.newCommits }, t);
  const tooltip = [path, branch, base ? worktreeBaseTitle(base, t) : null, metaLineText(parts)]
    .filter(Boolean)
    .join("\n");
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
      <span className={NEUTRAL_TILE} title={t("sidebarTree.worktree")}>
        <FolderGit2 className={TILE_ICON} aria-hidden="true" />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-px" title={tooltip}>
        <span className={`${ROW_TITLE} ${selected ? "font-bold" : "font-medium"}`}>{folder}</span>
        <RowSubline branch={branch} parts={parts} />
      </span>
      {live && <LiveDot watched={watched} label={liveDotLabel(t, watched, now, changedAt)} />}
    </TreeRowFrame>
  );
}
