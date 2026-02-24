import { useState } from "react";
import { FileText, GitCommit } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useStatus, useFileDiff, useCommitDetail, useCommitFileDiff, useCommitAvatars } from "@/api/queries";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { CommitDetail } from "@/components/history/CommitDetail";
import { ToolbarRoot } from "@/components/toolbar";
import type { FileStatus } from "@/types";

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

  return <DiffViewer diff={diff ?? null} status={fileStatus} />;
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
  activeTab: "changes" | "history";
  selectedFile: string | null;
  selectedFileStaged: boolean;
  selectedCommitId: string | null;
}

export function ContentArea({
  activeTab,
  selectedFile,
  selectedFileStaged,
  selectedCommitId,
}: ContentAreaProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      <ToolbarRoot />

      {/* Diff / Detail content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === "changes" ? (
          selectedFile ? (
            <DiffContent filePath={selectedFile} staged={selectedFileStaged} />
          ) : (
            <EmptyState
              icon={FileText}
              title={t("diff.noFileSelected")}
              description={t("diff.selectFile")}
            />
          )
        ) : selectedCommitId ? (
          <CommitDetailView commitId={selectedCommitId} />
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
