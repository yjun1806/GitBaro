import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Archive, GitCommitVertical, GitPullRequest, Play } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import {
  useMergeState,
  useStashList,
  useWorkflowRuns,
  useWorktrees,
} from "@/api/queries";
import { CommitGraph, type WorktreeHead } from "./CommitGraph";
import { useGraphReview } from "./useGraphReview";
import { type GraphWip } from "./graph-model";
import { worktreeColor } from "./worktree-history";
import { activeRange, useBranchRangeStore } from "@/components/branch/branch-range";
import { WorktreeLaneChips, type WorktreeChip } from "./WorktreeLaneChips";
import type { ReviewWorktree, WorktreeInfo } from "@/types";
import { StashView } from "@/components/stash/StashView";
import { ActionsView } from "@/components/actions/ActionsView";
import { PrListView } from "@/components/pr/PrListView";
import { usePrViewStore } from "@/components/pr/pr-view";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { activeRunCount, badgeCount } from "@/components/review/tab-counts";
import { CompareChip } from "./CompareChip";
import { useWorktreeChipMenu } from "./useWorktreeChipMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { useHistoryView } from "./useHistoryView";
import { trimTrailingSlash } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { FilterBar } from "@/components/ui/FilterBar";
import { useActiveRepoName } from "@/hooks/useRepoDisplay";
import { useScopeSources } from "@/components/scope/useScopeSources";
import { useScopeStore } from "@/components/scope/scope-store";
import { visibleLaneSources, type LaneSource } from "@/components/scope/scope-lanes";
import type { Scope } from "@/components/scope/scope";
import { ScopeViewToggle } from "@/components/scope/ScopeViewToggle";
import { FileTouchesView } from "@/components/review/FileTouchesView";
import { fileTouchSources, type FileTouchSource } from "@/components/review/file-touches-model";

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
 * Full-width card above the file list and diff. Tabs: commit graph (lane
 * graph with a WIP row per worktree on top, new-commit dots and the "seen up
 * to here" divider), stash, Actions, pull requests. On the graph tab the header
 * carries the "mark N new commits as seen" button.
 */
export function GraphPanel() {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const clearCommitSelection = useSelectionStore((s) => s.clearCommitSelection);
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
  const worktreeFilter = useWorktreeFilter(review.wips, scope, sources);
  const chipMenu = useWorktreeChipMenu(worktreeFilter);
  const filesView = useGraphFilesView();
  const fileSources = useFileSources(scope, worktreeFilter.wips);
  const repoName = useActiveRepoName();

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
    <div role="region" aria-label={t("shell.panelTabs")} className="flex flex-col shrink-0 flex-1 min-h-0">
      <Card className="relative flex-1 min-h-0">
        <div className="flex items-center gap-2 pr-3 shrink-0 border-b border-(--line)">
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

        {tab === "graph" && graphListShown && (
          <FilterBar
            left={
              worktreeFilter.chips.length > 1 ? (
                <WorktreeLaneChips
                  chips={worktreeFilter.chips}
                  visible={worktreeFilter.visible}
                  onToggle={worktreeFilter.toggle}
                  onContextMenu={(chip, e) => chipMenu.open(chip, contextMenuPoint(e))}
                />
              ) : undefined
            }
            right={<ScopeViewToggle />}
          />
        )}
        {chipMenu.element}
        <div role="tabpanel" className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === "graph" && filesView ? (
            <FileTouchesView sources={fileSources} repoLabel={() => repoName} />
          ) : tab === "graph" ? (
            <CommitGraph
              wips={viewing ? NO_WIPS : worktreeFilter.wips}
              worktreeHeads={viewing ? NO_HEADS : worktreeFilter.heads}
              historyTarget={historyTarget}
              ciRuns={workflowRuns}
            />
          ) : tab === "stash" ? (
            <StashView />
          ) : tab === "pr" ? (
            <PrListView />
          ) : (
            <ActionsView />
          )}
          <SwitchingOverlay />
        </div>
      </Card>
    </div>
  );
}

const NO_HEADS: WorktreeHead[] = [];
const NO_WIPS: GraphWip[] = [];

/** 칩 순서: 메인 먼저, 그다음 경로순(WIP 행 순서와 같다). */
function chipOrder(a: GraphWip, b: GraphWip): number {
  return Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path);
}

/**
 * 그래프에 그릴 워크트리를 고른다(5.1 레인). 브랜치 단계는 지금 연 워크트리 하나뿐이다. 저장소
 * 단계는 워크트리마다 레인이고, 필터 막대의 칩으로 켜고 끈다 — 건드리지 않은 칩은 조용한 레인
 * 규칙(`visibleLaneSources`)을 따르고, 건드린 것은 `useScopeStore.laneShown`이 기억한다. 지금 연
 * 워크트리는 그래프 이력의 주인이라 늘 보인다.
 * - `wips`: 보이는 워크트리의 WIP 행만.
 * - `heads`: 보이는 다른 워크트리의 HEAD. 그래프가 그 이력을 함께 그린다.
 */
