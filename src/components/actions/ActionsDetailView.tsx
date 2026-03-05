import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Ban,
  SkipForward,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useWorkflowRunJobs, useWorkflowRuns } from "@/api/queries";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { WorkflowJob, JobStep } from "@/types";

interface ActionsDetailViewProps {
  runId: number;
}

function StepStatusIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  const size = "w-3.5 h-3.5 shrink-0";
  if (status === "in_progress") {
    return <Loader2 className={cn(size, "text-warning animate-spin")} />;
  }
  if (status === "queued" || status === "pending") {
    return <Clock className={cn(size, "text-muted-foreground")} />;
  }
  switch (conclusion) {
    case "success":
      return <CheckCircle className={cn(size, "text-success")} />;
    case "failure":
      return <XCircle className={cn(size, "text-danger")} />;
    case "cancelled":
      return <Ban className={cn(size, "text-muted-foreground")} />;
    case "skipped":
      return <SkipForward className={cn(size, "text-muted-foreground")} />;
    default:
      return <Clock className={cn(size, "text-muted-foreground")} />;
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const diffSec = Math.round((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m ${sec}s`;
}

function JobSection({ job }: { job: WorkflowJob }) {
  const [expanded, setExpanded] = useState(true);
  const duration = formatDuration(job.startedAt, job.completedAt);

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        )}
        <StepStatusIcon status={job.status} conclusion={job.conclusion} />
        <span className="text-xs font-medium flex-1 truncate">{job.name}</span>
        {duration && (
          <span className="text-[10px] text-muted-foreground shrink-0">{duration}</span>
        )}
      </button>
      {expanded && job.steps.length > 0 && (
        <div className="pl-10 pr-4 pb-2 space-y-0.5">
          {job.steps.map((step) => (
            <StepRow key={step.number} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: JobStep }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <StepStatusIcon status={step.status} conclusion={step.conclusion} />
      <span className="text-[11px] text-muted-foreground truncate">{step.name}</span>
    </div>
  );
}

export function ActionsDetailView({ runId }: ActionsDetailViewProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accountId = useAccountStore((s) => s.activeAccountId);

  const { data: runs = [] } = useWorkflowRuns(activeRepoPath, accountId);
  const run = runs.find((r) => r.id === runId);

  const { data: jobs = [], isLoading } = useWorkflowRunJobs(
    activeRepoPath,
    accountId,
    runId,
  );

  if (!run) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  const createdTimestamp = Math.floor(new Date(run.createdAt).getTime() / 1000);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{run.name}</p>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>{run.headBranch}</span>
              <span className="font-mono">{run.headSha.slice(0, 7)}</span>
              <span>{formatRelativeTime(createdTimestamp)}</span>
              <span>#{run.runNumber}</span>
            </div>
          </div>
          <button
            onClick={() => open(run.htmlUrl)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t("actions.viewOnGithub")}
          </button>
        </div>
      </div>

      {/* Jobs */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            {t("actions.noRuns")}
          </div>
        ) : (
          jobs.map((job) => <JobSection key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}
