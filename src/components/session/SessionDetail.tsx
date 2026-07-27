import { useTranslation } from "react-i18next";
import { Bot, Clock, GitBranch, Scissors } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { useSessionSummary } from "@/api/queries";
import { Disclosure } from "@/components/ui/Disclosure";
import { SessionPromptAnchor } from "./SessionPromptAnchor";
import { SessionFileEdits } from "./SessionFileEdits";
import { SessionBashCommands } from "./SessionBashCommands";
import { SessionCumulativeDiff } from "./SessionCumulativeDiff";
import { SessionFindings } from "./SessionFindings";
import { durationParts, isPartialObservation, sessionDurationMs } from "./session-signals";

interface SessionDetailProps {
  repoPath: string;
  sessionPath: string;
}

/**
 * V19~V27 · V30 — everything one agent session did, in the order a reviewer
 * needs it: the original prompt first (V26, the specification anchor), then what
 * it read and edited, then what it ran, then its net change and derived signals.
 *
 * A log that cannot be parsed renders nothing rather than an error (spec §7-⑥).
 */
export function SessionDetail({ repoPath, sessionPath }: SessionDetailProps) {
  const { t } = useTranslation();
  const { data: summary, isLoading, isError } = useSessionSummary(sessionPath);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("verify.session.loading")}
      </div>
    );
  }

  if (isError || !summary) return null;

  const duration = durationParts(sessionDurationMs(summary));
  const partial = isPartialObservation(summary);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-3">
      <header className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 text-foreground font-medium">
          <Bot className="w-3.5 h-3.5" />
          {t(`verify.session.source.${summary.source}`)}
        </span>
        {summary.gitBranch && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5" />
            {summary.gitBranch}
          </span>
        )}
        <span>
          {t("verify.session.startedAt", {
            time: formatRelativeTime(Math.floor(summary.startedAt / 1000)),
          })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {t(`verify.session.duration.${duration.unit}`, { count: duration.value })}
        </span>
        {summary.compactionBoundaries.length > 0 && (
          <span className="inline-flex items-center gap-1" title={t("verify.session.compactionNote")}>
            <Scissors className="w-3.5 h-3.5" />
            {t("verify.session.compactions", { count: summary.compactionBoundaries.length })}
          </span>
        )}
      </header>

      {partial && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          {summary.truncated
            ? t("verify.session.truncated")
            : t("verify.session.skippedRecords", { count: summary.skippedRecords })}
        </p>
      )}

      {/* The prompt is the only external specification a reviewer has (V26/P8),
          so it is the one thing left open. Everything below is evidence you go
          looking for, and each block only fetches once it is opened. */}
      <SessionPromptAnchor prompt={summary.firstUserPrompt} />

      <Disclosure
        className="rounded-md border border-border"
        summaryClassName="px-2 py-1.5"
        bodyClassName="border-t border-border px-2 py-2"
        summary={
          <span className="text-xs font-semibold">
            {t("verify.session.filesEdited", { count: summary.filesEdited.length })}
          </span>
        }
      >
        <SessionFileEdits edits={summary.filesEdited} filesRead={summary.filesRead} />
      </Disclosure>

      <Disclosure
        className="rounded-md border border-border"
        summaryClassName="px-2 py-1.5"
        bodyClassName="border-t border-border px-2 py-2"
        summary={
          <span className="text-xs font-semibold">
            {t("verify.session.commands", { count: summary.bashCommands.length })}
          </span>
        }
      >
        <SessionBashCommands commands={summary.bashCommands} />
      </Disclosure>

      <Disclosure
        className="rounded-md border border-border"
        summaryClassName="px-2 py-1.5"
        bodyClassName="border-t border-border px-2 py-2"
        summary={
          <span className="text-xs font-semibold">{t("verify.session.showCumulativeDiff")}</span>
        }
      >
        <SessionCumulativeDiff repoPath={repoPath} sessionPath={sessionPath} />
      </Disclosure>

      <SessionFindings
        repoPath={repoPath}
        sessionPath={sessionPath}
        partialObservation={partial}
      />
    </div>
  );
}
