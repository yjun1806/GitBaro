import { useTranslation } from "react-i18next";
import { UserX, WifiOff } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useSelectionStore } from "@/stores/selection";
import { useWorkflowRuns } from "@/api/queries";
import { ActionsList } from "./ActionsList";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { BranchOnlyChip, type BranchOnlyFilter } from "@/components/scope/BranchOnlyChip";

/**
 * 그래프 패널의 「Actions」 탭: 이 저장소의 워크플로 실행. 브랜치 단계에서는 `branchFilter`로 그
 * 브랜치의 실행만 보인다(5.1 「이 브랜치만」, 끄면 저장소 전체). 저장소 단계는 거를 것이 없어 필터
 * 막대가 없다.
 */
export function ActionsView({ branchFilter }: { branchFilter?: BranchOnlyFilter }) {
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

  const onlyBranch = branchFilter?.on ? branchFilter.branch : null;
  const shownRuns = onlyBranch === null ? runs : runs.filter((run) => run.headBranch === onlyBranch);

  return (
    <div className="flex flex-col h-full">
      <FilterBar left={branchFilter ? <BranchOnlyChip filter={branchFilter} /> : undefined} />

      {/* Guard: no account */}
      {!accountId ? (
        <EmptyState icon={UserX} title={t("actions.noAccount")} />
      ) : !hasRemote ? (
        /* Guard: no remote */
        <EmptyState icon={WifiOff} title={t("actions.noRemote")} />
      ) : (
        /* Normal: show runs */
        <ActionsList
          runs={shownRuns}
          isLoading={isLoading}
          selectedRunId={selectedRunId}
          onSelectRun={selectRun}
        />
      )}
    </div>
  );
}
