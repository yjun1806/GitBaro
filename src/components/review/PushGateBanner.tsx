import { useTranslation } from "react-i18next";
import { AlertTriangle, Eye, GitCommitHorizontal, Layers } from "lucide-react";
import { usePushGateSummary } from "@/api/queries";
import { cn, getErrorMessage } from "@/lib/utils";
import type { ReactNode } from "react";

export interface PushGateBannerProps {
  repoPath: string;
  remote: string;
  branch: string;
  /** Gate the backend walk. Pass `false` while the surface is closed. */
  enabled?: boolean;
  /** Purely navigational escape hatch (e.g. scroll to the review queue). */
  onReviewFirst?: () => void;
  className?: string;
}

function Chip({
  icon,
  label,
  tone,
}: {
  icon: ReactNode;
  label: string;
  tone: "neutral" | "warn" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        tone === "danger" && "border-danger/45 bg-danger/10 text-danger",
        tone === "warn" && "border-warning/45 bg-warning/10 text-warning",
        tone === "neutral" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

/**
 * V34 — what is about to leave this machine, shown above the push action.
 *
 * **Display only.** This component renders no push control and disables
 * nothing. Blocking a push teaches people to route around the tool
 * (spec §V34, principle P5), so the only thing it does is describe the
 * outgoing commits.
 *
 * Two lines: a title and the chips. The "this is a summary, not a gate" note
 * moved into the title's tooltip, and the empty-findings sentence was dropped
 * entirely — the history digest owns that message now, and repeating it above
 * a push button is exactly where it reads as an all-clear (spec §7-①).
 */
export function PushGateBanner({
  repoPath,
  remote,
  branch,
  enabled = true,
  onReviewFirst,
  className,
}: PushGateBannerProps) {
  const { t } = useTranslation();
  const { data: summary, isError, error } = usePushGateSummary(
    repoPath,
    remote,
    branch,
    enabled,
  );

  if (isError) {
    return (
      <p className={cn("px-3 py-2 text-[11px] text-muted-foreground", className)}>
        {t("verify.pushGate.failed", { error: getErrorMessage(error) })}
      </p>
    );
  }

  // Nothing outgoing (or not loaded yet) — say nothing rather than reassure.
  if (!summary || summary.commits.length === 0) return null;

  const { commits, unreviewedCount, dangerCount, warnCount, tangledCount } = summary;
  const tone = dangerCount > 0 ? "danger" : unreviewedCount > 0 ? "warn" : "neutral";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-b px-3 py-2",
        tone === "danger" && "border-danger/30 bg-danger/5",
        tone === "warn" && "border-warning/30 bg-warning/5",
        tone === "neutral" && "border-border bg-surface",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <p
          title={t("verify.pushGate.displayOnly")}
          className={cn(
            "text-xs font-semibold",
            tone === "danger" ? "text-danger" : "text-foreground",
          )}
        >
          {t("verify.pushGate.title")}
        </p>
        <span className="flex-1" />
        {onReviewFirst && unreviewedCount > 0 && (
          <button
            type="button"
            onClick={onReviewFirst}
            className="shrink-0 text-[11px] font-medium text-primary hover:underline"
          >
            {t("verify.pushGate.reviewFirst")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Chip
          icon={<GitCommitHorizontal className="w-2.5 h-2.5 shrink-0" />}
          label={t("verify.pushGate.commits", { count: commits.length })}
          tone="neutral"
        />
        {unreviewedCount > 0 && (
          <Chip
            icon={<Eye className="w-2.5 h-2.5 shrink-0" />}
            label={t("verify.pushGate.unreviewed", { count: unreviewedCount })}
            tone="warn"
          />
        )}
        {dangerCount > 0 && (
          <Chip
            icon={<AlertTriangle className="w-2.5 h-2.5 shrink-0" />}
            label={t("verify.pushGate.danger", { count: dangerCount })}
            tone="danger"
          />
        )}
        {warnCount > 0 && (
          <Chip
            icon={<AlertTriangle className="w-2.5 h-2.5 shrink-0" />}
            label={t("verify.pushGate.warn", { count: warnCount })}
            tone="warn"
          />
        )}
        {tangledCount > 0 && (
          <Chip
            icon={<Layers className="w-2.5 h-2.5 shrink-0" />}
            label={t("verify.pushGate.tangled", { count: tangledCount })}
            tone="warn"
          />
        )}
      </div>
    </div>
  );
}
