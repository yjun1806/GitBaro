import { useEffect, useMemo, useRef } from "react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useFollowStore } from "@/stores/follow";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useActiveRepoName } from "@/hooks/useRepoDisplay";
import { useStatus, useWorkflowRuns } from "@/api/queries";
import { GraphPanel, type LaneViewerSlot } from "@/components/graph/GraphPanel";
import { useGraphFilesView } from "@/components/graph/graph-files-view";
import { useHistoryView } from "@/components/graph/useHistoryView";
import { WorktreeLaneChips } from "@/components/graph/WorktreeLaneChips";
import { useWorktreeChipMenu } from "@/components/graph/useWorktreeChipMenu";
import { useWipRowMenu } from "@/components/graph/useWipRowMenu";
import type { GraphWip } from "@/components/graph/graph-model";
import type { LaneWip } from "@/components/graph/repo-lanes";
import { activeRange, useBranchRangeStore } from "@/components/branch/branch-range";
import { PrDetailPane } from "@/components/pr/PrDetailPane";
import { usePrViewStore } from "@/components/pr/pr-view";
import { ScopeViewToggle } from "@/components/scope/ScopeViewToggle";
import { useScope } from "@/components/scope/useScope";
import { FilterBar } from "@/components/ui/FilterBar";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { fileTouchSources } from "@/components/review/file-touches-model";
import { LaneGraphBody, LaneViewerBottom, useLaneSelection } from "@/components/review/lane-viewer";
import { useRepoWorktreeReview } from "@/components/review/useRepoWorktreeReview";
import { useReviewActivityRefresh } from "@/components/review/useReviewActivityRefresh";
import { trimTrailingSlash } from "@/lib/utils";
import { ContentArea, type MainTab } from "./ContentArea";
import { PaneStrip } from "./PaneStrip";

/** 저장소 단계가 아닌 화면(브랜치 단계 그래프, 스태시·Actions·PR 탭)에서 옆 칸을 열지 정한다. */
function useHasPaneContent(activeTab: MainTab, repoPath: string | null, prOpen: boolean): boolean {
  const selectedFile = useSelectionStore((s) => s.selectedFile);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const selectedStashIndex = useSelectionStore((s) => s.selectedStashIndex);
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const following = useFollowStore((s) => s.target !== null);
  const { data: status } = useStatus(repoPath);
  if (prOpen) return true;
  switch (activeTab) {
    case "changes":
      return selectedFile !== null || following || (status?.length ?? 0) > 0;
    case "history":
      return selectedCommitId !== null;
    case "stash":
      return selectedStashIndex !== null;
    default:
      return selectedRunId !== null;
  }
}

/**
 * 저장소를 골랐을 때의 메인 칸: 탭이 있는 그래프 패널(`GraphPanel`)과 그 옆 칸.
 *
 * 저장소 단계(5.1)의 그래프 탭은 워크트리마다 레인인 레인 뷰어다 — 워크스페이스 단계의 저장소 레인과
 * 같은 틀(`lane-viewer.tsx`)에 레인만 워크트리로 바꿨다. 이 단계의 선택(고른 커밋·WIP 행)은 뷰어가 들고
 * 있고, 옆 칸도 뷰어가 맡는다. 브랜치 단계와 스태시·Actions·PR 탭, 브랜치 비교, 다른 브랜치를 보는
 * 중에는 예전 그대로 전역 선택(`useSelectionStore`)과 `ContentArea`가 맡는다.
 */
