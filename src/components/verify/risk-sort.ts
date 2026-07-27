import type { Finding } from "@/types";
import { countBySeverity, severityRank, topSeverity, type SeverityCounts } from "./severity";

/**
 * Per-file severity counts, for the changed-file list. Commit- and
 * session-level findings (`file === ""`) are skipped: they belong to no row.
 */
export function buildFileRisk(findings: readonly Finding[]): Map<string, SeverityCounts> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (finding.file === "") continue;
    const existing = byFile.get(finding.file);
    byFile.set(finding.file, existing ? [...existing, finding] : [finding]);
  }

  const risk = new Map<string, SeverityCounts>();
  for (const [path, fileFindings] of byFile) {
    risk.set(path, countBySeverity(fileFindings));
  }
  return risk;
}

function riskScore(counts: SeverityCounts | undefined): number {
  if (!counts) return 0;
  const top = topSeverity(counts);
  return top ? severityRank(top) : 0;
}

/**
 * Danger files first, then warn, then info, then everything else. Stable: the
 * caller's ordering (path, staged-ness, …) survives inside every risk tier, so
 * turning the sort off restores the original list exactly.
 */
export function sortByRisk<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  risk: ReadonlyMap<string, SeverityCounts>,
): T[] {
  return items
    .map((item, index) => ({ item, index, counts: risk.get(pathOf(item)) }))
    .sort((a, b) => {
      const scoreDelta = riskScore(b.counts) - riskScore(a.counts);
      if (scoreDelta !== 0) return scoreDelta;
      const dangerDelta = (b.counts?.danger ?? 0) - (a.counts?.danger ?? 0);
      if (dangerDelta !== 0) return dangerDelta;
      const warnDelta = (b.counts?.warn ?? 0) - (a.counts?.warn ?? 0);
      if (warnDelta !== 0) return warnDelta;
      const infoDelta = (b.counts?.info ?? 0) - (a.counts?.info ?? 0);
      if (infoDelta !== 0) return infoDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}
