import { useTranslation } from "react-i18next";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEVERITY_CHIP_CLASS, SEVERITY_ICON, topSeverity, type SeverityCounts } from "./severity";

export interface FindingBadgeProps {
  /** Use `countBySeverity(findings)` or `countsFromSummary(summary)` to build this. */
  counts: SeverityCounts;
  /**
   * Rules that could not run on this target. Rendered alongside the severity
   * so an empty finding list can never be read as "verified" (spec §7-①).
   */
  uncheckedCount?: number;
  className?: string;
}

/**
 * Compact risk marker for a file row or a history row. There is deliberately
 * no "all clear" state: with no findings it falls back to the neutral
 * "nothing flagged · N rules not checked" chip.
 */
export function FindingBadge({ counts, uncheckedCount = 0, className }: FindingBadgeProps) {
  const { t } = useTranslation();
  const severity = topSeverity(counts);

  if (!severity) {
    if (uncheckedCount === 0) return null;
    return (
      <span
        title={t("verify.badge.noFindings", { count: uncheckedCount })}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground shrink-0",
          className,
        )}
      >
        <EyeOff className="w-3 h-3" />
        {t("verify.badge.unchecked", { count: uncheckedCount })}
      </span>
    );
  }

  const Icon = SEVERITY_ICON[severity];
  const label = t(`verify.badge.${severity}`, { count: counts[severity] });
  const title =
    uncheckedCount > 0
      ? `${label} · ${t("verify.badge.unchecked", { count: uncheckedCount })}`
      : label;

  return (
    <span
      title={`${t("verify.badge.label")}: ${title}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium shrink-0",
        SEVERITY_CHIP_CLASS[severity],
        className,
      )}
    >
      <Icon className="w-3 h-3" />
      {label}
      {uncheckedCount > 0 && (
        <span className="text-muted-foreground font-normal">
          · {t("verify.badge.unchecked", { count: uncheckedCount })}
        </span>
      )}
    </span>
  );
}
