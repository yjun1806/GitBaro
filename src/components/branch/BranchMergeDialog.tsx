import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { MergeActionPanel } from "@/components/history/MergeActionPanel";
import { useBranchComparison } from "@/api/queries";
import { getErrorMessage } from "@/lib/utils";

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
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      closeOnBackdrop
      overlayClassName="z-50 bg-black/50"
      className="bg-popover border border-border rounded-xl shadow-2xl w-[440px] max-h-[80vh] flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 id={titleId} className="text-sm font-semibold truncate">
          {t("gitActions.mergeTitle", { branch: currentBranch })}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("gitActions.close")}
          className="p-1 rounded-md hover:bg-accent transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 px-5 py-6 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("compare.loading")}
        </div>
      ) : error ? (
        <p className="px-5 py-4 text-sm text-danger">{getErrorMessage(error)}</p>
      ) : comparison ? (
        <MergeActionPanel
          repoPath={repoPath}
          compareBranch={source}
          currentBranch={currentBranch}
          behindCount={comparison.behindCount}
          isDirty={isDirty}
        />
      ) : null}
    </Dialog>
  );
}
