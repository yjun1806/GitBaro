import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { useFileReviewMutations } from "@/api/queries";
import { useToastStore } from "@/stores/toast";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { msToUnixSeconds } from "./review-model";
import type { FileReviewEntry } from "@/types";

export interface FileReviewToggleProps {
  repoPath: string;
  path: string;
  /** Which side of the index this diff came from — the backend hashes that diff. */
  staged: boolean;
  /** From `useFileReviewStates`. Undefined (still loading / never marked) reads as unreviewed. */
  entry?: FileReviewEntry;
  className?: string;
}

/**
 * Per-file "reviewed" checkbox (V13, principle P4 — make review attributable).
 *
 * The backend invalidates a mark when the file's diff hash changes, so a file
 * that was reviewed and then edited again comes back as `stale`. That
 * transition has to be loud, not silent: the box visibly unchecks *and* a
 * "changed · needs another look" marker appears next to it.
 */
export function FileReviewToggle({
  repoPath,
  path,
  staged,
  entry,
  className,
}: FileReviewToggleProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { mark, unmark } = useFileReviewMutations(repoPath);

  const status = entry?.status ?? "unreviewed";
  const isReviewed = status === "reviewed";
  const isStale = status === "stale";
  const isPending = mark.isPending || unmark.isPending;

  const handleToggle = async () => {
    try {
      if (isReviewed) await unmark.mutateAsync(path);
      else await mark.mutateAsync({ path, staged });
    } catch (err) {
      addToast(t("verify.review.markFailed", { error: getErrorMessage(err) }), "error");
    }
  };

  const attribution =
    isReviewed && entry
      ? [
          entry.reviewer ? t("verify.review.reviewedBy", { reviewer: entry.reviewer }) : null,
          entry.reviewedAt != null
            ? t("verify.review.reviewedAt", {
                time: formatRelativeTime(msToUnixSeconds(entry.reviewedAt)),
              })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  return (
    <div className={cn("flex items-center gap-1.5 min-w-0", className)}>
      <label
        title={isStale ? t("verify.review.staleHint") : attribution}
        className={cn(
          "flex items-center gap-1.5 cursor-pointer select-none",
          isPending && "opacity-50 pointer-events-none",
        )}
      >
        <input
          type="checkbox"
          className="w-3.5 h-3.5 shrink-0 cursor-pointer"
          checked={isReviewed}
          disabled={isPending}
          aria-label={
            isReviewed ? t("verify.review.unmarkReviewed") : t("verify.review.markReviewed")
          }
          onChange={(e) => {
            e.stopPropagation();
            void handleToggle();
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span
          className={cn(
            "text-[11px] whitespace-nowrap",
            isReviewed ? "text-foreground font-medium" : "text-muted-foreground",
          )}
        >
          {isReviewed ? t("verify.review.reviewed") : t("verify.review.unreviewed")}
        </span>
      </label>

      {isStale && (
        <span
          title={t("verify.review.staleHint")}
          className="inline-flex items-center gap-1 shrink-0 rounded border border-warning/45 bg-warning/10 px-1 py-px text-[10px] font-medium leading-none text-warning"
        >
          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
          <span className="whitespace-nowrap">
            {t("verify.review.stale")}
            {" · "}
            {t("verify.review.needsRecheck")}
          </span>
        </span>
      )}
    </div>
  );
}
