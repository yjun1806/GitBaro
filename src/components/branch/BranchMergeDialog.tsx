import { useId } from "react";
import { useTranslation } from "react-i18next";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { MergeActionPanel } from "@/components/history/MergeActionPanel";
import { useBranchComparison } from "@/api/queries";
import { getErrorMessage } from "@/lib/utils";
import { LoadingState } from "@/components/ui/LoadingState";
import { Notice } from "@/components/ui/Notice";

interface BranchMergeDialogProps {
  repoPath: string;
  currentBranch: string;
  /** 지금 브랜치로 가져올 브랜치. */
  source: string;
  isDirty: boolean;
  onClose: () => void;
}

/**
 * 브랜치 패널 행과 범위 모드 머리글의 「Merge…」가 여는 창. 가져올 브랜치가 정해져 있다는
 * 점만 툴바 Merge 창과 다르고, 방식 선택·충돌 미리 확인·명령 확인 창은 기존
 * `MergeActionPanel`을 그대로 쓴다.
 */
export function BranchMergeDialog({ repoPath, currentBranch, source, isDirty, onClose }: BranchMergeDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const { data: comparison, isLoading, error } = useBranchComparison(repoPath, currentBranch, source);

  return (
    <DialogFrame
      title={t("gitActions.mergeTitle", { branch: currentBranch })}
      titleId={titleId}
      onClose={onClose}
      size="md"
    >
      {isLoading ? (
        <LoadingState label={t("compare.loading")} />
      ) : error ? (
        <Notice tone="danger">{getErrorMessage(error)}</Notice>
      ) : comparison ? (
        <MergeActionPanel
          repoPath={repoPath}
          compareBranch={source}
          currentBranch={currentBranch}
          behindCount={comparison.behindCount}
          isDirty={isDirty}
        />
      ) : null}
    </DialogFrame>
  );
}