function useWorktreeFilter(allWips: GraphWip[], scope: Scope | null, sources: readonly LaneSource[]) {
  const ownerPath = useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath ?? null);
  const repoStage = scope?.kind === "repo";
  const { data: worktreeList } = useWorktrees(repoStage ? ownerPath : null);
  const laneShown = useScopeStore((s) => s.laneShown);
  const setLaneShown = useScopeStore((s) => s.setLaneShown);
  const setLanesShown = useScopeStore((s) => s.setLanesShown);

  const infoByPath = useMemo(() => {
    const map = new Map<string, WorktreeInfo>();
    for (const w of worktreeList ?? []) map.set(trimTrailingSlash(w.path), w);
    return map;
  }, [worktreeList]);

  const shownLaneIds = useMemo(() => {
    if (!repoStage || !scope) return new Set<string>();
    const shown = visibleLaneSources(scope, sources, NO_OVERRIDES, new Map(Object.entries(laneShown)));
    return new Set(shown.map((s) => trimTrailingSlash(s.id)));
  }, [repoStage, scope, sources, laneShown]);

  const chips = useMemo<WorktreeChip[]>(
    () =>
      repoStage
        ? [...allWips].sort(chipOrder).map((w) => {
            const info = infoByPath.get(trimTrailingSlash(w.path));
            return {
              path: w.path,
              branch: w.branch,
              isMain: w.isMain,
              isCurrent: w.isCurrent,
              base: info?.base ?? null,
              dirtyCount: w.count,
              color: worktreeColor(w.path),
            };
          })
        : NO_CHIPS,
    [repoStage, allWips, infoByPath],
  );

  const visible = useMemo(
    () =>
      new Set(allWips.filter((w) => w.isCurrent || shownLaneIds.has(trimTrailingSlash(w.path))).map((w) => w.path)),
    [allWips, shownLaneIds],
  );
  const wips = useMemo(() => allWips.filter((w) => visible.has(w.path)), [allWips, visible]);
  const heads = useMemo(() => {
    const out = wips.flatMap((w) => {
      const head = w.isCurrent ? null : (infoByPath.get(trimTrailingSlash(w.path))?.head ?? w.headOid);
      return head ? [{ path: w.path, head }] : [];
    });
    return out.length > 0 ? out : NO_HEADS;
  }, [wips, infoByPath]);

  const toggle = useCallback(
    (path: string) => setLaneShown(path, !visible.has(path)),
    [visible, setLaneShown],
  );
  const showOnly = useCallback(
    (path: string) =>
      setLanesShown(Object.fromEntries(allWips.filter((w) => !w.isCurrent).map((w) => [w.path, w.path === path]))),
    [allWips, setLanesShown],
  );

  return { chips, visible, wips, heads, toggle, showOnly };
}

const NO_CHIPS: WorktreeChip[] = [];
const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

/**
 * 그래프 탭이 「파일별」 보기인지(5.1, D44). 브랜치 비교 중에는 비교 그래프를 그대로 둔다.
 * 메인 칸(`MainColumn`)도 이 값으로 옆 칸을 열지 않는다 — 파일별 보기는 그래프 칸 안에 파일 목록과
 * diff를 함께 그린다(5.4 「첫 칸이 파일 목록」).
 */
export function useGraphFilesView(): boolean {
  const activeTab = useUIStore((s) => s.activeTab);
  const view = useUIStore((s) => s.reviewFileView);
  const prOpen = usePrViewStore((s) => s.open);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const branchRange = useBranchRangeStore((s) => s.range);
  return (
    view === "files" && !prOpen && graphPanelTabOf(activeTab) === "graph" && activeRange(branchRange, activeRepoPath) === null
  );
}

/**
 * 파일별 보기가 읽을 워크트리(5.1 「파일별」). 저장소 단계는 보이는 워크트리 모두, 브랜치 단계는 그
 * 브랜치 하나 — 체크아웃하지 않은 브랜치면 그 이름을 넘겨 브랜치 끝 기준으로 읽는다.
 */
function useFileSources(scope: Scope | null, shownWips: readonly GraphWip[]): FileTouchSource[] {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  let next: FileTouchSource[] = [];
  if (scope?.kind === "repo") {
    const worktrees: ReviewWorktree[] = shownWips.map((w) => ({
      path: w.path,
      branch: w.branch,
      headOid: w.headOid ?? null,
      isMain: w.isMain,
    }));
    next = fileTouchSources([{ path: scope.repoPath, worktrees }]);
  } else if (scope?.kind === "branch") {
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
