import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEVERITY_TEXT_CLASS } from "@/components/verify/severity";
import { formatRiskSummary, summarizeRisk } from "@/components/verify/risk-summary";
import { ScanScopePopover } from "@/components/verify/ScanScopePopover";
import { useRiskDigest, type RiskDigestRow } from "@/hooks/useRiskDigest";
import type { CommitInfo, Severity } from "@/types";

interface RiskDigestProps {
  repoPath: string;
  /** The loaded history page, newest first. Supplies subject and short id. */
  commits: CommitInfo[];
  selectedCommitId?: string | null;
  onSelectCommit: (commitId: string) => void;
  className?: string;
}

/** Severity as one glyph. There is no "all clear" dot — see spec §7-①. */
function SeverityDot({ severity }: { severity: Severity | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-current",
        severity ? SEVERITY_TEXT_CLASS[severity] : "text-muted-foreground/50",
      )}
    />
  );
}

function DigestRow({
  row,
  isSelected,
  onSelect,
}: {
  row: RiskDigestRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();

  // No report yet is not "clean" — say "checking…" rather than leaving the
  // line blank, because a blank line reads as an all-clear.
  const summary = row.report ? summarizeRisk(row.report) : null;
  const reason = summary
    ? formatRiskSummary(summary, (key, options) => t(key, options))
    : t("verify.summary.loading");

  return (
    <button
      type="button"
      onClick={onSelect}
      title={row.commit.summary}
      className={cn(
        "flex w-full items-start gap-2 border-b border-border px-3 py-1 text-left transition-colors",
        isSelected ? "bg-primary/10" : "hover:bg-accent",
      )}
    >
      <SeverityDot severity={summary?.severity ?? row.summary?.maxSeverity ?? null} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {row.commit.shortId}
          </span>
          <span className="truncate text-xs font-medium text-foreground">
            {row.commit.summary}
          </span>
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{reason}</span>
      </span>
    </button>
  );
}

/**
 * The answer to "what do I look at right now", pinned above the timeline.
 *
 * The review queue was ordered by recency; this is ordered by risk, which is
 * what P6 actually asks for. It never disappears: when nothing is unreviewed it
 * shrinks to one line that still names how many rules did not run, because a
 * vanished panel reads as "all clear".
 */
export function RiskDigest({
  repoPath,
  commits,
  selectedCommitId,
  onSelectCommit,
  className,
}: RiskDigestProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isScopeOpen, setIsScopeOpen] = useState(false);
  const { rows, totalUnreviewed, truncated, unresolvedCount, scope } = useRiskDigest(
    repoPath,
    commits,
  );

  return (
    <section className={cn("shrink-0 border-b border-border bg-surface", className)}>
      <button
        type="button"
        onClick={() => setIsExpanded((open) => !open)}
        aria-expanded={isExpanded}
        aria-label={t("verify.digest.toggle")}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            !isExpanded && "-rotate-90",
          )}
        />
        <span className="text-xs font-semibold text-foreground">
          {t("verify.digest.title", { count: totalUnreviewed })}
        </span>
      </button>

      {isExpanded && (
        <>
          {rows.map((row) => (
            <DigestRow
              key={row.commit.id}
              row={row}
              isSelected={selectedCommitId === row.commit.id}
              onSelect={() => onSelectCommit(row.commit.id)}
            />
          ))}
          {/* "Nothing unreviewed" is only said when nothing is unreviewed. A
              short list for any other reason gets its own reason below. */}
          {totalUnreviewed === 0 && rows.length === 0 && (
            <p className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              {t("verify.digest.empty", { count: scope.unchecked })}
            </p>
          )}
          {rows.length > 0 && truncated && (
            <p className="border-b border-border px-3 py-1 text-[10px] text-muted-foreground">
              {t("verify.digest.truncated", { count: rows.length })}
            </p>
          )}
          {unresolvedCount > 0 && (
            <p className="border-b border-border px-3 py-1 text-[10px] text-muted-foreground">
              {t("verify.queue.unresolved", { count: unresolvedCount })}
            </p>
          )}
        </>
      )}

      {/* The scan scope stays on screen whether the rows are open or not: it is
          the one number that keeps an empty list from reading as a pass. */}
      <div className="relative flex items-center gap-2 px-3 py-1">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {t("verify.digest.scope", {
            checked: scope.checked,
            unchecked: scope.unchecked,
          })}
        </span>
        <button
          type="button"
          onClick={() => setIsScopeOpen((open) => !open)}
          aria-expanded={isScopeOpen}
          className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {t("verify.digest.scopeOpen")}
        </button>
        {isScopeOpen && <ScanScopePopover onClose={() => setIsScopeOpen(false)} />}
      </div>
    </section>
  );
}
