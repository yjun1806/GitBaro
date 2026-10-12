import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Archive, GitCommitVertical, GitPullRequest, Play } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useFollowStore } from "@/stores/follow";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useMergeState, useStashList, useWorkflowRuns } from "@/api/queries";
import { CommitGraph } from "./CommitGraph";
import { useGraphReview } from "./useGraphReview";
import { activeRange, useBranchRangeStore } from "@/components/branch/branch-range";
import type { HistoryTarget } from "@/types";
import { StashView } from "@/components/stash/StashView";
import { ActionsView } from "@/components/actions/ActionsView";
import { PrListView } from "@/components/pr/PrListView";
import { usePrViewStore } from "@/components/pr/pr-view";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { activeRunCount, badgeCount } from "@/components/review/tab-counts";
import { CompareChip } from "./CompareChip";
import { useHistoryView } from "./useHistoryView";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { FilterBar } from "@/components/ui/FilterBar";
import { NarrowPaneHeader } from "@/components/layout/NarrowPaneHeader";
import { useGraphNarrow } from "@/components/layout/pane-state";
import { useActiveRepoName } from "@/hooks/useRepoDisplay";
import { useGraphFilesView } from "./graph-files-view";
import type { GraphWip } from "./graph-model";
import { useScopeSources } from "@/components/scope/useScopeSources";
import { useScopeStore } from "@/components/scope/scope-store";
import { BranchOnlyChip } from "@/components/scope/BranchOnlyChip";
import { openedLaneId, type LaneSource } from "@/components/scope/scope-lanes";
import { carrySelection } from "@/components/scope/scope-selection";
import { sameScope, type Scope } from "@/components/scope/scope";
import { ScopeViewToggle } from "@/components/scope/ScopeViewToggle";
import { FileTouchesView } from "@/components/review/FileTouchesView";
import type { FileTouchSource } from "@/components/review/file-touches-model";

/** Which graph-panel tab a `ui.activeTab` value belongs to. */
export type GraphPanelTab = "graph" | "stash" | "actions";
/** Tabs the panel shows: the stored ones plus pull requests, which are unsaved view state. */
type ShownTab = GraphPanelTab | "pr";

/**
 * The graph tab covers both "changes" (the uncommitted row is selected) and
 * "history" (a commit is selected). Keeping the stored values as they were
 * lets the toolbar and merge flows that jump to "changes"/"history" keep
 * working unchanged.
 */
export function graphPanelTabOf(activeTab: "changes" | "history" | "stash" | "actions"): GraphPanelTab {
  return activeTab === "stash" || activeTab === "actions" ? activeTab : "graph";
}

/**
 * The repository step's graph tab (5.1): one lane per worktree, drawn by the lane viewer the
 * parent owns (`RepoStep`). The panel keeps the tabs and the narrow-list header around it.
 */
export interface LaneViewerSlot {
  /** Filter bar under the tabs (worktree chips, view toggle). Hidden in the narrow list. */
  filterBar: ReactNode;
  /** The lane graph, or the by-file view. */
  body: ReactNode;
  /** Clears the viewer's picked row (the narrow list's "close" button). */
  onClose: () => void;
}

export interface GraphPanelProps {
  /** Replaces the graph tab's single-worktree graph while the repository step is open. */
  laneViewer?: LaneViewerSlot | null;
}

/**
 * Full-width card above the file list and diff. Tabs: commit graph (lane
 * graph with a WIP row for the opened worktree on top, new-commit dots and the "seen up
 * to here" divider), stash, Actions, pull requests. On the graph tab the header
 * carries the "mark N new commits as seen" button.
 */
