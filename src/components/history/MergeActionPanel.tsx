import { useState } from "react";
import {
  GitMerge,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowDownToLine,
  Layers,
  GitBranch,
  ChevronRight,
  Zap,
  Shield,
  ShieldAlert,
  Eye,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { cn, getErrorMessage } from "@/lib/utils";
import { mergeBranch } from "@/api/commands";
import { useMergeConflictCheck } from "@/api/queries";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";
import type { MergeStrategy } from "@/types";
import { ConflictPreviewModal } from "./ConflictPreviewModal";
import { ConfirmCommandDialog } from "@/components/ui/ConfirmCommandDialog";

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
  const setCompareBranch = useUIStore((s) => s.setCompareBranch);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const addToast = useToastStore((s) => s.addToast);

  const [strategy, setStrategy] = useState<MergeStrategy>("merge");
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const conflictCheck = useMergeConflictCheck(
    repoPath,
    behindCount > 0 ? compareBranch : null,
  );

  const handleMerge = async () => {
    setIsLoading(true);
    try {
      await mergeBranch(repoPath, compareBranch, strategy);
      addToast(t("merge.success", { source: compareBranch, target: currentBranch }), "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["branchComparison"] }),
        queryClient.invalidateQueries({ queryKey: ["mergeConflictCheck"] }),
      ]);
      setCompareBranch(null);
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.toLowerCase().includes("conflict")) {
        addToast(t("merge.conflictDetected"), "warning");
        setActiveTab("changes");
      } else {
        addToast(t("merge.failed", { error: message }), "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // No incoming commits — show compact "up to date" notice
  if (behindCount === 0) {
    return (
      <div className="border-t border-border bg-surface px-3 py-2.5 shrink-0">
        <div className="flex items-center gap-2 text-xs text-success">
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
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-info/8 border border-info/15">
        <ArrowDownToLine className="w-3 h-3 text-info shrink-0" />
        <span className="text-[11px] font-medium text-info truncate min-w-0">{compareBranch}</span>
        <ChevronRight className="w-3 h-3 text-info/50 shrink-0" />
        <span className="text-[11px] font-medium text-foreground truncate min-w-0">{currentBranch}</span>
      </div>

      {/* Strategy selector — segmented control */}
      <div>
        <div className="flex rounded-md border border-border overflow-hidden bg-accent">
          {STRATEGIES.map((s) => {
            const Icon = s.icon;
            const isActive = strategy === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setStrategy(s.value)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors border-r border-border last:border-r-0",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-white dark:bg-gray-900 text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer",
                )}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="truncate">{t(s.labelKey)}</span>
              </button>
            );
          })}
        </div>
        {/* Strategy description — tightly coupled below the control */}
        <p className="mt-1 text-xs leading-snug text-muted-foreground px-0.5">
          {t(activeStrategy.descKey)}
        </p>
      </div>

      {/* Merge conflict pre-check banner */}
      {conflictCheck.isLoading && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/50 border border-border">
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
          <span className="text-[11px] text-muted-foreground">{t("merge.preCheck.checking")}</span>
        </div>
      )}
      {conflictCheck.data && !conflictCheck.isLoading && (
        <>
          {conflictCheck.data.canFastForward && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-info/8 border border-info/15">
              <Zap className="w-3.5 h-3.5 text-info shrink-0" />
              <span className="text-[11px] text-info">{t("merge.preCheck.fastForward")}</span>
            </div>
          )}
          {!conflictCheck.data.canFastForward && !conflictCheck.data.hasConflicts && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-success/8 border border-success/15">
              <Shield className="w-3.5 h-3.5 text-success shrink-0" />
              <span className="text-[11px] text-success">{t("merge.preCheck.clean")}</span>
            </div>
          )}
          {conflictCheck.data.hasConflicts && (
            <div className="flex flex-col gap-1 px-2 py-1.5 rounded-md bg-warning/8 border border-warning/20">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-warning shrink-0" />
                <span className="text-[11px] font-medium text-warning">
                  {t("merge.preCheck.conflictsDetected", { count: conflictCheck.data.conflictFiles.length })}
                </span>
                <button
                  onClick={() => setShowPreview(true)}
                  className="ml-auto text-[10px] text-warning/80 hover:text-warning flex items-center gap-0.5"
                >
                  <Eye className="w-3 h-3" />
                  {t("merge.preCheck.previewButton")}
                </button>
              </div>
              {conflictCheck.data.conflictFiles.length <= 5 && (
                <ul className="ml-5 space-y-0.5">
                  {conflictCheck.data.conflictFiles.map((f) => (
                    <li key={f} className="text-[10px] text-warning/80 font-mono truncate">{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* Dirty workdir warning */}
      {isDirty && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-warning/8 border border-warning/20">
          <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-px" />
          <span className="text-[11px] text-warning leading-snug">{t("merge.dirtyWorkdir")}</span>
        </div>
      )}

      {/* Merge button — always looks like a button, dims when disabled */}
      <button
        onClick={() => setShowConfirm(true)}
        disabled={isDisabled}
        className={cn(
          "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-opacity",
          "bg-primary text-primary-foreground",
          isDisabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:opacity-90 active:opacity-80",
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t("merge.merging")}
          </>
        ) : (
          <>
            <GitMerge className="w-3.5 h-3.5" />
            {t("merge.incomingCount", { count: behindCount })}
          </>
        )}
      </button>

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
