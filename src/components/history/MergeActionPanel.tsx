import { useState } from "react";
import {
  GitMerge,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowDownToLine,
  Layers,
  GitBranch,
} from "lucide-react";
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

  return (
    <div className="border-t border-border bg-surface px-3 py-3 shrink-0">
      {/* Direction indicator */}
      <div className="flex items-center gap-1.5 mb-2 text-xs text-info">
        <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate font-medium">{compareBranch}</span>
        <span className="text-muted-foreground">{"\u2192"}</span>
        <span className="truncate font-medium">{currentBranch}</span>
      </div>

      {/* Strategy selector */}
      <div className="space-y-1.5 mb-3">
        {STRATEGIES.map((s) => {
          const Icon = s.icon;
          return (
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
              <Icon
                className={cn(
                  "w-3.5 h-3.5 shrink-0 mt-0.5",
                  strategy === s.value ? "text-primary" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(s.labelKey)}</p>
                <p className="text-xs text-muted-foreground">{t(s.descKey)}</p>
              </div>
            </label>
          );
        })}
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
        disabled={isDirty || isLoading}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
          isDirty || isLoading
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
            {t("merge.incomingCount", { count: behindCount, branch: compareBranch })}
          </>
        )}
      </button>
    </div>
  );
}
