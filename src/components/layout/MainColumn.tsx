import { useTranslation } from "react-i18next";
import { FolderGit2, X } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { useActiveScope } from "@/hooks/useActiveScope";
import { ToolbarRoot } from "@/components/toolbar";
import { RepoListView } from "@/components/repository/RepoListView";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { WorkspaceReview } from "@/components/review/WorkspaceReview";
import { PrDetailPane } from "@/components/pr/PrDetailPane";
import { usePrViewStore } from "@/components/pr/pr-view";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ContentArea, useExpandGraph } from "./ContentArea";
import { PaneStrip } from "./PaneStrip";
import { useDiffMaximizeReset } from "./useDiffMaximize";

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
  const setPrOpen = usePrViewStore((s) => s.setOpen);
  const scope = useActiveScope();
  // 다른 저장소·워크스페이스로 옮기거나 목록을 열면 diff 크게 보기를 끝낸다(숨긴 목록으로 돌아올 길이 없어진다).
  useDiffMaximizeReset(`${scope?.kind === "workspace" ? scope.id : ""}:${activeRepoPath ?? ""}:${repoListOpen}`);

  // 0단계(그래프 전체, D47)는 이 화면에서 아직 안 쓴다 — 네 탭(작업 중인 변경·이력·스태시·Actions)
  // 모두 "아무것도 안 골랐음"에도 늘 무언가 보여 준다(스태시·Actions는 "고르지 않음" 안내, 작업 중인
  // 변경은 스테이징 목록 자체가 내용이다 — 커밋 뒤 스테이징 목록으로 돌아가는 것도 이 경로다).
  // `PaneStrip`은 이 능력을 갖고 있으니 그 가정이 바뀌면(예: 탭마다 진짜 빈 상태를 두면) 여기만 고치면 된다.
  const hasSelection = true;
  const expandContentTab = useExpandGraph(activeTab);
  const handleExpandGraph = () => {
    if (prOpen) setPrOpen(false);
    else expandContentTab();
  };

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
            onExpandGraph={handleExpandGraph}
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
