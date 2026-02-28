import { useState } from "react";
import { GitMerge, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { cn, getErrorMessage } from "@/lib/utils";
import { mergeBranch } from "@/api/commands";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";
import type { MergeStrategy } from "@/types";

interface MergeActionPanelProps {
  repoPath: string;
  compareBranch: string;
  currentBranch: string;
  behindCount: number;
  isDirty: boolean;
}

const STRATEGIES: { value: MergeStrategy; labelKey: string; descKey: string }[] = [
  { value: "merge", labelKey: "merge.mergeCommit", descKey: "merge.mergeCommitDesc" },
  { value: "squash", labelKey: "merge.squash", descKey: "merge.squashDesc" },
  { value: "rebase", labelKey: "merge.rebase", descKey: "merge.rebaseDesc" },
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

  const isDisabled = behindCount === 0 || isDirty || isLoading;

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

  return (
    <div className="border-t border-border bg-surface px-3 py-3 shrink-0">
      {/* Direction indicator */}
      <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
        <GitMerge className="w-3.5 h-3.5" />
        <span className="truncate font-medium">{compareBranch}</span>
        <span>→</span>
        <span className="truncate font-medium">{currentBranch}</span>
      </div>

      {/* Strategy selector */}
      <div className="space-y-1.5 mb-3">
        {STRATEGIES.map((s) => (
          <label
            key={s.value}
            className={cn(
              "flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors",
              strategy === s.value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-accent",
            )}
          >
            <input
              type="radio"
              name="mergeStrategy"
              value={s.value}
              checked={strategy === s.value}
              onChange={() => setStrategy(s.value)}
              className="mt-0.5 accent-primary"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t(s.labelKey)}</p>
              <p className="text-xs text-muted-foreground">{t(s.descKey)}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Warning for dirty workdir */}
      {isDirty && (
        <div className="flex items-center gap-1.5 mb-2 text-xs text-warning">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{t("merge.dirtyWorkdir")}</span>
        </div>
      )}

      {/* Merge button */}
      <button
        onClick={handleMerge}
        disabled={isDisabled}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
          isDisabled
            ? "bg-muted text-muted-foreground cursor-not-allowed"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("merge.merging")}
          </>
        ) : (
          <>
            <GitMerge className="w-4 h-4" />
            {behindCount === 0
              ? t("merge.nothingToMerge")
              : t("merge.mergeInto", { source: compareBranch, target: currentBranch })}
          </>
        )}
      </button>
    </div>
  );
}
