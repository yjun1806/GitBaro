import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { computeReviewProgress } from "./review-model";
import type { FileReviewEntry } from "@/types";

export interface ReviewProgressProps {
  /** Paths in the current diff — the denominator. */
  paths: string[];
  /** From `useFileReviewStates`. Missing entries count as unreviewed. */
  entries: FileReviewEntry[];
  className?: string;
}

/**
 * "N / M files reviewed" for the current change set (V13).
 *
 * Deliberately has no completion affordance: reaching M/M shows the same bar,
 * not a checkmark. Reviewing every file is not the same as the change being
 * safe, and the UI must never make that claim (spec §7-①).
 */
export function ReviewProgress({ paths, entries, className }: ReviewProgressProps) {
  const { t } = useTranslation();
  const { total, reviewed, stale } = computeReviewProgress(paths, entries);

  if (total === 0) return null;

  const percent = Math.round((reviewed / total) * 100);

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <div
        className="h-1 w-16 shrink-0 rounded-full bg-border overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
        {t("verify.review.progress", { reviewed, total })}
      </span>
      {stale > 0 && (
        <span
          title={t("verify.review.staleHint")}
          className="text-[11px] text-warning whitespace-nowrap"
        >
          {t("verify.review.progressStale", { stale })}
        </span>
      )}
    </div>
  );
}
