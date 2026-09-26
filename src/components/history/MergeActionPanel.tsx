import { useState } from "react";
import { GitMerge, AlertCircle, CheckCircle2, ArrowDownToLine, Layers, GitBranch, ChevronRight, Zap, Shield, ShieldAlert, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { getErrorMessage, isMergeConflictError } from "@/lib/utils";
import { mergeBranch } from "@/api/commands";
import { useMergeConflictCheck } from "@/api/queries";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import type { MergeStrategy } from "@/types";
import { ConflictPreviewModal } from "./ConflictPreviewModal";
import { ConfirmCommandDialog } from "@/components/ui/ConfirmCommandDialog";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Notice } from "@/components/ui/Notice";

interface MergeActionPanelProps {
  repoPath: string;
  compareBranch: string;
  currentBranch: string;
  behindCount: number;
  isDirty: boolean;
}

const STRATEGIES: {
  value: MergeStrategy;
  labelKey: string;
  descKey: string;
  icon: typeof GitMerge;
}[] = [
  { value: "merge", labelKey: "merge.mergeCommit", descKey: "merge.mergeCommitDesc", icon: GitMerge },
  { value: "squash", labelKey: "merge.squash", descKey: "merge.squashDesc", icon: Layers },
  { value: "rebase", labelKey: "merge.rebase", descKey: "merge.rebaseDesc", icon: GitBranch },
];

export function MergeActionPanel({
  repoPath,
  compareBranch,
  currentBranch,
  behindCount,
  isDirty,
}: MergeActionPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const addToast = useToastStore((s) => s.addToast);
  const accountId = useRepoAccountId();

  const [strategy, setStrategy] = useState<MergeStrategy>("merge");
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const conflictCheck = useMergeConflictCheck(
    repoPath,
    behindCount > 0 ? compareBranch : null,
  );

  const invalidateAfterMerge = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["branches"] }),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
      queryClient.invalidateQueries({ queryKey: ["mergeState"] }),
      queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
      queryClient.invalidateQueries({ queryKey: ["branchComparison"] }),
      queryClient.invalidateQueries({ queryKey: ["mergeConflictCheck"] }),
    ]);

  const handleMerge = async () => {
    setIsLoading(true);
    try {
      await mergeBranch(repoPath, compareBranch, strategy, accountId);
      addToast(t("merge.success", { source: compareBranch, target: currentBranch }), "success");
      await invalidateAfterMerge();
    } catch (error) {
      if (isMergeConflictError(error)) {
        // 충돌 파일과 merge 진행 상태가 이미 바뀌었다. 목록을 갱신해야 Changes 탭에
        // 충돌 해결 배너가 뜬다.
        await invalidateAfterMerge();
        addToast(t("merge.conflictStopped"), "warning");
        setActiveTab("changes");
      } else {
        addToast(t("merge.failed", { error: getErrorMessage(error) }), "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // No incoming commits — show compact "up to date" notice
  if (behindCount === 0) {
    return (
      <div className="border-t border-border bg-surface px-3 py-2.5 shrink-0">
        <div className="flex items-center gap-2 text-[11.5px] text-success">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{t("merge.upToDate", { branch: compareBranch })}</span>
        </div>
      </div>
    );
  }

  const isDisabled = isDirty || isLoading;
  const activeStrategy = STRATEGIES.find((s) => s.value === strategy)!;

  return (
    <div className="border-t border-border bg-surface px-3 pt-2.5 pb-3 shrink-0 space-y-2">
      {/* Direction indicator — pill with clear source → target hierarchy */}
      <Notice tone="info" icon={ArrowDownToLine}>
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate min-w-0">{compareBranch}</span>
          <ChevronRight className="w-3 h-3 shrink-0" />
          <span className="truncate min-w-0 text-foreground">{currentBranch}</span>
        </span>
      </Notice>

      {/* Strategy selector — segmented control */}
      <div>
        <Segmented
          size="md"
          ariaLabel={t("merge.strategy")}
          value={strategy}
          onChange={setStrategy}
          options={STRATEGIES.map((s) => ({
            value: s.value,
            label: t(s.labelKey),
            icon: <s.icon className="w-3 h-3 shrink-0" />,
          }))}
        />
        {/* Strategy description — tightly coupled below the control */}
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground px-0.5">
          {t(activeStrategy.descKey)}
        </p>
      </div>

      {/* Merge conflict pre-check banner */}
      {conflictCheck.isLoading && (
        <Notice tone="neutral">
          <span className="flex items-center gap-1.5">
            <Spinner size="sm" />
            {t("merge.preCheck.checking")}
          </span>
        </Notice>
      )}
      {conflictCheck.data && !conflictCheck.isLoading && (
        <>
          {conflictCheck.data.canFastForward && (
            <Notice tone="info" icon={Zap}>
              {t("merge.preCheck.fastForward")}
            </Notice>
          )}
          {!conflictCheck.data.canFastForward && !conflictCheck.data.hasConflicts && (
            <Notice tone="success" icon={Shield}>
              {t("merge.preCheck.clean")}
            </Notice>
          )}
          {conflictCheck.data.hasConflicts && (
            <Notice
              tone="warning"
              icon={ShieldAlert}
              title={t("merge.preCheck.conflictsDetected", { count: conflictCheck.data.conflictFiles.length })}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Eye className="w-3 h-3" />}
                  onClick={() => setShowPreview(true)}
                >
                  {t("merge.preCheck.previewButton")}
                </Button>
              }
            >
              {conflictCheck.data.conflictFiles.length <= 5 && (
                <ul className="flex flex-col gap-0.5">
                  {conflictCheck.data.conflictFiles.map((f) => (
                    <li key={f} className="font-mono truncate">{f}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
        </>
      )}

      {/* Dirty workdir warning */}
      {isDirty && (
        <Notice tone="warning" icon={AlertCircle}>
          {t("merge.dirtyWorkdir")}
        </Notice>
      )}

      {/* Merge button — always looks like a button, dims when disabled */}
      <Button
        variant="primary"
        size="md"
        className="w-full"
        icon={<GitMerge className="w-3.5 h-3.5" />}
        busy={isLoading}
        disabled={isDisabled}
        onClick={() => setShowConfirm(true)}
      >
        {isLoading ? t("merge.merging") : t("merge.incomingCount", { count: behindCount })}
      </Button>

      {showPreview && conflictCheck.data && (
        <ConflictPreviewModal
          repoPath={repoPath}
          branch={compareBranch}
          currentBranch={currentBranch}
          conflictFiles={conflictCheck.data.conflictFiles}
          onClose={() => setShowPreview(false)}
        />
      )}

      {showConfirm && (
        <ConfirmCommandDialog
          title={t("merge.confirm.title")}
          description={t("merge.confirm.description", { branch: compareBranch, target: currentBranch })}
          command={
            strategy === "merge" ? `git merge --no-ff ${compareBranch}` :
            strategy === "squash" ? `git merge --squash ${compareBranch}` :
            `git rebase ${compareBranch}`
          }
          onConfirm={handleMerge}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
