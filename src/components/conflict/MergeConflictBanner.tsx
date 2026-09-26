import { AlertTriangle, Ban, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { useMergeState, useMergeRecoveryMutations } from "@/api/queries";
import { getErrorMessage } from "@/lib/utils";
import { useToastStore } from "@/stores/toast";
import type { GitOperation } from "@/types";
import { BusyIcon } from "@/components/ui/Spinner";

const OPERATION_LABEL_KEYS: Record<GitOperation, string> = {
  merge: "mergeRecovery.mergeInProgress",
  rebase: "mergeRecovery.rebaseInProgress",
  cherryPick: "mergeRecovery.cherryPickInProgress",
  revert: "mergeRecovery.revertInProgress",
  squash: "mergeRecovery.squashInProgress",
};

interface MergeConflictBannerProps {
  repoPath: string | null;
  /** Number of still-conflicted (unmerged) files in the working tree. */
  conflictCount: number;
}

/**
 * Shows when a merge, rebase, cherry-pick, revert or squash merge is in
 * progress and lets the user abort it (after confirming) or,
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
  const opLabel = t(OPERATION_LABEL_KEYS[mergeState]);

  const handleAbort = async () => {
    // 중단하면 지금까지 해결한 충돌이 모두 사라지므로 먼저 확인한다.
    const ok = await ask(t("mergeRecovery.abortConfirm"), {
      title: t("mergeRecovery.abortConfirmTitle"),
      kind: "warning",
    });
    if (!ok) return;
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
          aria-busy={conclude.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent/90 text-accent-foreground rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <BusyIcon busy={conclude.isPending} icon={<Check className="w-3.5 h-3.5" />} />
          {t("mergeRecovery.continue")}
        </button>
        <button
          onClick={handleAbort}
          disabled={abort.isPending}
          aria-busy={abort.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg transition-colors disabled:opacity-40"
        >
          <BusyIcon busy={abort.isPending} icon={<Ban className="w-3.5 h-3.5" />} />
          {t("mergeRecovery.abort")}
        </button>
      </div>
    </div>
  );
}