export function GraphPanel({ laneViewer = null }: GraphPanelProps) {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const clearCommitSelection = useSelectionStore((s) => s.clearCommitSelection);
  const clearAll = useSelectionStore((s) => s.clearAll);
  const repoAccountId = useRepoAccountId();

  const review = useGraphReview();
  const { data: stashes = [] } = useStashList(activeRepoPath);
  const hasRemote = activeRepo ? activeRepo.remotes.length > 0 : false;
  const { data: workflowRuns = [] } = useWorkflowRuns(
    hasRemote ? activeRepoPath : null,
    repoAccountId,
  );
  const runningCount = activeRunCount(workflowRuns);
  // 체크아웃하지 않고 다른 브랜치를 보는 중이면 체크아웃한 작업 트리의 것(WIP 행, 다른 워크트리
  // 칩)을 감춘다. 그 표시는 체크아웃한 브랜치에만 맞는 말이다.
  const { target: viewTarget, historyTarget } = useHistoryView();
  const viewing = viewTarget !== null;
  // 범위·비교 화면은 지금 연 워크트리의 커밋만 그린다 — 칩으로 고를 것이 없으니 칩 줄을 감춘다.
  const branchRange = useBranchRangeStore((s) => s.range);
  const graphListShown = activeRange(branchRange, activeRepoPath) === null;
  // 「PR」 탭은 저장하지 않는 화면 상태다. 다른 탭으로 옮기거나(툴바·merge 흐름 포함) 저장된 탭이
  // 바뀌면 닫고, 패널이 사라질 때(워크스페이스·저장소 목록으로 갈 때)도 닫는다. 저장된 탭(activeTab)의
  // "값"이 바뀔 때만 도는 effect라, 이미 그 값인 탭으로 다시 옮기려 하면 안 닫힌다. merge 진입(충돌
  // 포함)과 브랜치 비교 시작도 같은 이유로 별도로 지켜본다.
  const { data: mergeState } = useMergeState(activeRepoPath);
  const merging = mergeState !== undefined && mergeState !== null;
  const comparing = !graphListShown;
  const prOpen = usePrViewStore((s) => s.open);
  const setPrOpen = usePrViewStore((s) => s.setOpen);
  useEffect(() => {
    setPrOpen(false);
  }, [activeTab, merging, comparing, setPrOpen]);
  useEffect(() => () => setPrOpen(false), [setPrOpen]);
  const tab: ShownTab = prOpen ? "pr" : graphPanelTabOf(activeTab);
  const { scope, sources } = useScopeSources();
  // The branch step draws the opened worktree only; the other worktrees are lanes of the repository step.
  const currentWips = useMemo(() => review.wips.filter((w) => w.isCurrent), [review.wips]);
  const filesView = useGraphFilesView();
  const fileSources = useFileSources(scope);
  const repoName = useActiveRepoName();
  const narrow = useGraphNarrow();
  const tabLabel =
    tab === "graph" ? t("shell.graphTab") : tab === "stash" ? t("shell.stashTab") : tab === "pr" ? t("pr.tab") : t("actions.title");
  useCarriedSelection(scope, sources);
  const laneViewerShown = tab === "graph" && laneViewer !== null;
  const branchOnly = useScopeStore((s) => s.branchOnly);
  const setBranchOnly = useScopeStore((s) => s.setBranchOnly);
  const branchFilter =
    scope?.kind === "branch" ? { branch: scope.branch, on: branchOnly, onToggle: () => setBranchOnly(!branchOnly) } : undefined;
  // 그래프의 「이 브랜치만」: 기본 브랜치에서 갈라진 뒤의 제 커밋만 읽는다. 원격 브랜치·모든 브랜치를
  // 보는 중에는 브랜치 하나의 이력이 아니라서 걸지 않는다(칩도 감춘다).
  const graphBranchFilter =
    branchFilter && (viewTarget === null || (viewTarget.kind === "ref" && !viewTarget.isRemote)) ? branchFilter : undefined;
  const graphHistoryTarget: HistoryTarget =
    graphBranchFilter?.on && historyTarget.kind !== "all" ? { ...historyTarget, excludeDefault: true } : historyTarget;

  // 커밋을 새로 고를 때만 아래 칸을 커밋 상세로 바꾼다. 패널이 다시 마운트될 때
  // (저장소 목록을 열었다 닫을 때 등) 남아 있던 선택으로 스태시·Actions 탭에서
  // 끌려 나오지 않도록, 이전 값과 달라졌을 때만 반응한다.
  const prevCommitId = useRef(selectedCommitId);
  useEffect(() => {
    if (selectedCommitId && selectedCommitId !== prevCommitId.current) setActiveTab("history");
    prevCommitId.current = selectedCommitId;
  }, [selectedCommitId, setActiveTab]);

  // 「커밋하지 않은 변경」으로 넘어오면(행 클릭, 툴바·merge 흐름) 커밋 선택을 푼다.
  // 두 행이 함께 선택돼 보이지 않고, 같은 커밋을 다시 눌러도 위 효과가 다시 돈다.
  const prevTab = useRef(activeTab);
  useEffect(() => {
    if (activeTab === "changes" && prevTab.current !== "changes") clearCommitSelection();
    prevTab.current = activeTab;
  }, [activeTab, clearCommitSelection]);

  // 좁은 목록 머리의 「목록 닫고 그래프 넓게 보기」: 옆 칸이 열려 있게 하는 선택을 모두 풀어 0단계로 간다.
  // 커밋 안 한 변경 탭은 파일이 없어도 변경이 있으면 칸이 열리므로 커밋 탭으로 옮긴다.
  const closeSidePanes = () => {
    laneViewer?.onClose();
    clearAll();
    useFollowStore.getState().stop();
    setPrOpen(false);
    if (activeTab === "changes") setActiveTab("history");
  };

  const openGraphTab = () => {
    setPrOpen(false);
    setActiveTab(selectedCommitId ? "history" : "changes");
  };
  const openStoredTab = (next: "stash" | "actions") => {
    setPrOpen(false);
    setActiveTab(next);
  };
  const openPrTab = () => {
    setPrOpen(true);
  };

  return (
    <div role="region" aria-label={t("shell.panelTabs")} className="flex flex-col shrink-0 flex-1 h-full min-h-0">
      <Card className="relative flex-1 min-h-0">
        {narrow && <NarrowPaneHeader label={tabLabel} onClose={closeSidePanes} />}
        <div className={cn("flex items-center gap-2 pr-3 shrink-0 border-b border-(--line)", narrow && "hidden")}>
          <TabGroup aria-label={t("shell.panelTabs")} className="flex-1 min-w-0 gap-2 px-3 border-b-0">
            <Tab
              variant="inline"
              active={tab === "graph"}
              onClick={openGraphTab}
              icon={<GitCommitVertical className="w-3.5 h-3.5" />}
            >
              {t("shell.graphTab")}
            </Tab>
            <Tab
              variant="inline"
              active={tab === "stash"}
              onClick={() => openStoredTab("stash")}
              icon={<Archive className="w-3.5 h-3.5" />}
              count={badgeCount(stashes.length)}
            >
              {t("shell.stashTab")}
            </Tab>
            <Tab
              variant="inline"
              active={tab === "actions"}
              onClick={() => openStoredTab("actions")}
              icon={<Play className="w-3.5 h-3.5" />}
              count={badgeCount(runningCount)}
            >
              {t("actions.title")}
            </Tab>
            {hasRemote && (
              <Tab
                variant="inline"
                active={tab === "pr"}
                onClick={openPrTab}
                icon={<GitPullRequest className="w-3.5 h-3.5" />}
              >
                {t("pr.tab")}
              </Tab>
            )}
          </TabGroup>
          {tab === "graph" && <CompareChip />}
          {/* 「작업 중인 변경 N」은 아래 WIP 행이 말한다(여기 배지를 두지 않는다). */}
        </div>

        {laneViewerShown ? (
          !narrow && laneViewer.filterBar
        ) : (
          tab === "graph" &&
          graphListShown && (
            <FilterBar
              left={graphBranchFilter ? <BranchOnlyChip filter={graphBranchFilter} /> : undefined}
              right={narrow ? undefined : <ScopeViewToggle />}
            />
          )
        )}
        <div role="tabpanel" className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          {laneViewerShown ? (
            laneViewer.body
          ) : tab === "graph" && filesView ? (
            <FileTouchesView sources={fileSources} repoLabel={() => repoName} />
          ) : tab === "graph" ? (
            <CommitGraph
              wips={viewing ? NO_WIPS : currentWips}
              historyTarget={graphHistoryTarget}
              ciRuns={workflowRuns}
            />
          ) : tab === "stash" ? (
            <StashView />
          ) : tab === "pr" ? (
            <PrListView branchFilter={branchFilter} />
          ) : (
            <ActionsView branchFilter={branchFilter} />
          )}
          <SwitchingOverlay />
        </div>
      </Card>
    </div>
  );
}

