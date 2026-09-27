import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, GitCompare, X } from "lucide-react";
import { useBranchComparison, useBranches, useCommitStats, useStatus } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { computeGraphLanes } from "@/lib/graph-lanes";
import { getErrorMessage } from "@/lib/utils";
import { GRAPH_COLUMNS, GraphRow, NARROW_HIDDEN_CLASS } from "@/components/graph/GraphRow";
import { graphColumnWidth, laneColor } from "@/components/graph/graph-model";
import { BranchMergeDialog } from "./BranchMergeDialog";
import { CommitContextMenu } from "@/components/history/CommitContextMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { gitHubRepoUrl } from "@/lib/utils";
import type { CommitInfo } from "@/types";
import { rangeLabel, rangeLaneInput, useBranchRangeStore, type BranchRange } from "./branch-range";
import { LoadingState } from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/marks";
import { Notice } from "@/components/ui/Notice";
import { EmptyState } from "@/components/ui/EmptyState";

interface BranchRangeGraphProps {
  range: BranchRange;
  /** 지금 브랜치. `base`가 지금 브랜치일 때만 머리글에 Merge 버튼을 둔다. */
  currentBranch: string | null;
  /** 목록 맨 위에 둘 행(WIP 행). */
  top?: ReactNode;
  onSelectCommit: (id: string) => void;
}

/**
 * 커밋 그래프의 범위 모드. `base..target`(target에만 있는 커밋)만 레인 그래프로 그린다.
 * 머리글에서 방향을 바꾸거나(target..base), 지금 브랜치로 가져오거나(Merge…), 범위 보기를 끝낸다.
 */
export function BranchRangeGraph({ range, currentBranch, top, onSelectCommit }: BranchRangeGraphProps) {
  const { t } = useTranslation();
  const swap = useBranchRangeStore((s) => s.swap);
  const clear = useBranchRangeStore((s) => s.clear);
  const colorSeed = useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath ?? "");
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const { data: statusFiles = [] } = useStatus(range.repoPath);
  const { data, isLoading, error } = useBranchComparison(range.repoPath, range.base, range.target);
  const { data: branches = [] } = useBranches(range.repoPath);
  const [showMerge, setShowMerge] = useState(false);
  // 커밋 우클릭: 복사·GitHub 보기. 범위 안 커밋은 체크아웃한 이력이 아닐 수 있어 git 동작은 두지 않는다.
  const [commitMenu, setCommitMenu] = useState<{ commit: CommitInfo; x: number; y: number } | null>(null);
  const gitHubUrl = useRepositoryStore((s) => gitHubRepoUrl(s.activeRepo?.remotes ?? []));
  // 비교 기준은 로컬 브랜치여야 한다(`compare_branches`). 원격 브랜치와는 방향을 바꿀 수 없다.
  const canSwap = branches.some((b) => !b.isRemote && b.name === range.target);

  // compare_branches의 behindCommits = target에만 있는 커밋 = base..target.
  const { commits, layouts, graphWidth } = useMemo(() => {
    const inRange = data?.behindCommits ?? [];
    const result = computeGraphLanes(rangeLaneInput(inRange));
    const byOid = new Map(result.rows.map((r) => [r.oid, r]));
    const maxLanes = result.rows.reduce((m, r) => Math.max(m, r.width), 1);
    return {
      commits: inRange.filter((c) => byOid.has(c.id)),
      layouts: byOid,
      graphWidth: graphColumnWidth(maxLanes),
    };
  }, [data]);
  const colorOf = useCallback((chain: number) => laneColor(colorSeed, chain), [colorSeed]);
  // 커밋 줄 「변경」 칸(3.15). CI 칸은 이 화면에서는 비운다(비교 대상은 체크아웃한 이력이 아닐 수 있다).
  const commitStats = useCommitStats(
    range.repoPath,
    useMemo(() => commits.map((c) => c.id), [commits]),
  );

  const selectedIdx = commits.findIndex((c) => c.id === selectedCommitId);
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: commits,
    onSelect: (c) => onSelectCommit(c.id),
    selectedIndex: selectedIdx,
  });

  const canMerge = currentBranch !== null && range.base === currentBranch && range.target !== currentBranch;

  return (
    <div className="@container/graph flex flex-col flex-1 min-h-0 overflow-hidden" data-testid="branch-range-graph">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-(--line) shrink-0 text-[11.5px]">
        <GitCompare className="w-3.5 h-3.5 text-(--muted) shrink-0" aria-hidden="true" />
        <span className="font-semibold text-(--fg2) shrink-0">{t("branchPanel.rangeTitle")}</span>
        <Code className="truncate min-w-0">{rangeLabel(range)}</Code>
        {data && (
          <span className="text-muted-foreground shrink-0">
            {t("branchPanel.rangeCount", { count: data.behindCount })}
          </span>
        )}
        <span className="flex-1" />
        {canSwap && (
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            onClick={swap}
            title={t("branchPanel.rangeSwap")}
            aria-label={t("branchPanel.rangeSwap")}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </Button>
        )}
        {canMerge && (
          <Button size="sm" variant="secondary" onClick={() => setShowMerge(true)}>
            {t("branchPanel.merge")}
          </Button>
        )}
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          onClick={clear}
          title={t("branchPanel.rangeClose")}
          aria-label={t("branchPanel.rangeClose")}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div
        className={GRAPH_COLUMNS + " h-6 shrink-0 pr-3 border-b border-(--line) text-[11.5px] font-semibold text-muted-foreground"}
        style={{ paddingLeft: graphWidth + 8 }}
        aria-hidden="true"
      >
        <span className="pl-3.5">{t("graph.colDescription")}</span>
        <span className={NARROW_HIDDEN_CLASS}>{t("graph.colChange")}</span>
        <span className={NARROW_HIDDEN_CLASS} title={t("graph.colCi")}>{t("graph.colCi")}</span>
        <span className={NARROW_HIDDEN_CLASS}>{t("graph.colAuthor")}</span>
        <span>{t("graph.colTime")}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
        {top}
        {isLoading ? (
          <LoadingState label={t("compare.loading")} />
        ) : error ? (
          <div className="p-3">
            <Notice tone="danger">{getErrorMessage(error)}</Notice>
          </div>
        ) : commits.length === 0 ? (
          <EmptyState layout="row" title={t("branchPanel.rangeEmpty", { base: range.base, target: range.target })} />
        ) : (
          commits.map((commit, index) => {
            const layout = layouts.get(commit.id);
            if (!layout) return null;
            return (
              <GraphRow
                key={commit.id}
                ref={itemRef(index)}
                commit={commit}
                layout={layout}
                graphWidth={graphWidth}
                colorOf={colorOf}
                remoteTags={null}
                stats={commitStats.get(commit.id)}
                isSelected={selectedCommitId === commit.id}
                isHighlighted={activeIndex === index}
                wipAbove={false}
                onClick={() => onSelectCommit(commit.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelectCommit(commit.id);
                  setCommitMenu({ commit, ...contextMenuPoint(e) });
                }}
              />
            );
          })
        )}
      </div>

      {commitMenu && (
        <CommitContextMenu
          commit={commitMenu.commit}
          gitHubUrl={gitHubUrl}
          position={{ x: commitMenu.x, y: commitMenu.y }}
          onClose={() => setCommitMenu(null)}
        />
      )}

      {showMerge && currentBranch && (
        <BranchMergeDialog
          repoPath={range.repoPath}
          currentBranch={currentBranch}
          source={range.target}
          isDirty={statusFiles.length > 0}
          onClose={() => setShowMerge(false)}
        />
      )}
    </div>
  );
}
