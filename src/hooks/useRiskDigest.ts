import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { verifyCommit } from "@/api/verify";
import {
  useCommitReviewStates,
  useCommitVerificationSummaries,
  useReviewQueue,
  useVerifyRules,
} from "@/api/queries";
import { deriveReviewQueue } from "@/components/review/review-model";
import { countRuleStatuses } from "@/components/verify/rules";
import { DIGEST_ROWS, rankDigestRows } from "@/components/history/risk-digest-model";
import type { CommitInfo, CommitVerificationSummary, VerificationReport } from "@/types";

export interface RiskDigestRow {
  commit: CommitInfo;
  /** Counts only — enough to rank, never enough to say why (§2.8). */
  summary: CommitVerificationSummary | null;
  /** The full report, or `null` while it loads. `null` is not "clean". */
  report: VerificationReport | null;
}

export interface RiskDigestScope {
  /** Rules implemented and switched on. */
  checked: number;
  /** Rules switched off plus rules not implemented — reported as unchecked. */
  unchecked: number;
}

export interface RiskDigest {
  rows: RiskDigestRow[];
  /** The backend's count, which can exceed the rows shown. */
  totalUnreviewed: number;
  truncated: boolean;
  /**
   * Unreviewed commits that are not on the loaded history page, so they cannot
   * be ranked. Surfaced so a short list never implies a complete one.
   */
  unresolvedCount: number;
  /** Comes from the rule configuration, so it does not move commit to commit. */
  scope: RiskDigestScope;
}

/**
 * Two-stage fetch (§2.8). `verify_commit_range` is cheap and batched, so it
 * ranks the whole loaded page; the expensive full `verify_commit` runs only for
 * the handful of rows that will actually be rendered.
 *
 * Those reports use the same `["verifyCommit", repoPath, oid]` key as
 * `useCommitVerification`, so clicking a digest row into `CommitDetail` is a
 * cache hit rather than a second walk of history.
 */
export function useRiskDigest(
  repoPath: string | null,
  commits: readonly CommitInfo[],
): RiskDigest {
  const { data: queue } = useReviewQueue(repoPath, null);
  const queueIds = useMemo(() => queue?.unreviewedCommitIds ?? [], [queue]);

  const { data: reviewStates = [] } = useCommitReviewStates(repoPath, queueIds);
  const { data: summaries = [] } = useCommitVerificationSummaries(repoPath, queueIds);

  const { ranking, unresolvedCount } = useMemo(() => {
    const derived = deriveReviewQueue({
      queueIds,
      commits: [...commits],
      reviewStates,
      summaries,
    });
    return {
      ranking: rankDigestRows(derived.rows, DIGEST_ROWS),
      unresolvedCount: derived.unresolvedCount,
    };
  }, [queueIds, commits, reviewStates, summaries]);

  const reports = useQueries({
    queries: ranking.rows.map((row) => ({
      queryKey: ["verifyCommit", repoPath, row.commit.id],
      queryFn: () => verifyCommit(repoPath!, row.commit.id),
      enabled: repoPath !== null,
      staleTime: 60_000,
      retry: false,
    })),
  });

  const { data: rules = [] } = useVerifyRules();
  const scope = useMemo(() => {
    const { active, disabled, planned } = countRuleStatuses(rules);
    return { checked: active, unchecked: disabled + planned };
  }, [rules]);

  const rows = ranking.rows.map((row, index) => ({
    commit: row.commit,
    summary: row.verification,
    report: reports[index]?.data ?? null,
  }));

  return {
    rows,
    totalUnreviewed: queue?.totalUnreviewed ?? ranking.candidateCount,
    truncated: ranking.truncated || (queue?.truncated ?? false),
    unresolvedCount,
    scope,
  };
}
