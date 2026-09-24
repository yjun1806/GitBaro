import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { BranchCombobox } from "@/components/ui/BranchCombobox";
import { MergeActionPanel } from "@/components/history/MergeActionPanel";
import { useBranchComparison } from "@/api/queries";
import type { BranchInfo } from "@/types";

interface MergeDialogProps {
  repoPath: string;
  currentBranch: string;
  branches: BranchInfo[];
  isDirty: boolean;
  onClose: () => void;
}

/**
 * 툴바 Merge 버튼이 여는 창. 가져올 브랜치를 고르면 기존 `MergeActionPanel`(방식 선택,
 * 충돌 미리 확인, 명령 확인 창)을 그대로 띄운다.
 */
export function MergeDialog({ repoPath, currentBranch, branches, isDirty, onClose }: MergeDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [source, setSource] = useState("");
  const candidates = useMemo(
    () => branches.filter((b) => !(b.isHead && !b.isRemote) && b.name !== currentBranch),
    [branches, currentBranch],
  );
  const { data: comparison } = useBranchComparison(repoPath, currentBranch, source || null);

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
      <div className="px-5 py-4 space-y-2">
        <p className="text-xs text-muted-foreground">{t("gitActions.mergePick")}</p>
        <BranchCombobox
          value={source}
          branches={candidates}
          onChange={setSource}
          placeholder={t("gitActions.mergePickPlaceholder")}
        />
      </div>
      {source && comparison && (
        <MergeActionPanel
          key={source}
          repoPath={repoPath}
          compareBranch={source}
          currentBranch={currentBranch}
          behindCount={comparison.behindCount}
          isDirty={isDirty}
        />
      )}
    </Dialog>
  );
}
