import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, ScanSearch } from "lucide-react";
import type { VerificationReport } from "@/types";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { Disclosure } from "@/components/ui/Disclosure";
import { SEVERITY_ICON, SEVERITY_TEXT_CLASS, groupBySeverity } from "./severity";
import { formatRiskSummary, summarizeRisk } from "./risk-summary";
import { FindingItem } from "./FindingItem";
import { UncheckedSummary } from "./UncheckedSummary";
import { DeepScanSection, type DeepScanTarget } from "./DeepScanSection";

export interface VerificationPanelProps {
  report: VerificationReport | undefined;
  isLoading: boolean;
  /** Query error, if any. Rendered inline; the container also raises a toast. */
  error?: unknown;
  onRescan?: () => void;
  /**
   * Revision the on-demand tree-sitter scan (V1·V7·V8·V9·V17) should read.
   * Omit it where there is no git revision to scan — a session report has none —
   * and the deep-scan affordance is not offered at all.
   */
  deepScan?: DeepScanTarget | null;
  /** Jump to a file (and line) in the diff view. */
  onNavigate?: (file: string, line: number | null) => void;
  /** Compact by default. Only a caller with a reason opens it on mount. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * `"tests skipped 3 · 2 files edited unread · not checked 22"` — the whole
 * report folded into the one line it takes to decide whether to look.
 *
 * The panel is collapsed by default (this pass exists because four expanded
 * panels stacked in one column told the user nothing). What survives collapse
 * is the part that must never be lost: the top reason to look and the
 * not-checked count. There is no "passed" state anywhere in this tree — an
 * empty finding list reads as "the rules that ran flagged nothing", which is a
 * statement about the rules (spec §7-①).
 */
export function VerificationPanel({
  report,
  isLoading,
  error,
  onRescan,
  deepScan = null,
  onNavigate,
  defaultOpen = false,
  className,
}: VerificationPanelProps) {
  const { t } = useTranslation();

  const risk = useMemo(() => (report ? summarizeRisk(report) : null), [report]);
  const groups = useMemo(
    () => (report ? groupBySeverity(report.findings) : []),
    [report],
  );

  const Icon = risk?.severity ? SEVERITY_ICON[risk.severity] : ScanSearch;
  const headline = risk
    ? formatRiskSummary(risk, t)
    : isLoading
      ? t("verify.report.scanning")
      : t("verify.title");

  const tooltip = report
    ? `${t("verify.title")} · ${t("verify.report.generatedAt", {
        time: formatRelativeTime(Math.floor(report.generatedAt / 1000)),
      })}`
    : t("verify.title");

  return (
    <Disclosure
      defaultOpen={defaultOpen}
      title={tooltip}
      className={className}
      summaryClassName="px-3 py-1.5"
      bodyClassName="flex flex-col border-t border-border"
      summary={
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            className={cn(
              "w-3.5 h-3.5 shrink-0",
              risk?.severity ? SEVERITY_TEXT_CLASS[risk.severity] : "text-muted-foreground",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{headline}</span>
        </span>
      }
      trailing={
        onRescan && (
          <button
            type="button"
            onClick={onRescan}
            disabled={isLoading}
            title={t("verify.report.rescan")}
            aria-label={t("verify.report.rescan")}
            className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </button>
        )
      }
    >
      {/* Coverage sits outside the scroll area: the not-checked count is the one
          line that must not be scrollable away from the findings it qualifies. */}
      {report && (
        <UncheckedSummary
          checked={report.checked}
          unchecked={report.unchecked}
          limits={report.limits}
          className="shrink-0 border-b border-border px-3 py-1.5"
        />
      )}

      <div className="min-h-0 max-h-72 overflow-y-auto">
        {error !== undefined && error !== null && (
          <p className="px-3 py-2 text-xs text-danger">
            {t("verify.report.failed", { error: getErrorMessage(error) })}
          </p>
        )}

        {isLoading && !report && (
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t("verify.report.scanning")}
          </p>
        )}

        {report &&
          (report.findings.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {report.checked.length === 0
                ? t("verify.scope.nothingRan")
                : t("verify.scope.noFindings")}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.severity}>
                <h3 className="flex items-center gap-2 border-b border-border bg-muted px-3 py-1">
                  <span
                    className={cn("text-xs font-semibold", SEVERITY_TEXT_CLASS[group.severity])}
                  >
                    {t(`verify.severity.${group.severity}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("verify.finding.count", { count: group.findings.length })}
                  </span>
                </h3>
                <ul>
                  {group.findings.map((finding, index) => (
                    <FindingItem
                      key={`${finding.ruleId}:${finding.file}:${finding.line}:${index}`}
                      finding={finding}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              </section>
            ))
          ))}
      </div>

      {/* Only reachable once the panel is open — a scan this expensive is never
          one keystroke away from a user who is skimming. */}
      {deepScan && <DeepScanSection target={deepScan} onNavigate={onNavigate} />}
    </Disclosure>
  );
}
