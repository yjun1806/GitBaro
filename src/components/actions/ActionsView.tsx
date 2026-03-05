import { useTranslation } from "react-i18next";
import { UserX, WifiOff } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useSelectionStore } from "@/stores/selection";
import { useWorkflowRuns } from "@/api/queries";
import { ActionsList } from "./ActionsList";

export function ActionsView() {
  const { t } = useTranslation();
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const selectRun = useSelectionStore((s) => s.selectRun);

  const hasRemote = activeRepo ? activeRepo.remotes.length > 0 : false;
  const accountId = activeAccountId;

  const { data: runs = [], isLoading } = useWorkflowRuns(
    hasRemote ? activeRepoPath : null,
    accountId,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium">{t("actions.title")}</span>
      </div>

      {/* Guard: no account */}
      {!accountId ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-12">
          <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
            <UserX className="w-6 h-6" />
          </div>
          <div className="text-center px-4">
            <p className="text-sm font-medium">{t("actions.noAccount")}</p>
          </div>
        </div>
      ) : !hasRemote ? (
        /* Guard: no remote */
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-12">
          <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
            <WifiOff className="w-6 h-6" />
          </div>
          <div className="text-center px-4">
            <p className="text-sm font-medium">{t("actions.noRemote")}</p>
          </div>
        </div>
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
