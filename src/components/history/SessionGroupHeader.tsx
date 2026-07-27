import { useTranslation } from "react-i18next";
import { ChevronDown, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEVERITY_TEXT_CLASS } from "@/components/verify/severity";
import { formatRiskSummary, summarizeRisk } from "@/components/verify/risk-summary";
import { durationParts, isPartialObservation } from "@/components/session/session-signals";
import { useSessionVerification } from "@/api/queries";
import type { SessionGroup } from "@/components/history/session-groups";

interface SessionGroupHeaderProps {
  repoPath: string;
  group: SessionGroup;
  isExpanded: boolean;
  onToggle: () => void;
  /** V30 — open the session's cumulative net diff as one unit of review. */
  onOpenSession: () => void;
}

const PROMPT_PREVIEW_CHARS = 60;

function promptPreview(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  return collapsed.length > PROMPT_PREVIEW_CHARS
    ? `${collapsed.slice(0, PROMPT_PREVIEW_CHARS)}…`
    : collapsed;
}

/**
 * Three fixed lines: what was asked, how big the session was, and why it is
 * worth reading. Nothing else — the previous list item spent four to five
 * lines per session and made the sidebar unreadable.
 */
export function SessionGroupHeader({
  repoPath,
  group,
  isExpanded,
  onToggle,
  onOpenSession,
}: SessionGroupHeaderProps) {
  const { t } = useTranslation();
  const { session } = group;

  const { data: report } = useSessionVerification(repoPath, session.filePath);
  const summary = report ? summarizeRisk(report) : null;
  const riskLine = summary
    ? formatRiskSummary(summary, (key, options) => t(key, options))
    : t("verify.summary.loading");

  const duration = durationParts(group.durationMs);
  const stats = t("history.session.stats", {
    commits: group.commits.length,
    files: group.fileCount,
    duration: t(`verify.session.duration.${duration.unit}`, { count: duration.value }),
  });

  const prompt = session.firstUserPrompt
    ? promptPreview(session.firstUserPrompt)
    : t("verify.session.noPrompt");

  return (
    <div className="flex items-start gap-1 border-b border-border bg-surface px-2 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
      >
        <ChevronDown
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            !isExpanded && "-rotate-90",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">
              {t("history.session.group", { prompt })}
            </span>
            {group.confidence === "medium" && (
              <span
                title={t("verify.session.link.estimateNote")}
                className="shrink-0 rounded border border-border px-1 text-[10px] leading-none text-muted-foreground"
              >
                {t("verify.session.link.confidence.medium")}
              </span>
            )}
            {isPartialObservation(session) && (
              <span
                title={t("verify.session.truncated")}
                className="shrink-0 text-[10px] text-muted-foreground"
              >
                {t("verify.session.partial")}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground tabular-nums">
            {stats}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "h-2 w-2 shrink-0 rounded-full bg-current",
                summary?.severity
                  ? SEVERITY_TEXT_CLASS[summary.severity]
                  : "text-muted-foreground/50",
              )}
            />
            <span className="truncate text-[11px] text-muted-foreground">{riskLine}</span>
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onOpenSession}
        title={t("verify.session.showCumulativeDiff")}
        aria-label={t("verify.session.showCumulativeDiff")}
        className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <GitCompare className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
