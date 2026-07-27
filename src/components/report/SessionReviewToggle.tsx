import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionReview } from "./useSessionReview";

interface SessionReviewToggleProps {
  repoPath: string;
  /** The session's attributed commits. Empty ⇒ nothing to anchor a mark to. */
  commitIds: string[];
}

/**
 * "이 세션 검토 완료" — one mark for the whole session, replacing the per-file
 * toggle.
 *
 * This records that a human read the report. It is **not** a verdict on the
 * code and there is no "clean" state: the label never says the session passed,
 * only that it was reviewed.
 *
 * Renders nothing when no commit was attributed — a mark that cannot be
 * persisted is a lie about durability.
 */
export function SessionReviewToggle({ repoPath, commitIds }: SessionReviewToggleProps) {
  const { t } = useTranslation();
  const { state, reviewedCount, totalCount, isPending, markReviewed, unmarkReviewed } =
    useSessionReview(repoPath, commitIds);

  if (commitIds.length === 0) return null;

  if (state === "reviewed") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {t("report.review.done", { count: totalCount })}
        </span>
        <button
          type="button"
          onClick={unmarkReviewed}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <Undo2 className="h-3 w-3" />
          {t("report.review.undo")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <span className="text-[11px] text-muted-foreground">
        {state === "partial"
          ? t("report.review.partial", { reviewed: reviewedCount, total: totalCount })
          : t("report.review.prompt")}
      </span>
      <button
        type="button"
        onClick={markReviewed}
        disabled={isPending}
        className={cn(
          "shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium",
          "transition-colors hover:bg-accent disabled:opacity-50",
        )}
      >
        {t("report.review.mark")}
      </button>
    </div>
  );
}
