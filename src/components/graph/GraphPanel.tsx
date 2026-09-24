import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, GitCommitVertical, Play } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useStashList, useWorkflowRuns, useWorktrees } from "@/api/queries";
import { CommitGraph, type WorktreeHead } from "./CommitGraph";
import { useGraphReview } from "./useGraphReview";
import { normalizePath, type GraphWip } from "./graph-model";
import { worktreeColor } from "./worktree-history";
import { activeRange, useBranchRangeStore } from "@/components/branch/branch-range";
import { WorktreeChips, type WorktreeChip } from "@/components/worktree/WorktreeChips";
import type { WorktreeInfo } from "@/types";
import { StashView } from "@/components/stash/StashView";
import { ActionsView } from "@/components/actions/ActionsView";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";

/** Which graph-panel tab a `ui.activeTab` value belongs to. */
export type GraphPanelTab = "graph" | "stash" | "actions";

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
 * to here" divider), stash, Actions. The "changes per file" tab slot is
 * filled in W7. On the graph tab the header carries the "mark N new commits
 * as seen" button.
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
  const activeRunCount = workflowRuns.filter(
    (r) => r.status === "in_progress" || r.status === "queued",
  ).length;

  const tab = graphPanelTabOf(activeTab);
  const worktreeFilter = useWorktreeFilter(review.wips);
  // 범위·비교 화면은 지금 연 워크트리의 커밋만 그린다 — 칩으로 고를 것이 없으니 칩 줄을 감춘다.
  const compareBranch = useUIStore((s) => s.compareBranch);
  const branchRange = useBranchRangeStore((s) => s.range);
  const graphListShown = !compareBranch && activeRange(branchRange, activeRepoPath) === null;

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

  const openGraphTab = () => setActiveTab(selectedCommitId ? "history" : "changes");

  return (
    <section
      aria-label={t("shell.panelTabs")}
      className="relative flex flex-col h-[42%] min-h-[180px] shrink-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden"
    >
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
            onClick={() => setActiveTab("stash")}
            icon={<Archive className="w-3.5 h-3.5" />}
            count={stashes.length > 0 ? stashes.length : undefined}
          >
            {t("shell.stashTab")}
          </Tab>
          <Tab
            variant="inline"
            active={tab === "actions"}
            onClick={() => setActiveTab("actions")}
            icon={<Play className="w-3.5 h-3.5" />}
            count={activeRunCount > 0 ? activeRunCount : undefined}
          >
            {t("actions.title")}
          </Tab>
        </TabGroup>
        {tab === "graph" && review.newCommits !== null && review.newCommits.newCount > 0 && (
          <button
            type="button"
            onClick={review.markSeen}
            className="shrink-0 h-6 px-2.5 rounded-(--radius-chip) bg-(--chip) text-[11.5px] font-semibold text-(--fg2) hover:bg-accent transition-colors"
          >
            {t("graph.markSeen", { count: review.newCommits.newCount })}
          </button>
        )}
      </div>

      {tab === "graph" && graphListShown && worktreeFilter.chips.length > 1 && (
        <WorktreeChips
          chips={worktreeFilter.chips}
          visible={worktreeFilter.visible}
          onToggle={worktreeFilter.toggle}
        />
      )}
      <div role="tabpanel" className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "graph" ? (
          <CommitGraph
            wips={worktreeFilter.wips}
            newCommits={review.newCommits}
            seenAt={review.seenAt}
            worktreeHeads={worktreeFilter.heads}
          />
        ) : tab === "stash" ? (
          <StashView />
        ) : (
          <ActionsView />
        )}
        <SwitchingOverlay />
      </div>
    </section>
  );
}

const NO_HEADS: WorktreeHead[] = [];

/** 칩 순서: 메인 먼저, 그다음 경로순(WIP 행 순서와 같다). */
function chipOrder(a: GraphWip, b: GraphWip): number {
  return Number(b.isMain) - Number(a.isMain) || a.path.localeCompare(b.path);
}

/**
 * 칩 줄에서 그래프에 보일 워크트리를 고른다(D5). 처음에는 모두 보이고, 끈 워크트리는
 * 저장소마다 기억한다(화면 상태라 저장하지 않는다). 지금 연 워크트리는 늘 보인다.
 * - `wips`: 보이는 워크트리의 WIP 행만.
 * - `heads`: 보이는 다른 워크트리의 HEAD. 그래프가 그 이력을 함께 그린다.
 */
function useWorktreeFilter(allWips: GraphWip[]) {
  const ownerPath = useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath ?? null);
  const { data: worktreeList } = useWorktrees(ownerPath);
  const [hiddenByRepo, setHiddenByRepo] = useState<Readonly<Record<string, readonly string[]>>>({});
  const hidden = useMemo(
    () => new Set(ownerPath ? (hiddenByRepo[ownerPath] ?? []) : []),
    [hiddenByRepo, ownerPath],
  );

  const infoByPath = useMemo(() => {
    const map = new Map<string, WorktreeInfo>();
    for (const w of worktreeList ?? []) map.set(normalizePath(w.path), w);
    return map;
  }, [worktreeList]);

  const chips = useMemo<WorktreeChip[]>(
    () =>
      [...allWips].sort(chipOrder).map((w) => {
        const info = infoByPath.get(normalizePath(w.path));
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
    () => new Set(allWips.filter((w) => w.isCurrent || !hidden.has(w.path)).map((w) => w.path)),
    [allWips, hidden],
  );
  const wips = useMemo(() => allWips.filter((w) => visible.has(w.path)), [allWips, visible]);
  const heads = useMemo(() => {
    const out = wips.flatMap((w) => {
      const head = w.isCurrent ? null : infoByPath.get(normalizePath(w.path))?.head;
      return head ? [{ path: w.path, head }] : [];
    });
    return out.length > 0 ? out : NO_HEADS;
  }, [wips, infoByPath]);

  const toggle = useCallback(
    (path: string) => {
      if (!ownerPath) return;
      setHiddenByRepo((prev) => {
        const current = prev[ownerPath] ?? [];
        const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
        return { ...prev, [ownerPath]: next };
      });
    },
    [ownerPath],
  );

  return { chips, visible, wips, heads, toggle };
}
