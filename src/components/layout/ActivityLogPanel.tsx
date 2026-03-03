import { useState } from "react";
import { X, Trash2, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActivityStore } from "@/stores/activity";
import { useUIStore } from "@/stores/ui";
import { formatRelativeTime, cn } from "@/lib/utils";
import type { GitCommandEntry } from "@/types";

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
  return <div className="px-8 pb-1 text-xs text-muted-foreground">{text}</div>;
}

function EntryRow({ entry }: { entry: GitCommandEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = entry.completedAt === undefined;
  const hasOutput = (entry.stdout && entry.stdout.length > 0) || (entry.stderr && entry.stderr.length > 0);

  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
        onClick={() => hasOutput && setExpanded((v) => !v)}
        disabled={!hasOutput}
      >
        <span className="shrink-0">
          {isActive ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          ) : entry.success ? (
            <CheckCircle className="w-3.5 h-3.5 text-success" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-danger" />
          )}
        </span>

        <span className="font-mono truncate flex-1 text-foreground">{entry.command}</span>

        {entry.durationMs !== undefined && (
          <span className="shrink-0 text-muted-foreground">{entry.durationMs}ms</span>
        )}

        {entry.completedAt && (
          <span className="shrink-0 text-muted-foreground">{formatRelativeTime(entry.completedAt)}</span>
        )}

        {hasOutput && (
          <span className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
      </button>

      {isActive && entry.progress && (
        <div className="px-8 pb-1.5 text-xs text-muted-foreground">
          {entry.progress.message}
          {entry.progress.percent !== undefined && ` (${entry.progress.percent}%)`}
        </div>
      )}

      {!isActive && <ResultSummaryRow entry={entry} />}

      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {entry.stdout && entry.stdout.length > 0 && (
            <pre className={cn(
              "text-xs font-mono bg-muted rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap",
              "text-foreground max-h-40 overflow-y-auto",
            )}>
              {entry.stdout}
            </pre>
          )}
          {entry.stderr && entry.stderr.length > 0 && (
            <pre className={cn(
              "text-xs font-mono bg-muted rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap",
              "text-danger max-h-40 overflow-y-auto",
            )}>
              {entry.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ActivityLogPanel() {
  const { t } = useTranslation();
  const entries = useActivityStore((s) => s.entries);
  const clearLog = useActivityStore((s) => s.clearLog);
  const setActivityLogOpen = useUIStore((s) => s.setActivityLogOpen);

  return (
    <div className="h-[280px] border-t border-border bg-surface flex flex-col">
      <div className="flex items-center justify-between px-3 h-8 shrink-0 border-b border-border">
        <span className="text-xs font-semibold text-foreground">{t("activity.title")}</span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            onClick={clearLog}
            title={t("activity.clear")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            onClick={() => setActivityLogOpen(false)}
            title={t("common.cancel")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {t("activity.noActivity")}
          </div>
        ) : (
          entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
