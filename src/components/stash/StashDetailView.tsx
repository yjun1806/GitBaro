import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Plus, Minus } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useSelectionStore } from "@/stores/selection";
import { useStashShow, useCommitFileDiff, useStashMutations } from "@/api/queries";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import type { StashFileSummary } from "@/types";

interface StashDetailViewProps {
  stashIndex: number;
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
  isHighlighted,
  onClick,
  ref,
}: {
  file: StashFileSummary;
  isSelected: boolean;
  isHighlighted?: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        isSelected
          ? "bg-primary/10 text-primary"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-primary/30"
            : "hover:bg-accent"
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

export function StashDetailView({ stashIndex }: StashDetailViewProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);
  const selectStash = useSelectionStore((s) => s.selectStash);
  const { data: showResult, isLoading } = useStashShow(activeRepoPath, stashIndex);
  const mutations = useStashMutations(activeRepoPath);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const stashFiles = showResult?.files ?? [];
  const selectedFileIdx = stashFiles.findIndex((f) => f.path === selectedFilePath);

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: stashFiles,
    onSelect: (f) => setSelectedFilePath(f.path),
    selectedIndex: selectedFileIdx,
  });

  // Use commit file diff with stash commit ID
  const commitId = showResult?.entry.commitId ?? null;
  const { data: fileDiff } = useCommitFileDiff(
    activeRepoPath,
    commitId,
    selectedFilePath,
  );

  const handleApply = async () => {
    try {
      await mutations.apply.mutateAsync(stashIndex);
      addToast(t("stash.applied"), "success");
    } catch (err) {
      addToast(t("stash.failedToApply", { error: getErrorMessage(err) }), "error");
    }
  };

  const handlePop = async () => {
    try {
      await mutations.pop.mutateAsync();
      selectStash(null);
      addToast(t("stash.popped"), "success");
    } catch (err) {
      addToast(t("stash.failedToPop", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleDrop = async () => {
    try {
      await mutations.drop.mutateAsync(stashIndex);
      selectStash(null);
      addToast(t("stash.dropped"), "success");
    } catch (err) {
      addToast(t("stash.failedToDrop", { error: getErrorMessage(err) }), "error");
    }
  };

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
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleApply}
              className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors"
            >
              {t("stash.apply")}
            </button>
            <button
              onClick={handlePop}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
            >
              {t("stash.pop")}
            </button>
            <button
              onClick={handleDrop}
              className="px-3 py-1.5 text-xs rounded-md border border-danger/30 text-danger hover:bg-danger/10 transition-colors"
            >
              {t("stash.drop")}
            </button>
          </div>
        </div>
      </div>

      {/* Content: file list + diff */}
      <div className="flex-1 flex min-h-0">
        {/* File list panel */}
        <div className="w-[260px] shrink-0 border-r border-border overflow-y-auto" {...containerProps}>
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
            {t("stash.detail.files")} ({files.length})
          </div>
          {files.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              {t("stash.detail.noFiles")}
            </p>
          ) : (
            files.map((file, index) => (
              <FileSummaryRow
                key={file.path}
                ref={itemRef(index)}
                file={file}
                isSelected={selectedFilePath === file.path}
                isHighlighted={activeIndex === index}
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
