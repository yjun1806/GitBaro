import { Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RowBadges } from "./RowBadges";
import { TreeRowFrame } from "./TreeRowFrame";
import type { Totals } from "./tree-model";

interface WorkspaceRowProps {
  name: string;
  repoCount: number;
  totals: Totals;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * 워크스페이스 행: 폴더 아이콘, 이름, 「워크스페이스 · 저장소 N」, 안에 든 저장소의 합계 표시.
 * 워크스페이스를 고르는 동작(여러 저장소 리뷰 화면)은 W4에서 붙는다. 지금은 누르면 접고 편다.
 */
export function WorkspaceRow({ name, repoCount, totals, expanded, onToggle }: WorkspaceRowProps) {
  const { t } = useTranslation();
  return (
    <TreeRowFrame
      level={2}
      depth={0}
      label={name}
      expanded={expanded}
      onToggle={onToggle}
      tall
    >
      <span className="w-5 h-5 rounded-[var(--radius-chip)] bg-muted flex items-center justify-center shrink-0">
        <Folder className="w-[13px] h-[13px] text-[var(--fg2)]" aria-hidden="true" />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-px">
        <span className="text-[12.5px] font-bold text-foreground truncate">{name}</span>
        <span className="text-[10.5px] text-muted-foreground truncate">
          {t("sidebarTree.workspaceSubtitle", { count: repoCount })}
        </span>
      </span>
      <RowBadges dirty={totals.dirty} newCommits={totals.newCommits} />
    </TreeRowFrame>
  );
}
