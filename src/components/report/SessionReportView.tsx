import { useTranslation } from "react-i18next";
import { useSessionReport } from "@/hooks/useSessionReport";
import { AskedSection } from "./AskedSection";
import { DidSection } from "./DidSection";
import { DriftSection } from "./DriftSection";
import { ImpactSection } from "./ImpactSection";
import { ReportHeaderBar } from "./ReportHeaderBar";
import { SessionReviewToggle } from "./SessionReviewToggle";
import { WentThroughSection } from "./WentThroughSection";
import { commitIdsOf, confidenceTone } from "./report-model";

interface SessionReportViewProps {
  repoPath: string;
  sessionPath: string;
}

/**
 * One page per agent session, in the order the questions get asked:
 *
 *   무엇을 시켰나 → 무엇을 했나 → 무엇을 겪었나 → 무엇이 영향받나 → 시킨 것과 다른 것
 *
 * Every section renders only when it has something to say. A section with no
 * data is omitted outright, or states in one line why it could not be answered
 * and offers the action that would fix it. There is no empty box anywhere on
 * this page, and no "all clear" — the page reports what it found and what it
 * could not check.
 *
 * A log that cannot be parsed renders nothing rather than an error.
 */
export function SessionReportView({ repoPath, sessionPath }: SessionReportViewProps) {
  const { t } = useTranslation();
  const { data: report, isLoading, isError } = useSessionReport(repoPath, sessionPath);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t("report.loading")}
      </div>
    );
  }

  if (isError || !report) return null;

  const attribution = report.did.attribution;
  const isEstimate = attribution !== null && confidenceTone(attribution.confidence) !== "fact";

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
      <ReportHeaderBar header={report.header} attribution={attribution} />

      <AskedSection asked={report.asked} />
      <DidSection did={report.did} />
      <WentThroughSection went={report.wentThrough} />
      <ImpactSection repoPath={repoPath} impact={report.impact} isEstimate={isEstimate} />
      <DriftSection drift={report.drift} />

      <SessionReviewToggle repoPath={repoPath} commitIds={commitIdsOf(report.did.commits)} />
    </div>
  );
}
