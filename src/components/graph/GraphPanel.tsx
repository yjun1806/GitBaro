import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Archive, GitCommitVertical, Play } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useStatus, useStashList, useWorkflowRuns } from "@/api/queries";
import { HistoryView } from "@/components/history/HistoryView";
import { StashView } from "@/components/stash/StashView";
import { ActionsView } from "@/components/actions/ActionsView";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { SwitchingOverlay } from "@/components/ui/SwitchingOverlay";
import { cn } from "@/lib/utils";

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

function UncommittedRow({ count, selected, onSelect }: {
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 w-full min-h-(--row) px-3 shrink-0 text-left border-b border-(--line) transition-colors",
        selected ? "bg-(--acc-sel)" : "hover:bg-accent",
      )}
    >
      {/* 점선 원: 아직 커밋이 아닌 변경(WIP)을 뜻한다 */}
      <span
        aria-hidden="true"
        className={cn(
          "w-3 h-3 rounded-full border-2 border-dashed shrink-0",
          count > 0 ? "border-(--live)" : "border-(--faint)",
        )}
      />
      <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-foreground">
        {t("shell.uncommittedCount", { count })}
      </span>
    </button>
  );
}

/**
 * Full-width card above the file list and diff. Tabs: commit graph (the
 * existing history list for now, with the uncommitted-changes row on top),
 * stash, Actions. The "changes per file" tab slot is filled in W7.
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

  const { data: statusEntries = [] } = useStatus(activeRepoPath);
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

  // 커밋을 고르면 아래 칸이 커밋 상세로 바뀐다.
  useEffect(() => {
    if (selectedCommitId) setActiveTab("history");
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
      <TabGroup aria-label={t("shell.panelTabs")} className="gap-2 px-3 shrink-0 border-(--line)">
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
          {t("stash.title")}
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

      <div role="tabpanel" className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "graph" ? (
          <>
            <UncommittedRow
              count={statusEntries.length}
              selected={activeTab === "changes"}
              onSelect={() => setActiveTab("changes")}
            />
            <HistoryView />
          </>
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
