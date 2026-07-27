import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { CommitVerificationSummary, Finding, Severity } from "@/types";

/**
 * Display order: high → low. The backend already sorts findings this way
 * (severity desc → path asc → line asc), so every helper here preserves the
 * incoming order inside a group instead of re-sorting.
 */
export const SEVERITY_DESC: readonly Severity[] = ["danger", "warn", "info"];

const RANK: Record<Severity, number> = { info: 1, warn: 2, danger: 3 };

/** `danger` 3 → `warn` 2 → `info` 1. Absence of findings is rank 0, not "safe". */
export function severityRank(severity: Severity): number {
  return RANK[severity];
}

export interface SeverityCounts {
  danger: number;
  warn: number;
  info: number;
  total: number;
}

export const EMPTY_COUNTS: SeverityCounts = { danger: 0, warn: 0, info: 0, total: 0 };

export function countBySeverity(findings: readonly Finding[]): SeverityCounts {
  return findings.reduce<SeverityCounts>(
    (acc, finding) => ({
      danger: acc.danger + (finding.severity === "danger" ? 1 : 0),
      warn: acc.warn + (finding.severity === "warn" ? 1 : 0),
      info: acc.info + (finding.severity === "info" ? 1 : 0),
      total: acc.total + 1,
    }),
    EMPTY_COUNTS,
  );
}

/** History rows get counts straight from the backend instead of a finding list. */
export function countsFromSummary(summary: CommitVerificationSummary): SeverityCounts {
  return {
    danger: summary.dangerCount,
    warn: summary.warnCount,
    info: summary.infoCount,
    total: summary.dangerCount + summary.warnCount + summary.infoCount,
  };
}

/** `null` means "no rule flagged anything" — which is never the same as "passed". */
export function topSeverity(counts: SeverityCounts): Severity | null {
  if (counts.danger > 0) return "danger";
  if (counts.warn > 0) return "warn";
  if (counts.info > 0) return "info";
  return null;
}

export interface SeverityGroup {
  severity: Severity;
  findings: Finding[];
}

/** danger → warn → info. Empty groups are dropped. */
export function groupBySeverity(findings: readonly Finding[]): SeverityGroup[] {
  return SEVERITY_DESC.map((severity) => ({
    severity,
    findings: findings.filter((finding) => finding.severity === severity),
  })).filter((group) => group.findings.length > 0);
}

/**
 * Findings keyed by repository-relative path. Commit- and session-level
 * findings carry `file === ""` and are excluded — they belong to no file row.
 */
export function groupFindingsByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (finding.file === "") continue;
    const existing = grouped.get(finding.file);
    grouped.set(finding.file, existing ? [...existing, finding] : [finding]);
  }
  return grouped;
}

/** Text-only tint, for icons and inline labels. */
export const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
  danger: "text-danger",
  warn: "text-warning",
  info: "text-info",
};

/** Bordered chip. Deliberately has no "all clear" variant — see spec §7-①. */
export const SEVERITY_CHIP_CLASS: Record<Severity, string> = {
  danger: "border-danger/40 bg-danger/10 text-danger",
  warn: "border-warning/40 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
};

/** No check-mark icon exists here on purpose — see spec §7-①. */
export const SEVERITY_ICON: Record<Severity, typeof ShieldAlert> = {
  danger: ShieldAlert,
  warn: AlertTriangle,
  info: Info,
};
