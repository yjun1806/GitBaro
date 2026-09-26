import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useStashShow, useCommitFileDiff, useStashMutations } from "@/api/queries";
import { ListDiffSplit } from "@/components/layout/ListDiffSplit";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useFileMenu } from "@/components/commit/useFileMenu";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import type { FileStatus, StashFileSummary } from "@/types";
import { LoadingState } from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/Button";
import { Count, FileStatusLetter } from "@/components/ui/marks";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionLabel } from "@/components/ui/PanelHeader";

const FILE_STATUSES: readonly string[] = ["modified", "added", "deleted", "renamed", "copied", "untracked", "ignored", "conflicted"];

/** 스태시 요약의 상태 문자열. 모르는 값은 「수정」으로 본다. */
function toFileStatus(status: string): FileStatus {
  return FILE_STATUSES.includes(status) ? (status as FileStatus) : "modified";
}

interface StashDetailViewProps {
  stashIndex: number;
}

function FileSummaryRow({
  file,
  isSelected,
  isHighlighted,
  onClick,
  onContextMenu,
  ref,
}: {
  file: StashFileSummary;
  isSelected: boolean;
  isHighlighted?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={file.path}
      className={`w-full flex items-center gap-2 h-7 px-3 text-left transition-colors ${
        isSelected
          ? "bg-(--acc-sel)"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-inset ring-primary/30"
            : "hover:bg-accent"
      }`}
    >
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="text-[12.5px] truncate flex-1">
        {file.path.split("/").pop()}
      </span>
      <FileStatusLetter status={toFileStatus(file.status)} />
      {(file.insertions > 0 || file.deletions > 0) && (
        <span className="flex items-center gap-1.5 font-mono text-[11.5px] shrink-0">
          {file.insertions > 0 && <span className="text-diff-add-fg">+{file.insertions}</span>}
          {file.deletions > 0 && <span className="text-diff-del-fg">{"−"}{file.deletions}</span>}
        </span>
      )}
    </button>
  );
}

export function StashDetailView({ stashIndex }: StashDetailViewProps) {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);
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

  // 파일 우클릭: 그 파일을 고르고 파일 메뉴를 연다. 스태시의 파일은 작업 폴더에 없을 수도 있다.
  const fileMenu = useFileMenu();
  const openFileMenu = (path: string, e: React.MouseEvent) => {
    e.preventDefault();
    setSelectedFilePath(path);
    if (!activeRepoPath) return;
    const status = stashFiles.find((f) => f.path === path)?.status;
    fileMenu.open({ repoPath: activeRepoPath, filePath: path, exists: status !== "deleted" }, contextMenuPoint(e));
  };

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
      await mutations.pop.mutateAsync(stashIndex);
      addToast(t("stash.popped"), "success");
    } catch (err) {
      addToast(t("stash.failedToPop", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleDrop = async () => {
    try {
      await mutations.drop.mutateAsync(stashIndex);
      addToast(t("stash.dropped"), "success");
    } catch (err) {
      addToast(t("stash.failedToDrop", { error: getErrorMessage(err) }), "error");
    }
  };

  if (isLoading || !showResult) {
    return <LoadingState />;
  }

  const { entry, files } = showResult;
  const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col h-full animate-content-in">
      {/* Header */}
      <div className="px-4 py-3 border-b border-(--line) space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold truncate">{entry.message}</p>
            <div className="flex items-center gap-2 mt-1 text-[11.5px] text-muted-foreground">
              {entry.branchName && (
                <span>{t("stash.onBranch", { branch: entry.branchName })}</span>
              )}
              <span>{formatRelativeTime(entry.timestamp)}</span>
              <span>
                {files.length} {files.length === 1 ? "file" : "files"}
              </span>
              {totalInsertions > 0 && (
                <span className="font-mono text-diff-add-fg">+{totalInsertions}</span>
              )}
              {totalDeletions > 0 && (
                <span className="font-mono text-diff-del-fg">{"−"}{totalDeletions}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="secondary" onClick={handleApply}>
              {t("stash.apply")}
            </Button>
            <Button size="sm" variant="primary" onClick={handlePop}>
              {t("stash.pop")}
            </Button>
            <Button size="sm" variant="secondary" tone="danger" onClick={handleDrop}>
              {t("stash.drop")}
            </Button>
          </div>
        </div>
      </div>

      {/* Content: file list + diff */}
      <ListDiffSplit
        variant="inline"
        files={{
          items: files.map((f) => ({
            key: f.path,
            path: f.path,
            status: toFileStatus(f.status),
            additions: f.insertions,
            deletions: f.deletions,
          })),
          selectedKey: selectedFilePath,
          onSelect: setSelectedFilePath,
          onContextMenu: openFileMenu,
        }}
        list={
          <div className="flex-1 min-h-0 overflow-y-auto" {...containerProps}>
          <SectionLabel title={t("stash.detail.files")} trailing={<Count value={files.length} tone="muted" />} />
          {files.length === 0 ? (
            <EmptyState layout="row" title={t("stash.detail.noFiles")} />
          ) : (
            files.map((file, index) => (
              <FileSummaryRow
                key={file.path}
                ref={itemRef(index)}
                file={file}
                isSelected={selectedFilePath === file.path}
                isHighlighted={activeIndex === index}
                onClick={() => setSelectedFilePath(file.path)}
                onContextMenu={(e) => openFileMenu(file.path, e)}
              />
            ))
          )}
          </div>
        }
        detail={
          <>
          {selectedFilePath && fileDiff ? (
            <DiffViewer diff={fileDiff} status="modified" maximizable repoPath={activeRepoPath} />
          ) : (
            <EmptyState icon={FileText} title={t("stash.selectStash")} />
          )}
          </>
        }
      >
        {/* 메뉴는 목록 칸 밖에 둔다 — 크게 보는 동안 목록 칸은 숨겨져도 옆 목록에서 메뉴를 연다. */}
        {fileMenu.element}
      </ListDiffSplit>
    </div>
  );
}
