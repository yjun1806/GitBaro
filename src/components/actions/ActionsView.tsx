import { useTranslation } from "react-i18next";
import { UserX, WifiOff } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useSelectionStore } from "@/stores/selection";
import { useWorkflowRuns } from "@/api/queries";
import { ActionsList } from "./ActionsList";
import { EmptyState } from "@/components/ui/EmptyState";

export function ActionsView() {
  const { t } = useTranslation();
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  // 전역 활성 계정이 아니라 이 저장소에 지정된 계정으로 GitHub API를 부른다.
  const accountId = useRepoAccountId();
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const selectRun = useSelectionStore((s) => s.selectRun);

  const hasRemote = activeRepo ? activeRepo.remotes.length > 0 : false;

  const { data: runs = [], isLoading } = useWorkflowRuns(
    hasRemote ? activeRepoPath : null,
    accountId,
    { polling: true },
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-8 px-3 border-b border-border">
        <span className="text-[12.5px] font-bold">{t("actions.title")}</span>
      </div>

      {/* Guard: no account */}
      {!accountId ? (
        <EmptyState icon={UserX} title={t("actions.noAccount")} />
      ) : !hasRemote ? (
        /* Guard: no remote */
        <EmptyState icon={WifiOff} title={t("actions.noRemote")} />
      ) : (
        /* Normal: show runs */
        <ActionsList
          runs={runs}
          isLoading={isLoading}
          selectedRunId={selectedRunId}
          onSelectRun={selectRun}
        />
      )}
    </div>
  );
}
