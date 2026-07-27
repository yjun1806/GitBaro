// Pure derivations behind the review-state UI (spec V13 · V29 · V34).
//
// These live outside the components on purpose: the queue derivation and the
// progress counts are the parts that can silently lie to the user, so they are
// the parts that get tests.

import type {
  CommitInfo,
  CommitReviewState,
  CommitVerificationSummary,
  FileReviewEntry,
  PushGateSummary,
  ReviewStatus,
} from "@/types";

/**
 * Verify-subsystem timestamps are epoch **milliseconds**, but
 * `formatRelativeTime()` takes epoch **seconds** (it matches `CommitInfo`).
 * Every crossing of that boundary goes through here.
 */
export function msToUnixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export interface ReviewQueueRow {
  commit: CommitInfo;
  status: ReviewStatus;
  /**
   * `null` when the backend has not summarised this commit yet. It is the
   * absence of an answer, never a clean bill of health.
   */
  verification: CommitVerificationSummary | null;
}

export interface ReviewQueueDerivation {
  rows: ReviewQueueRow[];
  /**
   * Queue entries whose commit metadata is not in the loaded history page, so
   * they cannot be rendered. Surfaced so the list never implies completeness.
   */
  unresolvedCount: number;
}

export interface DeriveReviewQueueInput {
  /** `ReviewQueue.unreviewedCommitIds` from the backend, newest first. */
  queueIds: string[];
  /**
   * Commits the user just marked in this session. They are kept in the list
   * after leaving the backend queue so the undo stays reachable.
   */
  retainedIds?: string[];
  /** The loaded history page, newest first. Supplies subject/author/time. */
  commits: CommitInfo[];
  reviewStates: CommitReviewState[];
  summaries: CommitVerificationSummary[];
}

/**
 * Joins the id-only backend queue against the loaded history page. Ordering
 * follows `commits` (newest first) so the queue and the timeline below it read
 * in the same direction.
 */
export function deriveReviewQueue({
  queueIds,
  retainedIds = [],
  commits,
  reviewStates,
  summaries,
}: DeriveReviewQueueInput): ReviewQueueDerivation {
  const wanted = new Set([...queueIds, ...retainedIds]);
  const statusById = new Map(reviewStates.map((s) => [s.commitId, s.status]));
  const summaryById = new Map(summaries.map((s) => [s.commitId, s]));

  const seen = new Set<string>();
  const rows: ReviewQueueRow[] = [];
  for (const commit of commits) {
    if (!wanted.has(commit.id) || seen.has(commit.id)) continue;
    seen.add(commit.id);
    rows.push({
      commit,
      status: statusById.get(commit.id) ?? "unreviewed",
      verification: summaryById.get(commit.id) ?? null,
    });
  }

  return { rows, unresolvedCount: wanted.size - seen.size };
}

export interface ReviewProgressCounts {
  /** Distinct files in the current diff — the honest denominator. */
  total: number;
  reviewed: number;
  /** Reviewed once, then changed again (V13). Deliberately **not** reviewed. */
  stale: number;
  unreviewed: number;
}

/**
 * Counts against the current file set, not against what is on disk: a mark for
 * a file that left the diff must not inflate the numerator.
 */
export function computeReviewProgress(
  paths: string[],
  entries: FileReviewEntry[],
): ReviewProgressCounts {
  const statusByPath = new Map(entries.map((e) => [e.path, e.status]));
  const distinct = new Set(paths);

  let reviewed = 0;
  let stale = 0;
  for (const path of distinct) {
    const status = statusByPath.get(path);
    if (status === "reviewed") reviewed += 1;
    else if (status === "stale") stale += 1;
  }

  return {
    total: distinct.size,
    reviewed,
    stale,
    unreviewed: distinct.size - reviewed - stale,
  };
}

/**
 * Targeted friction (spec §P5): an extra confirmation appears **only** where a
 * danger-severity finding actually exists. Never for warnings, never for
 * unreviewed-alone, never globally — blanket friction teaches bypassing.
 *
 * This never gates the push itself; it only decides whether to ask once.
 */
export function requiresDangerConfirmation(
  summary: PushGateSummary | null | undefined,
): boolean {
  return (summary?.dangerCount ?? 0) > 0;
}
