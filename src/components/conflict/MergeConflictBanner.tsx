import { AlertTriangle, Ban, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMergeState, useMergeRecoveryMutations } from "@/api/queries";
import { getErrorMessage } from "@/lib/utils";
import { useToastStore } from "@/stores/toast";

interface MergeConflictBannerProps {
  repoPath: string | null;
  /** Number of still-conflicted (unmerged) files in the working tree. */
  conflictCount: number;
}

/**
 * Shows when a merge or rebase is in progress and lets the user abort it or,
 * once all conflicts are resolved and staged, continue it. Without this the
 * user is stranded in a mid-merge state after a conflict.
 */
export function MergeConflictBanner({ repoPath, conflictCount }: MergeConflictBannerProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: mergeState } = useMergeState(repoPath);
  const { abort, conclude } = useMergeRecoveryMutations(repoPath);

  if (!mergeState) return null;

  const hasConflicts = conflictCount > 0;
  const opLabel =
    mergeState === "rebase"
      ? t("mergeRecovery.rebaseInProgress")
      : t("mergeRecovery.mergeInProgress");

  const handleAbort = () => {
    abort.mutate(undefined, {
      onError: (err) =>
        addToast(t("mergeRecovery.abortFailed", { error: getErrorMessage(err) }), "error"),
    });
  };

  const handleContinue = () => {
    conclude.mutate(undefined, {
      onError: (err) =>
        addToast(t("mergeRecovery.continueFailed", { error: getErrorMessage(err) }), "error"),
    });
  };

  return (
    <div className="flex flex-col gap-2 mx-3 my-2 p-3 rounded-xl bg-destructive/5 border border-destructive/30">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
        <span className="text-sm font-semibold text-destructive">{opLabel}</span>
      </div>

      <p className="text-xs text-muted-foreground pl-6">
        {hasConflicts
          ? t("mergeRecovery.resolveHint", { count: conflictCount })
          : t("mergeRecovery.readyHint")}
      </p>

      <div className="flex items-center gap-2 pl-6 mt-1">
        <button
          onClick={handleContinue}
          disabled={hasConflicts || conclude.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent/90 text-accent-foreground rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check className="w-3.5 h-3.5" />
          {t("mergeRecovery.continue")}
        </button>
        <button
          onClick={handleAbort}
          disabled={abort.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg transition-colors disabled:opacity-40"
        >
          <Ban className="w-3.5 h-3.5" />
          {t("mergeRecovery.abort")}
        </button>
      </div>
    </div>
  );
}
