import { useTranslation } from "react-i18next";
import { FolderGit2, X } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { useActiveScope } from "@/hooks/useActiveScope";
import { ToolbarRoot } from "@/components/toolbar";
import { RepoListView } from "@/components/repository/RepoListView";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { useGraphFilesView } from "@/components/graph/graph-files-view";
import { WorkspaceReview } from "@/components/review/WorkspaceReview";
import { PrDetailPane } from "@/components/pr/PrDetailPane";
import { usePrViewStore } from "@/components/pr/pr-view";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ContentArea } from "./ContentArea";
import { PaneStrip } from "./PaneStrip";
import { useDiffMaximizeReset } from "./useDiffMaximize";
import { useSelectionStore } from "@/stores/selection";
import { useFollowStore } from "@/stores/follow";
import { useStatus } from "@/api/queries";
import type { MainTab } from "./ContentArea";

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

/** "All repositories" list, opened from the sidebar. Takes over the main column. */
function RepoListCard() {
  const { t } = useTranslation();
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const { selectRepo } = useSelectRepo();
  return (
    <Card className="flex-1 w-full max-w-[560px]">
      <div className="flex items-center gap-2 h-8 px-3 shrink-0 border-b border-(--line)">
        <span className="flex-1 text-[12.5px] font-bold text-foreground">{t("shell.openRepoList")}</span>
        <Button
          iconOnly
          size="md"
          variant="ghost"
          onClick={() => setRepoListOpen(false)}
          aria-label={t("shell.closeRepoList")}
          title={t("shell.closeRepoList")}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <RepoListView onSelectRepo={selectRepo} />
      </div>
    </Card>
  );
}

/**
 * Right column of the two-column shell: toolbar on top, then the full-width
 * graph panel, then the file list + diff for whatever is picked in the panel.
 */
export function MainColumn() {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const prOpen = usePrViewStore((s) => s.open);
  const scope = useActiveScope();
  // 다른 저장소·워크스페이스로 옮기거나 목록을 열면 diff 크게 보기를 끝낸다(숨긴 목록으로 돌아올 길이 없어진다).
  useDiffMaximizeReset(`${scope?.kind === "workspace" ? scope.id : ""}:${activeRepoPath ?? ""}:${repoListOpen}`);

  // 0단계(그래프 전체, D47): 볼 것이 없으면 옆 칸을 열지 않는다. 작업 중인 변경은 파일이 있거나
  // 따라가는 중일 때만 상세 칸이 내용이고, 다른 탭은 무언가 골랐을 때만 연다.
  // 파일별 보기는 그래프 칸 안에 파일 목록과 diff를 함께 그리므로 옆 칸을 열지 않는다(5.4).
  const filesView = useGraphFilesView();
  const hasSelection = useHasPaneContent(activeTab, activeRepoPath, prOpen) && !filesView;

  return (
    <main className="relative flex flex-col flex-1 min-w-0 h-full bg-background">
      <ToolbarRoot />

      {/* 메인 칸 여백은 사방 g로 같다. 왼쪽만 좁으면 카드 그림자가 사이드바 쪽 경계에 끼어
          한쪽으로 쏠려 보인다. */}
      <div className="flex flex-col flex-1 min-h-0 gap-(--g) p-(--g)">
        {repoListOpen ? (
          <RepoListCard />
        ) : scope?.kind === "repo" ? (
          // 저장소 전용 화면은 저장소를 골랐을 때만 마운트한다. 안쪽 파일은 null 경로를 보지 않는다.
          <PaneStrip
            graph={<GraphPanel />}
            hasSelection={hasSelection}
            bottom={prOpen ? <PrDetailPane /> : <ContentArea activeTab={activeTab} />}
          />
        ) : scope?.kind === "workspace" ? (
          <WorkspaceReview key={scope.id} workspaceId={scope.id} paths={scope.paths} />
        ) : (
          <Card className="flex-1">
            <EmptyState
              icon={FolderGit2}
              title={t("shell.noRepoTitle")}
              description={t("shell.noRepoDescription")}
            />
          </Card>
        )}
      </div>
    </main>
  );
}
