import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, ChevronRight, GitBranch } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useSessionData } from "@/hooks/useSessionData";
import { useSelectionStore } from "@/stores/selection";
import type { SessionDigest } from "@/types";
import { Chip } from "./atoms";
import { confidenceTone, durationParts, msToUnixSeconds } from "./report-model";

interface SessionEntryListProps {
  repoPath: string;
  onOpenSession: (sessionPath: string) => void;
}

/**
 * The repository's agent sessions, newest first — the entry point to the report
 * pages.
 *
 * This is one of exactly two places that consult the DECISION A gate: with no
 * readable session it renders nothing at all, and the history view looks
 * precisely as it did before this feature existed.
 *
 * One round-trip backs the whole list (`list_session_digests`); the old grouped
 * history needed seven.
 */
export function SessionEntryList({ repoPath, onOpenSession }: SessionEntryListProps) {
  const { t } = useTranslation();
  // Collapsed by default: the commit list is what the History tab is for, and a
  // repository with dozens of sessions would otherwise push it off screen.
  const [isOpen, setIsOpen] = useState(false);
  const { hasSessions, digests } = useSessionData(repoPath);
  const selectedSessionPath = useSelectionStore((s) => s.selectedSessionPath);

  const ordered = useMemo(
    () => [...digests].sort((a, b) => b.startedAt - a.startedAt),
    [digests],
  );

  if (!hasSessions) return null;

  return (
    <section className="shrink-0 border-b border-border">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-1.5",
          "text-xs text-muted-foreground hover:bg-accent/50 transition-colors",
        )}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
        <Bot className="h-3.5 w-3.5" />
        <span>{t("report.sessions.heading", { count: ordered.length })}</span>
      </button>

      {isOpen && (
        <ul className="flex flex-col max-h-64 overflow-y-auto border-t border-border">
          {ordered.map((digest) => (
            <SessionRow
              key={digest.sessionPath}
              digest={digest}
              isSelected={digest.sessionPath === selectedSessionPath}
              onOpen={onOpenSession}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface SessionRowProps {
  digest: SessionDigest;
  isSelected: boolean;
  onOpen: (sessionPath: string) => void;
}

function SessionRow({ digest, isSelected, onOpen }: SessionRowProps) {
  const { t } = useTranslation();
  const duration = durationParts(digest.durationMs);
  const isEstimate =
    digest.attribution !== null && confidenceTone(digest.attribution) === "estimate";

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(digest.sessionPath)}
        className={cn(
          "flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left transition-colors",
          isSelected ? "bg-accent" : "hover:bg-accent/50",
        )}
      >
        <span className="truncate text-xs font-medium" title={digest.title}>
          {digest.title}
        </span>

        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted-foreground">
          <span>{formatRelativeTime(msToUnixSeconds(digest.startedAt))}</span>
          <span aria-hidden>·</span>
          <span>{t(`report.header.duration.${duration.unit}`, { count: duration.value })}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-0.5">
            <Bot className="h-3 w-3" />
            {t(`report.header.source.${digest.source}`)}
          </span>
          {digest.gitBranch && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5">
                <GitBranch className="h-3 w-3" />
                {digest.gitBranch}
              </span>
            </>
          )}
        </span>

        <span className="flex flex-wrap items-center gap-1">
          <Chip tone="muted" label={t("report.entry.filesEdited", { count: digest.filesEditedCount })} />
          {digest.commitIds.length > 0 && (
            <Chip
              tone={isEstimate ? "warning" : "muted"}
              label={
                isEstimate
                  ? t("report.entry.commitsEstimated", { count: digest.commitIds.length })
                  : t("report.entry.commits", { count: digest.commitIds.length })
              }
            />
          )}
          {digest.partial && <Chip tone="muted" label={t("report.entry.partial")} />}
        </span>
      </button>
    </li>
  );
}
