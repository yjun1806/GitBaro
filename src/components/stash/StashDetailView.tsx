import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Plus, Minus } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useStashShow, useCommitFileDiff } from "@/api/queries";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { formatRelativeTime } from "@/lib/utils";
import type { StashFileSummary } from "@/types";

interface StashDetailViewProps {
  stashIndex: number;
  onApply: (index: number) => void;
  onPop: (index: number) => void;
  onDrop: (index: number) => void;
}

function FileStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    added: "text-success bg-success/10",
    deleted: "text-danger bg-danger/10",
    modified: "text-warning bg-warning/10",
    renamed: "text-info bg-info/10",
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded ${colors[status] ?? "text-muted-foreground bg-muted"}`}
    >
      {status}
    </span>
  );
}

function FileSummaryRow({
  file,
  isSelected,
  onClick,
}: {
  file: StashFileSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent"
      }`}
    >
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs truncate flex-1">
        {file.path.split("/").pop()}
      </span>
      <FileStatusBadge status={file.status} />
      {(file.insertions > 0 || file.deletions > 0) && (
        <span className="flex items-center gap-1 text-[10px] shrink-0">
          {file.insertions > 0 && (
            <span className="flex items-center text-success">
              <Plus className="w-2.5 h-2.5" />
              {file.insertions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="flex items-center text-danger">
              <Minus className="w-2.5 h-2.5" />
              {file.deletions}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

export function StashDetailView({
  stashIndex,
  onApply,
  onPop,
  onDrop,
}: StashDetailViewProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: showResult, isLoading } = useStashShow(activeRepoPath, stashIndex);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  // Use commit file diff with stash commit ID
  const commitId = showResult?.entry.commitId ?? null;
  const { data: fileDiff } = useCommitFileDiff(
    activeRepoPath,
    commitId,
    selectedFilePath,
  );

  if (isLoading || !showResult) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  const { entry, files } = showResult;
  const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{entry.message}</p>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              {entry.branchName && (
                <span>{t("stash.onBranch", { branch: entry.branchName })}</span>
              )}
              <span>{formatRelativeTime(entry.timestamp)}</span>
              <span>
                {files.length} {files.length === 1 ? "file" : "files"}
              </span>
              {totalInsertions > 0 && (
                <span className="text-success">+{totalInsertions}</span>
              )}
              {totalDeletions > 0 && (
                <span className="text-danger">-{totalDeletions}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onApply(stashIndex)}
              className="px-2.5 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
            >
              {t("stash.apply")}
            </button>
            <button
              onClick={() => onPop(stashIndex)}
              className="px-2.5 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              {t("stash.pop")}
            </button>
            <button
              onClick={() => onDrop(stashIndex)}
              className="px-2.5 py-1.5 text-xs rounded-md text-danger hover:bg-danger/10 transition-colors"
            >
              {t("stash.drop")}
            </button>
          </div>
        </div>
      </div>

      {/* Content: file list + diff */}
      <div className="flex-1 flex min-h-0">
        {/* File list panel */}
        <div className="w-[260px] shrink-0 border-r border-border overflow-y-auto">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
            {t("stash.detail.files")} ({files.length})
          </div>
          {files.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              {t("stash.detail.noFiles")}
            </p>
          ) : (
            files.map((file) => (
              <FileSummaryRow
                key={file.path}
                file={file}
                isSelected={selectedFilePath === file.path}
                onClick={() => setSelectedFilePath(file.path)}
              />
            ))
          )}
        </div>

        {/* Diff viewer */}
        <div className="flex-1 overflow-hidden">
          {selectedFilePath && fileDiff ? (
            <DiffViewer diff={fileDiff} status="modified" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <FileText className="w-8 h-8" />
              <p className="text-xs">{t("stash.selectStash")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
