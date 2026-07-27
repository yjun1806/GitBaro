// Pure ranking behind the risk digest pinned at the top of History (spec P6).
//
// The review queue answers "what is new". This answers "what do I look at
// first", which is a different and strictly harder question: it has to put a
// single danger ahead of a hundred infos, and it has to be stable enough that
// the top row does not reshuffle while the user is reading it.

import { severityRank } from "@/components/verify/severity";
import type { ReviewQueueRow } from "@/components/review/review-model";

/**
 * How many rows the digest shows. Each row costs one full `verify_commit`
 * call (§2.8), so this is a budget, not a layout preference.
 */
export const DIGEST_ROWS = 5;

export interface DigestRanking {
  /** The highest-risk unreviewed rows, at most `limit` of them. */
  rows: ReviewQueueRow[];
  /** Unreviewed rows that could be ranked — the denominator for `truncated`. */
  candidateCount: number;
  truncated: boolean;
}

/** Absence of a summary ranks below every severity, but above nothing at all. */
function rowRank(row: ReviewQueueRow): number {
  const severity = row.verification?.maxSeverity;
  return severity ? severityRank(severity) : 0;
}

/**
 * Orders unreviewed commits by risk, newest first inside a tie.
 *
 * The comparison is a total order — max severity, then each severity count,
 * then the row's position in the history page — so the same input always
 * produces the same list. Reviewed rows are dropped: a commit the user already
 * looked at must not hold a slot in "what to look at".
 */
export function rankDigestRows(
  queueRows: readonly ReviewQueueRow[],
  limit: number = DIGEST_ROWS,
): DigestRanking {
  const candidates = queueRows
    .map((row, historyIndex) => ({ row, historyIndex }))
    .filter(({ row }) => row.status !== "reviewed");

  const ranked = [...candidates].sort((left, right) => {
    const bySeverity = rowRank(right.row) - rowRank(left.row);
    if (bySeverity !== 0) return bySeverity;

    const l = left.row.verification;
    const r = right.row.verification;
    const byDanger = (r?.dangerCount ?? 0) - (l?.dangerCount ?? 0);
    if (byDanger !== 0) return byDanger;
    const byWarn = (r?.warnCount ?? 0) - (l?.warnCount ?? 0);
    if (byWarn !== 0) return byWarn;
    const byInfo = (r?.infoCount ?? 0) - (l?.infoCount ?? 0);
    if (byInfo !== 0) return byInfo;

    return left.historyIndex - right.historyIndex;
  });

  return {
    rows: ranked.slice(0, limit).map(({ row }) => row),
    candidateCount: candidates.length,
    truncated: candidates.length > limit,
  };
}
