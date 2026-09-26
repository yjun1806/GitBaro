import { useState } from "react";
import { Trash2, CheckCircle, XCircle, ChevronDown, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActivityStore } from "@/stores/activity";
import { useUIStore } from "@/stores/ui";
import { formatRelativeTime } from "@/lib/utils";
import type { GitCommandEntry } from "@/types";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { Code, Count } from "@/components/ui/marks";
import { EmptyState } from "@/components/ui/EmptyState";

function ResultSummaryRow({ entry }: { entry: GitCommandEntry }) {
  const { t } = useTranslation();
  const s = entry.resultSummary;
  if (!s) return null;

  let text = "";
  if (s.type === "fetch") {
    text = t("activity.fetchSummary", {
      updated: s.updatedBranches.length,
      new: s.newBranches.length,
      deleted: s.deletedBranches.length,
    });
  } else if (s.type === "push") {
    text = t("activity.pushSummary", { count: s.commitCount, branch: s.branch });
  } else if (s.type === "merge" || s.type === "pull") {
    text = t("activity.mergeSummary", { mergeType: s.mergeType, files: s.filesChanged });
  }

  if (!text) return null;
  return <div className="px-8 pb-1 text-[11.5px] text-muted-foreground">{text}</div>;
}

function EntryRow({ entry }: { entry: GitCommandEntry }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isActive = entry.completedAt === undefined;
  const hasOutput = (entry.stdout && entry.stdout.length > 0) || (entry.stderr && entry.stderr.length > 0);

  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center gap-2 h-7 px-3 text-[12.5px] hover:bg-accent transition-colors text-left"
        onClick={() => hasOutput && setExpanded((v) => !v)}
        disabled={!hasOutput}
      >
        <span className="shrink-0">
          {isActive ? (
            <Spinner className="text-muted-foreground" label={t("activity.running")} />
          ) : entry.success ? (
            <CheckCircle className="w-3.5 h-3.5 text-success" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-danger" />
          )}
        </span>

        <span className="font-mono truncate flex-1 text-foreground">{entry.command}</span>

        {entry.durationMs !== undefined && (
          <span className="shrink-0 text-[11.5px] text-muted-foreground">{entry.durationMs}ms</span>
        )}

        {entry.completedAt && (
          <span className="shrink-0 text-[11.5px] text-muted-foreground">{formatRelativeTime(entry.completedAt)}</span>
        )}

        {hasOutput && (
          <span className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
      </button>

      {isActive && entry.progress && (
        <div className="px-8 pb-1.5 text-[11.5px] text-muted-foreground">
          {entry.progress.message}
          {entry.progress.percent !== undefined && ` (${entry.progress.percent}%)`}
        </div>
      )}

      {!isActive && <ResultSummaryRow entry={entry} />}

      {expanded && (
        <div className="px-3 pb-2 flex flex-col gap-1">
          {entry.stdout && entry.stdout.length > 0 && (
            <Code block>
              <span className="block max-h-40 overflow-y-auto text-foreground">{entry.stdout}</span>
            </Code>
          )}
          {entry.stderr && entry.stderr.length > 0 && (
            <Code block>
              <span className="block max-h-40 overflow-y-auto text-danger">{entry.stderr}</span>
            </Code>
          )}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 50;

export function ActivityLogPanel() {
  const { t } = useTranslation();
  const entries = useActivityStore((s) => s.entries);
  const clearLog = useActivityStore((s) => s.clearLog);
  const setActivityLogOpen = useUIStore((s) => s.setActivityLogOpen);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visibleEntries = entries.slice(0, visibleCount);
  const hasMore = entries.length > visibleCount;

  return (
    <div className="h-[280px] border-t border-border bg-card flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 h-8 shrink-0 border-b border-border">
        <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-foreground">
          {t("activity.title")}
          <Count value={entries.length} tone="muted" />
        </span>
        <div className="flex items-center gap-1">
          <Button iconOnly size="sm" variant="ghost" onClick={clearLog} aria-label={t("activity.clear")} title={t("activity.clear")}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            onClick={() => setActivityLogOpen(false)}
            aria-label={t("common.cancel")}
            title={t("common.cancel")}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState layout="row" title={t("activity.noActivity")} />
        ) : (
          <>
            {visibleEntries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                {t("activity.loadMore", { remaining: entries.length - visibleCount })}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
