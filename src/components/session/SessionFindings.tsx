import { useTranslation } from "react-i18next";
import { useSessionVerification } from "@/api/queries";
import { VerificationPanel } from "@/components/verify/VerificationPanel";

interface SessionFindingsProps {
  repoPath: string;
  sessionPath: string;
  /** True when the log was read only in part, so every signal below is a floor. */
  partialObservation: boolean;
}

/**
 * V19~V26 — the signals derived from one session log.
 *
 * Report rendering (the `checked` / `unchecked` framing, severity, rule i18n) is
 * `VerificationPanel`'s job and is reused verbatim, so there is exactly one
 * place that decides how a `VerificationReport` looks.
 *
 * The one deviation is failure handling: a session log is an optional artifact
 * whose format has no spec, so a failed parse hides this block instead of
 * rendering an error (spec §7-⑥). Nothing here is ever a pass — an empty
 * findings list means "the rules that ran found nothing", which the panel states
 * explicitly.
 */
export function SessionFindings({
  repoPath,
  sessionPath,
  partialObservation,
}: SessionFindingsProps) {
  const { t } = useTranslation();
  const { data: report, isLoading, isError } = useSessionVerification(repoPath, sessionPath);

  if (isError) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold">{t("verify.session.headingSignals")}</h3>
      {partialObservation && (
        <p className="text-[11px] text-muted-foreground">
          {t("verify.session.partialSignalsNote")}
        </p>
      )}
      <VerificationPanel report={report} isLoading={isLoading} />
    </section>
  );
}