export function RepoStep() {
  const activeTab = useUIStore((s) => s.activeTab);
  const prOpen = usePrViewStore((s) => s.open);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const scope = useScope();
  const { target: viewTarget } = useHistoryView();
  const branchRange = useBranchRangeStore((s) => s.range);
  const filesView = useGraphFilesView();

  const graphTab = !prOpen && activeTab !== "stash" && activeTab !== "actions";
  const ownerPath = scope?.kind === "repo" ? scope.repoPath : null;
  const viewerOn = ownerPath !== null && graphTab && viewTarget === null && activeRange(branchRange, activeRepoPath) === null;

  const data = useRepoWorktreeReview(viewerOn ? ownerPath : null, activeRepoPath);
  const lanes = useLaneSelection(data.graph, !data.isLoading);
  useReviewActivityRefresh(data.repoPaths);

  // 저장소 단계로 들어올 때마다 전역 선택을 비우고(브랜치 단계로 돌아갔을 때 옛 선택이 새 선택을 가리지
  // 않게), 다시 들어오면 뷰어의 선택도 `lastSelection`에서 새로 이어받는다.
  const wasOn = useRef<boolean | null>(null);
  const { reset } = lanes;
  useEffect(() => {
    if (viewerOn && wasOn.current !== true) {
      useSelectionStore.getState().clearAll();
      if (wasOn.current === false) reset();
    }
    wasOn.current = viewerOn;
  }, [viewerOn, reset]);

  const repoAccountId = useRepoAccountId();
  const hasRemote = activeRepo ? activeRepo.remotes.length > 0 : false;
  const { data: workflowRuns } = useWorkflowRuns(viewerOn && hasRemote ? ownerPath : null, repoAccountId);
  const repoName = useActiveRepoName();

  const visiblePaths = useMemo(() => new Set(data.visible.map((w) => w.path)), [data.visible]);
  const chipMenu = useWorktreeChipMenu({ visible: visiblePaths, toggle: data.toggle, showOnly: data.showOnly });
  const startFollow = useFollowStore((s) => s.start);
  const wipMenu = useWipRowMenu((wip) => {
    const row = data.graph.rows.find((r) => r.kind === "wip" && r.wip.path === wip.path);
    if (row?.kind !== "wip") return;
    startFollow(wip.path);
    lanes.pickWip(row.wip, row.key);
  });
  const handleWipContextMenu = (wip: LaneWip, position: { x: number; y: number }) => {
    const current = trimTrailingSlash(activeRepoPath ?? ownerPath ?? "") === trimTrailingSlash(wip.path);
    const graphWip: GraphWip = {
      path: wip.path,
      branch: wip.branch,
      count: wip.count,
      changedAt: wip.changedAt,
      isCurrent: current,
      isMain: wip.isMain,
      headOid: wip.headOid,
    };
    wipMenu.open(graphWip, position);
  };

  // 파일별 보기는 보이는 워크트리 모두를 읽는다. 대상이 실제로 바뀔 때만 새 목록을 넘긴다.
  const nextFileSources = ownerPath === null ? [] : fileTouchSources([{ path: ownerPath, worktrees: data.visible }]);
  const fileSourcesKey = JSON.stringify(nextFileSources);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fileSourcesKey가 nextFileSources의 내용을 대신 비교한다
  const fileSources = useMemo(() => nextFileSources, [fileSourcesKey]);

  const ownerOf = () => ownerPath ?? "";
  const laneViewer: LaneViewerSlot | null = viewerOn
    ? {
        filterBar: (
          <FilterBar
            left={
              data.chips.length > 1 ? (
                <WorktreeLaneChips
                  chips={data.chips}
                  visible={visiblePaths}
                  onToggle={data.toggle}
                  onContextMenu={(chip, e) => chipMenu.open(chip, contextMenuPoint(e))}
                />
              ) : undefined
            }
            right={<ScopeViewToggle />}
          />
        ),
        body: (
          <>
            <LaneGraphBody
              lanes={lanes}
              filesView={filesView}
              fileSources={fileSources}
              graph={data.graph}
              lanePaths={data.lanePaths}
              repoLabel={data.labelOf}
              fileRepoLabel={() => repoName}
              baseTime={data.baseTime}
              baseBranchLabel={data.baseBranchLabel}
              remoteName={data.remoteName}
              isLoading={data.isLoading}
              ciRuns={workflowRuns}
              ownerOf={ownerOf}
              onWipContextMenu={handleWipContextMenu}
            />
            {wipMenu.element}
            {chipMenu.element}
          </>
        ),
        onClose: () => lanes.pick(null),
      }
    : null;

  const legacyHasSelection = useHasPaneContent(activeTab, activeRepoPath, prOpen) && !filesView;
  const hasSelection = viewerOn ? lanes.selection !== null && !filesView : legacyHasSelection;

  return (
    <PaneStrip
      graph={<GraphPanel laneViewer={laneViewer} />}
      hasSelection={hasSelection}
      bottom={
        viewerOn ? (
          <LaneViewerBottom lanes={lanes} graph={data.graph} repoLabel={data.labelOf} ownerOf={ownerOf} />
        ) : prOpen ? (
          <PrDetailPane />
        ) : (
          <ContentArea activeTab={activeTab} />
        )
      }
    />
  );
}
