import { FileText, GitCommit } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useStatus, useFileDiff } from "@/api/queries";
import { DiffViewer } from "@/components/diff/DiffViewer";
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
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: diff, isLoading, isError } = useFileDiff(activeRepoPath, filePath, staged);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);

  const fileStatus: FileStatus =
    statusEntries.find((e) => e.path === filePath)?.status ?? "modified";

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading diff...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-danger">
        Failed to load diff
      </div>
    );
  }

  return <DiffViewer diff={diff ?? null} status={fileStatus} />;
}

function CommitDetailPlaceholder({ commitId }: { commitId: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
        <GitCommit className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-mono">{commitId.slice(0, 8)}</span>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center text-muted-foreground">
        <p className="text-sm">Commit details will render here</p>
      </div>
    </div>
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
              title="No file selected"
              description="Select a changed file to view its diff"
            />
          )
        ) : selectedCommitId ? (
          <CommitDetailPlaceholder commitId={selectedCommitId} />
        ) : (
          <EmptyState
            icon={GitCommit}
            title="No commit selected"
            description="Select a commit to view its details"
          />
        )}
      </div>
    </div>
  );
}