const NO_WIPS: GraphWip[] = [];

/**
 * 단계를 옮겨도 고른 커밋을 이어 간다(5.1 「선택」). 고른 커밋은 (레인, 커밋)으로 `lastSelection`에
 * 적고, 새 단계에 들어와 레인 목록을 읽으면 한 번 `carrySelection`으로 되살린다 — 워크스페이스에서 고른
 * 커밋의 저장소로 내려오면 그 커밋이 고른 채로 있다. 이미 고른 커밋이 있으면 건드리지 않는다.
 */
function useCarriedSelection(scope: Scope | null, sources: readonly LaneSource[]) {
  // 저장소 단계는 레인 뷰어가 고른 행을 따로 기억한다(`useLaneSelection`) — 여기서 건드리지 않는다.
  const inRepoStep = scope?.kind === "repo";
  const inRepoStepRef = useRef(inRepoStep);
  // 아래 효과들보다 먼저 선언해, 같은 차례에 최신 값을 읽게 한다.
  useEffect(() => {
    inRepoStepRef.current = inRepoStep;
  });

  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const rememberSelection = useScopeStore((s) => s.rememberSelection);

  // 고른 커밋을 적는다. 같은 워크트리에서 선택을 풀면(WIP 행을 고르는 등) 지운다 — 다른 저장소로
  // 옮겨 가며 풀린 선택은 지우지 않는다(옮겨 간 단계가 이어받아야 한다).
  // 처음 그릴 때는 아무것도 지우지 않는다(이어받을 선택을 아래 효과가 먼저 읽어야 한다).
  const prevRepoPath = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const sameRepo = prevRepoPath.current === activeRepoPath;
    prevRepoPath.current = activeRepoPath;
    if (inRepoStepRef.current) return;
    if (selectedCommitId && activeRepoPath) rememberSelection({ laneId: activeRepoPath, commitOid: selectedCommitId });
    else if (sameRepo) rememberSelection(null);
  }, [selectedCommitId, activeRepoPath, rememberSelection]);

  const carriedFor = useRef<Scope | null>(null);
  useEffect(() => {
    // 저장소 단계를 거쳐 같은 브랜치 단계로 돌아와도 다시 이어받는다.
    if (inRepoStep) carriedFor.current = null;
    if (!scope || inRepoStep || sources.length === 0 || sameScope(carriedFor.current, scope)) return;
    carriedFor.current = scope;
    const last = useScopeStore.getState().lastSelection;
    const carried = carrySelection(last, sources, openedLaneId(scope, sources));
    if (carried?.commitOid && useSelectionStore.getState().selectedCommitId === null) selectCommit(carried.commitOid);
  }, [scope, inRepoStep, sources, selectCommit]);
}

/**
 * 브랜치 단계 파일별 보기가 읽을 워크트리(5.1 「파일별」): 그 브랜치 하나 — 체크아웃하지 않은 브랜치면
 * 그 이름을 넘겨 브랜치 끝 기준으로 읽는다. 저장소 단계의 파일별 보기는 레인 뷰어(`RepoStep`)가 읽는다.
 */
function useFileSources(scope: Scope | null): FileTouchSource[] {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  let next: FileTouchSource[] = [];
  if (scope?.kind === "branch") {
    next =
      scope.worktreePath !== null
        ? [{ repoPath: scope.repoPath, path: activeRepoPath ?? scope.worktreePath, worktreeLabel: null }]
        : [{ repoPath: scope.repoPath, path: scope.repoPath, worktreeLabel: scope.branch, branch: scope.branch }];
  }
  // 그릴 때마다 새 배열이라, 대상이 실제로 바뀔 때만 새 목록을 넘긴다(쿼리 목록이 흔들리지 않게).
  const key = JSON.stringify(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key가 next의 내용을 대신 비교한다
  return useMemo(() => next, [key]);
}
