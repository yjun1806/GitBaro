import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { FolderGit2, X } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { useActiveScope } from "@/hooks/useActiveScope";
import { stopWorktreePreview } from "@/api/commands";
import { getErrorMessage } from "@/lib/utils";
import { ToolbarRoot } from "@/components/toolbar";
import { PreviewBanner } from "@/components/worktree/PreviewBanner";
import { RepoListView } from "@/components/repository/RepoListView";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { WorkspaceReview } from "@/components/review/WorkspaceReview";
import { FilesByRepo } from "@/components/review/FilesByRepo";
import { useFilesViewStore } from "@/components/review/files-view";
import { Card, ContentArea, EmptyState } from "./ContentArea";

/** "All repositories" list, opened from the sidebar. Takes over the main column. */
function RepoListCard() {
  const { t } = useTranslation();
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const { selectRepo } = useSelectRepo();
  return (
    <Card className="flex-1 w-full max-w-[560px]">
      <div className="flex items-center gap-2 h-10 px-3 shrink-0 border-b border-(--line)">
        <span className="flex-1 text-[12.5px] font-bold text-foreground">{t("shell.openRepoList")}</span>
        <button
          type="button"
          onClick={() => setRepoListOpen(false)}
          aria-label={t("shell.closeRepoList")}
          title={t("shell.closeRepoList")}
          className="flex items-center justify-center w-7 h-7 rounded-(--radius-item) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
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
 * On the panel's "changes by file" tab (D7) the lower area shows that list
 * and its diff instead.
 */
export function MainColumn() {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setPreviewBranch = useUIStore((s) => s.setPreviewBranch);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const activeRepoName = useRepositoryStore((s) => s.activeRepo?.name ?? null);
  const filesOpen = useFilesViewStore((s) => s.repoTabOpen);
  const groupBy = useFilesViewStore((s) => s.groupBy);
  const scope = useActiveScope();
  const addToast = useToastStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const handleStopPreview = async () => {
    if (!activeRepoPath) return;
    try {
      await stopWorktreePreview(activeRepoPath);
      setPreviewBranch(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
      addToast(t("preview.stopped"), "success");
    } catch (err) {
      addToast(t("preview.failedToStop", { error: getErrorMessage(err) }), "error");
    }
  };

  return (
    <main className="relative flex flex-col flex-1 min-w-0 h-full bg-background">
      <ToolbarRoot />
      {/* 미리보기는 저장소 하나에 묶여 있다. 워크스페이스 화면에서는 멈출 대상이 없으므로 숨긴다. */}
      {scope?.kind === "repo" && <PreviewBanner onStopPreview={handleStopPreview} />}

      {/* 시안 frame()의 메인 칸 여백: 오른쪽·아래 g, 왼쪽 2px(사이드바가 자기 오른쪽 여백을 가진다) */}
      <div className="flex flex-col flex-1 min-h-0 gap-(--g) pt-(--g) pr-(--g) pb-(--g) pl-0.5">
        {repoListOpen ? (
          <RepoListCard />
        ) : scope?.kind === "repo" ? (
          // 저장소 전용 화면은 저장소를 골랐을 때만 마운트한다. 안쪽 파일은 null 경로를 보지 않는다.
          <>
            <GraphPanel />
            {filesOpen && activeRepoPath ? (
              // 저장소(워크트리)를 바꾸면 고른 파일·접힌 그룹을 새로 시작한다.
              <FilesByRepo
                key={activeRepoPath}
                repos={[{ path: activeRepoPath, name: activeRepoName ?? activeRepoPath }]}
                groupBy={groupBy}
              />
            ) : (
              <ContentArea activeTab={activeTab} />
            )}
          </>
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
