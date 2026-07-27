import { useState } from "react";
import { FileText, GitCommit, GitCompare, Archive, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";
import { useSelectionStore } from "@/stores/selection";
import { useStatus, useFileDiff, useCommitDetail, useCommitFileDiff, useCommitAvatars } from "@/api/queries";
import { useSessionData } from "@/hooks/useSessionData";
import { stopWorktreePreview } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/utils";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { CommitDetail } from "@/components/history/CommitDetail";
import { StashDetailView } from "@/components/stash/StashDetailView";
import { ActionsDetailView } from "@/components/actions/ActionsDetailView";
import { ToolbarRoot } from "@/components/toolbar";
import { PreviewBanner } from "@/components/worktree/PreviewBanner";
import { SessionReportView } from "@/components/report";
import type { FileStatus } from "@/types";
import type { ActiveTab } from "@/stores/ui";

/* --- Empty / Placeholder States --- */

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
      <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center">
        <Icon className="w-8 h-8" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs mt-1">{description}</p>
      </div>
    </div>
  );
}

function DiffContent({ filePath, staged }: { filePath: string; staged: boolean }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: diff, isLoading, isError } = useFileDiff(activeRepoPath, filePath, staged);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);

  const fileStatus: FileStatus =
    statusEntries.find((e) => e.path === filePath)?.status ?? "modified";

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("diff.loadingDiff")}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-danger">
        {t("diff.failedToLoad")}
      </div>
    );
  }

  return (
    <DiffViewer
      diff={diff ?? null}
      status={fileStatus}
      structural={activeRepoPath ? { repoPath: activeRepoPath, oid: null, staged } : null}
    />
  );
}

function CommitDetailView({ commitId }: { commitId: string }) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data, isLoading } = useCommitDetail(activeRepoPath, commitId);
  const { data: avatarMap } = useCommitAvatars(activeRepoPath);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const { data: fileDiff } = useCommitFileDiff(activeRepoPath, commitId, selectedFilePath);

  if (isLoading || !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("history.loadingHistory")}
      </div>
    );
  }

  // GitHub avatar > gravatar fallback
  const authorEmail = data.commit.author.email;
  const resolvedAvatarUrl = avatarMap?.[authorEmail] ?? data.commit.author.avatarUrl;

  return (
    <CommitDetail
      commit={data.commit}
      authorAvatarUrl={resolvedAvatarUrl}
      changedFiles={data.changedFiles.map((f) => ({ path: f.path, status: f.status }))}
      selectedFileDiff={fileDiff ?? null}
      onSelectFile={setSelectedFilePath}
    />
  );
}

/* --- ContentArea (main export) --- */

interface ContentAreaProps {
  activeTab: ActiveTab;
}

export function ContentArea({ activeTab }: ContentAreaProps) {
  const { t } = useTranslation();
  const compareBranch = useUIStore((s) => s.compareBranch);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const setPreviewBranch = useUIStore((s) => s.setPreviewBranch);
  const addToast = useToastStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const selectedFile = useSelectionStore((s) => s.selectedFile);
  const selectedFileStaged = useSelectionStore((s) => s.selectedFileStaged);
  const selectedCommitId = useSelectionStore((s) => s.selectedCommitId);
  const selectedStashIndex = useSelectionStore((s) => s.selectedStashIndex);
  const selectedRunId = useSelectionStore((s) => s.selectedRunId);
  const selectedSessionPath = useSelectionStore((s) => s.selectedSessionPath);

  // DECISION A — the one gate. Without a readable agent session log this repo
  // gets no verification UI at all, so a stale selection cannot open a report.
  const { hasSessions } = useSessionData(activeRepoPath);
  const canShowReport = activeTab === "history" && hasSessions;

  const handleStopPreview = async () => {
    if (!activeRepoPath) return;
    try {
      await stopWorktreePreview(activeRepoPath);
      setPreviewBranch(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
      addToast(t("preview.stopped"), "success");
    } catch (err) {
      addToast(t("preview.failedToStop", { error: getErrorMessage(err) }), "error");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <ToolbarRoot />
      <PreviewBanner onStopPreview={handleStopPreview} />

      {/* Diff / Detail content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === "actions" ? (
          selectedRunId !== null ? (
            <ActionsDetailView
              key={selectedRunId}
              runId={selectedRunId}
            />
          ) : (
            <EmptyState
              icon={Play}
              title={t("actions.selectRun")}
              description={t("actions.selectRun")}
            />
          )
        ) : activeTab === "stash" ? (
          selectedStashIndex !== null ? (
            <StashDetailView
              key={selectedStashIndex}
              stashIndex={selectedStashIndex}
            />
          ) : (
            <EmptyState
              icon={Archive}
              title={t("stash.noStashSelected")}
              description={t("stash.selectStash")}
            />
          )
        ) : activeTab === "changes" ? (
          selectedFile ? (
            <DiffContent filePath={selectedFile} staged={selectedFileStaged} />
          ) : (
            <div className="flex-1 min-h-0">
              <EmptyState
                icon={FileText}
                title={t("diff.noFileSelected")}
                description={t("diff.selectFile")}
              />
            </div>
          )
        ) : selectedCommitId ? (
          <CommitDetailView key={selectedCommitId} commitId={selectedCommitId} />
        ) : canShowReport && selectedSessionPath && activeRepoPath ? (
          /* One session, one narrative: what was asked, what was done, what it
             ran into, what it reaches, and where it drifted. */
          <SessionReportView
            key={selectedSessionPath}
            repoPath={activeRepoPath}
            sessionPath={selectedSessionPath}
          />
        ) : compareBranch ? (
          <EmptyState
            icon={GitCompare}
            title={t("diff.noCommitSelected")}
            description={t("compare.comparingWith", { branch: compareBranch })}
          />
        ) : (
          <EmptyState
            icon={GitCommit}
            title={t("diff.noCommitSelected")}
            description={t("diff.selectCommit")}
          />
        )}
      </div>
    </div>
  );
}
