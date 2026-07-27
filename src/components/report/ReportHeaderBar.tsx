import { useTranslation } from "react-i18next";
import { Bot, Clock, FolderTree, GitBranch, Scissors } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { CommitAttribution, ReportHeader } from "@/types";
import { EstimateChip } from "./atoms";
import { confidenceTone, durationParts, knownBasis, msToUnixSeconds } from "./report-model";

interface ReportHeaderBarProps {
  header: ReportHeader;
  /** `null` when no commit could be attributed — then there is nothing to hedge. */
  attribution: CommitAttribution | null;
}

/**
 * 세션 · "로그인 리팩터링 해줘"    2시간 전 · 47분 · Claude Code
 *
 * The title is composed by the backend, so the page and the session list can
 * never disagree about what a session was called.
 *
 * Two things here change what the reader does with the rest of the page, so
 * they get their own lines rather than a tooltip:
 * - `partial` — every count below is a floor, not a total.
 * - a below-`high` attribution — the commit half of § 무엇을 했나 and the
 *   baseline of § 무엇이 영향받나 are estimates.
 */
export function ReportHeaderBar({ header, attribution }: ReportHeaderBarProps) {
  const { t } = useTranslation();
  const duration = durationParts(header.durationMs);
  const isEstimate = attribution !== null && confidenceTone(attribution.confidence) === "estimate";
  const basis = attribution ? knownBasis(attribution.basis) : [];

  return (
    <header className="flex flex-col gap-1.5 border-b border-border pb-3">
      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 text-sm font-semibold leading-snug">{header.title}</h1>
        {isEstimate && <EstimateChip basis={basis} />}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>{formatRelativeTime(msToUnixSeconds(header.startedAt))}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {t(`report.header.duration.${duration.unit}`, { count: duration.value })}
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Bot className="h-3 w-3" />
          {t(`report.header.source.${header.source}`)}
        </span>
        {header.gitBranch && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {header.gitBranch}
            </span>
          </>
        )}
        {header.compactionCount > 0 && (
          <>
            <span aria-hidden>·</span>
            <span
              className="inline-flex items-center gap-1"
              title={t("report.header.compactionNote")}
            >
              <Scissors className="h-3 w-3" />
              {t("report.header.compactions", { count: header.compactionCount })}
            </span>
          </>
        )}
      </div>

      {header.cwdRelation === "siblingWorktree" && (
        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <FolderTree className="h-3 w-3 shrink-0" />
          {t("report.header.siblingWorktree", { cwd: header.cwd })}
        </p>
      )}

      {header.partial && (
        <p className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {header.truncated
            ? t("report.header.truncated")
            : t("report.header.skippedRecords", { count: header.skippedRecords })}
        </p>
      )}

      {isEstimate && (
        <p className="text-[11px] text-warning">
          {t("report.confidence.mediumNote", {
            reasons: basis.map((token) => t(`report.basis.${token}`)).join(" · "),
          })}
        </p>
      )}

      {attribution !== null && attribution.ambiguousWith > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("report.confidence.ambiguous", { count: attribution.ambiguousWith })}
        </p>
      )}
    </header>
  );
}
