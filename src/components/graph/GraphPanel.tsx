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
import { useGraphWorktreesStore } from "./graph-worktrees";
import { activeRange, useBranchRangeStore } from "@/components/branch/branch-range";
import { WorktreeChips, type WorktreeChip } from "@/components/worktree/WorktreeChips";
import type { WorktreeInfo } from "@/types";
import { StashView } from "@/components/stash/StashView";
import { ActionsView } from "@/components/actions/ActionsView";
import { PrListView } from "@/components/pr/PrListView";
import { usePrViewStore } from "@/components/pr/pr-view";
import { useUnpushedRangeViewStore } from "./unpushed-range-view";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { activeRunCount, badgeCount } from "@/components/review/tab-counts";
import { CompareChip } from "./CompareChip";
import { useWorktreeChipMenu } from "./useWorktreeChipMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { ViewBranchPicker } from "./ViewBranchPicker";
import { useHistoryView } from "./useHistoryView";
import { trimTrailingSlash } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

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
  const closeRange = useUnpushedRangeViewStore((s) => s.close);
  useEffect(() => {
    setPrOpen(false);
    closeRange();
  }, [activeTab, merging, comparing, setPrOpen, closeRange]);
  useEffect(
    () => () => {
      setPrOpen(false);
      closeRange();
    },
    [setPrOpen, closeRange],
  );
  const tab: ShownTab = prOpen ? "pr" : graphPanelTabOf(activeTab);
  const worktreeFilter = useWorktreeFilter(review.wips);
  const chipMenu = useWorktreeChipMenu(worktreeFilter);

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
    closeRange();
    setActiveTab(selectedCommitId ? "history" : "changes");
  };
  const openStoredTab = (next: "stash" | "actions") => {
    setPrOpen(false);
    closeRange();
    setActiveTab(next);
  };
  const openPrTab = () => {
    closeRange();
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
          {tab === "graph" && <ViewBranchPicker />}
          {tab === "graph" && <CompareChip />}
          {/* 「작업 중인 변경 N」은 아래 WIP 행이 말한다(여기 배지를 두지 않는다). */}
        </div>

        {tab === "graph" && graphListShown && !viewing && worktreeFilter.chips.length > 1 && (
          <WorktreeChips
            chips={worktreeFilter.chips}
            visible={worktreeFilter.visible}
            onToggle={worktreeFilter.toggle}
            onShowAll={worktreeFilter.showAll}
            onShowCurrentOnly={worktreeFilter.showCurrentOnly}
            onContextMenu={(chip, e) => chipMenu.open(chip, contextMenuPoint(e))}
          />
        )}
        {chipMenu.element}
        <div role="tabpanel" className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === "graph" ? (
            <CommitGraph
              wips={viewing ? NO_WIPS : worktreeFilter.wips}
              worktreeHeads={viewing ? NO_HEADS : worktreeFilter.heads}
              historyTarget={historyTarget}
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
 * 「함께 보는 워크트리」 칩 줄에서 그래프에 그릴 워크트리를 고른다(D5). 처음에는 지금 연 워크트리만
 * 그리고, 켠 워크트리는 저장소마다 앱을 켜는 동안 기억한다(`useGraphWorktreesStore`). 지금 연
 * 워크트리는 늘 보인다.
 * - `wips`: 보이는 워크트리의 WIP 행만.
 * - `heads`: 보이는 다른 워크트리의 HEAD. 그래프가 그 이력을 함께 그린다.
 */
function useWorktreeFilter(allWips: GraphWip[]) {
  const ownerPath = useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath ?? null);
  const { data: worktreeList } = useWorktrees(ownerPath);
  const shownByRepo = useGraphWorktreesStore((s) => s.shownByRepo);
  const toggleShown = useGraphWorktreesStore((s) => s.toggle);
  const setShown = useGraphWorktreesStore((s) => s.setShown);
  const shown = useMemo(
    () => new Set(ownerPath ? (shownByRepo[ownerPath] ?? []) : []),
    [shownByRepo, ownerPath],
  );

  const infoByPath = useMemo(() => {
    const map = new Map<string, WorktreeInfo>();
    for (const w of worktreeList ?? []) map.set(trimTrailingSlash(w.path), w);
    return map;
  }, [worktreeList]);

  const chips = useMemo<WorktreeChip[]>(
    () =>
      [...allWips].sort(chipOrder).map((w) => {
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
      }),
    [allWips, infoByPath],
  );

  const visible = useMemo(
    () => new Set(allWips.filter((w) => w.isCurrent || shown.has(w.path)).map((w) => w.path)),
    [allWips, shown],
  );
  const wips = useMemo(() => allWips.filter((w) => visible.has(w.path)), [allWips, visible]);
  const heads = useMemo(() => {
    const out = wips.flatMap((w) => {
      const head = w.isCurrent ? null : infoByPath.get(trimTrailingSlash(w.path))?.head;
      return head ? [{ path: w.path, head }] : [];
    });
    return out.length > 0 ? out : NO_HEADS;
  }, [wips, infoByPath]);

  const toggle = useCallback(
    (path: string) => {
      if (ownerPath) toggleShown(ownerPath, path);
    },
    [ownerPath, toggleShown],
  );
  const showAll = useCallback(() => {
    if (ownerPath) setShown(ownerPath, allWips.filter((w) => !w.isCurrent).map((w) => w.path));
  }, [ownerPath, allWips, setShown]);
  const showCurrentOnly = useCallback(() => {
    if (ownerPath) setShown(ownerPath, []);
  }, [ownerPath, setShown]);
  const showOnly = useCallback(
    (path: string) => {
      if (ownerPath) setShown(ownerPath, [path]);
    },
    [ownerPath, setShown],
  );

  return { chips, visible, wips, heads, toggle, showAll, showCurrentOnly, showOnly };
}
