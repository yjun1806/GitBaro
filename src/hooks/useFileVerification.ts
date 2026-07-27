import { useMemo } from "react";
import { useVerificationReport } from "@/api/queries";
import { useCommitDraftStore } from "@/stores/commit-draft";
import { buildFileRisk } from "@/components/verify/risk-sort";
import { EMPTY_COUNTS, type SeverityCounts } from "@/components/verify/severity";

export interface FileVerification {
  /** Findings on this file only. Commit- and session-level ones are excluded. */
  counts: SeverityCounts;
  /** Rules that could not run at all, so an empty `counts` never reads as "clean". */
  uncheckedCount: number;
}

/**
 * One file's slice of the working-tree report.
 *
 * Reads the same `["verifyWorkingTree", repoPath, staged, draftMessage]` cache
 * entry the verification panel uses, so opening a diff never triggers a second
 * scan — hence the draft message is pulled from the store here too rather than
 * passed in.
 */
export function useFileVerification(
  repoPath: string | null,
  filePath: string,
  staged: boolean,
): FileVerification {
  const draftSummary = useCommitDraftStore((s) => s.summary);
  const { data: report } = useVerificationReport(repoPath, staged, draftSummary || null);

  return useMemo(() => {
    if (!report) return { counts: EMPTY_COUNTS, uncheckedCount: 0 };
    return {
      counts: buildFileRisk(report.findings).get(filePath) ?? EMPTY_COUNTS,
      uncheckedCount: report.unchecked.length,
    };
  }, [report, filePath]);
}
