import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { FolderGit2, X } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { stopWorktreePreview } from "@/api/commands";
import { getErrorMessage } from "@/lib/utils";
import { ToolbarRoot } from "@/components/toolbar";
import { PreviewBanner } from "@/components/worktree/PreviewBanner";
import { RepoListView } from "@/components/repository/RepoListView";
import { GraphPanel } from "@/components/graph/GraphPanel";
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
 */
export function MainColumn() {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setPreviewBranch = useUIStore((s) => s.setPreviewBranch);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
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
      <PreviewBanner onStopPreview={handleStopPreview} />

      {/* 시안 frame()의 메인 칸 여백: 오른쪽·아래 g, 왼쪽 2px(사이드바가 자기 오른쪽 여백을 가진다) */}
      <div className="flex flex-col flex-1 min-h-0 gap-(--g) pt-(--g) pr-(--g) pb-(--g) pl-0.5">
        {repoListOpen ? (
          <RepoListCard />
        ) : !activeRepoPath ? (
          <Card className="flex-1">
            <EmptyState
              icon={FolderGit2}
              title={t("shell.noRepoTitle")}
              description={t("shell.noRepoDescription")}
            />
          </Card>
        ) : (
          <>
            <GraphPanel />
            <ContentArea activeTab={activeTab} />
          </>
        )}
      </div>
    </main>
  );
}
