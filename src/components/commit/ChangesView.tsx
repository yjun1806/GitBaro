import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useBranchStore } from "@/stores/branch";
import { useAccountStore } from "@/stores/account";
import { useSelectionStore } from "@/stores/selection";
import { useStatus } from "@/api/queries";
import { createCommit, stageFiles, unstageFiles, openInEditor } from "@/api/commands";
import { CommitErrorDialog } from "@/components/commit/CommitErrorDialog";
import { FileEntry } from "@/components/commit/FileEntry";
import { useQueryClient } from "@tanstack/react-query";
import { cn, getErrorMessage } from "@/lib/utils";
import { groupFilesByDirectory } from "@/lib/group-files";
import { useToastStore } from "@/stores/toast";

export function ChangesView() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const currentBranch = useBranchStore((s) => s.currentBranch);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const queryClient = useQueryClient();

  const selectedFile = useSelectionStore((s) => s.selectedFile);
  const selectFile = useSelectionStore((s) => s.selectFile);
  const clearFileSelection = useSelectionStore((s) => s.clearFileSelection);

  const addToast = useToastStore((s) => s.addToast);

  // 외부(CLI 등)에서 커밋되어 파일이 사라지면 선택 초기화
  useEffect(() => {
    if (selectedFile && statusEntries.length >= 0) {
      const stillExists = statusEntries.some((e) => e.path === selectedFile);
      if (!stillExists) {
        clearFileSelection();
      }
    }
  }, [statusEntries, selectedFile, clearFileSelection]);

  const [commitSummary, setCommitSummary] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const handleOpenInEditor = async (filePath: string) => {
    if (!activeRepoPath) return;
    try {
      await openInEditor(activeRepoPath, filePath);
    } catch (err) {
      const msg = getErrorMessage(err);
      if (msg.includes("No default editor") || msg.includes("Unknown editor")) {
        addToast(t("settings.editorNotSet"), "warning");
      } else {
        addToast(t("error.generic"), "error");
      }
    }
  };

  const stagedFiles = statusEntries.filter((e) => e.staged);
  const unstagedFiles = statusEntries.filter((e) => !e.staged);

  const stagedGroups = useMemo(() => groupFilesByDirectory(stagedFiles), [stagedFiles]);
  const unstagedGroups = useMemo(() => groupFilesByDirectory(unstagedFiles), [unstagedFiles]);

  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const toggleDirCollapse = useCallback((key: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleStageAll = async () => {
    if (!activeRepoPath || unstagedFiles.length === 0) return;
    try {
      await stageFiles(activeRepoPath, unstagedFiles.map((e) => e.path));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      addToast(t("commit.stageFailed", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleUnstageAll = async () => {
    if (!activeRepoPath || stagedFiles.length === 0) return;
    try {
      await unstageFiles(activeRepoPath, stagedFiles.map((e) => e.path));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      addToast(t("commit.unstageFailed", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleCommit = async () => {
    if (!activeRepoPath || !commitSummary.trim() || stagedFiles.length === 0) return;
    setIsCommitting(true);
    try {
      const message = commitDescription.trim()
        ? `${commitSummary.trim()}\n\n${commitDescription.trim()}`
        : commitSummary.trim();
      await createCommit(activeRepoPath, message, false, activeAccountId);
      setCommitSummary("");
      setCommitDescription("");
      clearFileSelection();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      setCommitError(getErrorMessage(err));
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* File list */}
      <div className="flex-1 overflow-y-auto bg-background">
        {statusEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">{t("changes.noChanges")}</p>
          </div>
        ) : (
          <>
            {/* Staged Changes header */}
            {stagedFiles.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b border-border sticky top-0 z-10">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={true}
                  onChange={handleUnstageAll}
                />
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex-1">
                  {t("commit.stagedChanges")}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{stagedFiles.length}</span>
              </div>
            )}
            {/* Staged file entries (grouped by directory) */}
            {stagedGroups.map((group) => {
              const dirKey = `staged:${group.directory}`;
              const isCollapsed = collapsedDirs.has(dirKey);
              return (
                <div key={dirKey}>
                  {stagedGroups.length > 1 && (
                    <div
                      onClick={() => toggleDirCollapse(dirKey)}
                      className="flex items-center gap-1.5 pl-6 pr-3 py-1 border-b border-border/50 cursor-pointer select-none hover:bg-accent/50 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-[11px] font-medium text-muted-foreground flex-1 truncate">
                        {group.directory || t("changes.rootFiles")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">{group.files.length}</span>
                    </div>
                  )}
                  {!isCollapsed && group.files.map((entry) => (
                    <FileEntry
                      key={`${entry.path}-staged`}
                      entry={entry}
                      isSelected={selectedFile === entry.path}
                      onClick={() => selectFile(entry.path, entry.staged)}
                      onDoubleClick={() => handleOpenInEditor(entry.path)}
                      onToggleStage={async () => {
                        if (!activeRepoPath) return;
                        try {
                          await unstageFiles(activeRepoPath, [entry.path]);
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ["status"] }),
                            queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
                          ]);
                        } catch (err) {
                          addToast(t("commit.unstageFailed", { error: getErrorMessage(err) }), "error");
                        }
                      }}
                    />
                  ))}
                </div>
              );
            })}

            {/* Changes header */}
            {unstagedFiles.length > 0 && (
              <div className={cn(
                "flex items-center gap-2 px-3 py-2 bg-muted border-b border-border sticky z-10",
                stagedFiles.length > 0 ? "top-[33px] border-t border-t-border" : "top-0",
              )}>
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={false}
                  onChange={handleStageAll}
                />
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex-1">
                  {t("commit.unstaged")}
                </span>
                <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{unstagedFiles.length}</span>
              </div>
            )}
            {/* Unstaged file entries (grouped by directory) */}
            {unstagedGroups.map((group) => {
              const dirKey = `unstaged:${group.directory}`;
              const isCollapsed = collapsedDirs.has(dirKey);
              return (
                <div key={dirKey}>
                  {unstagedGroups.length > 1 && (
                    <div
                      onClick={() => toggleDirCollapse(dirKey)}
                      className="flex items-center gap-1.5 pl-6 pr-3 py-1 border-b border-border/50 cursor-pointer select-none hover:bg-accent/50 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-[11px] font-medium text-muted-foreground flex-1 truncate">
                        {group.directory || t("changes.rootFiles")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">{group.files.length}</span>
                    </div>
                  )}
                  {!isCollapsed && group.files.map((entry) => (
                    <FileEntry
                      key={`${entry.path}-unstaged`}
                      entry={entry}
                      isSelected={selectedFile === entry.path}
                      onClick={() => selectFile(entry.path, entry.staged)}
                      onDoubleClick={() => handleOpenInEditor(entry.path)}
                      onToggleStage={async () => {
                        if (!activeRepoPath) return;
                        try {
                          await stageFiles(activeRepoPath, [entry.path]);
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ["status"] }),
                            queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
                          ]);
                        } catch (err) {
                          addToast(t("commit.stageFailed", { error: getErrorMessage(err) }), "error");
                        }
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Commit panel */}
      <div className="border-t border-border p-3 flex flex-col gap-2">
        <input
          type="text"
          placeholder={t("commit.summary")}
          value={commitSummary}
          onChange={(e) => setCommitSummary(e.target.value)}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md border border-border",
            "bg-card outline-none",
            "focus:border-primary transition-colors",
          )}
        />
        <textarea
          placeholder={t("commit.description")}
          rows={3}
          value={commitDescription}
          onChange={(e) => setCommitDescription(e.target.value)}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md border border-border",
            "bg-card outline-none resize-none",
            "focus:border-primary transition-colors",
          )}
        />
        {activeAccount && (
          <div className="flex items-center gap-1.5 px-1">
            {activeAccount.avatarUrl ? (
              <img
                src={activeAccount.avatarUrl}
                alt={activeAccount.username}
                className="w-4 h-4 rounded-full shrink-0 object-cover"
              />
            ) : (
              <div className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[8px] font-bold shrink-0">
                {activeAccount.username[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <span className="text-xs text-muted-foreground truncate">
              {activeAccount.username}
              {activeAccount.email ? ` <${activeAccount.email}>` : ""}
            </span>
          </div>
        )}
        <button
          onClick={handleCommit}
          className={cn(
            "w-full py-2 rounded-md text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover transition-colors",
            (stagedFiles.length === 0 || !commitSummary.trim() || isCommitting) &&
              "opacity-50 cursor-not-allowed",
          )}
          disabled={stagedFiles.length === 0 || !commitSummary.trim() || isCommitting}
        >
          {isCommitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("commit.committing")}
            </span>
          ) : (
            t("commit.submit", { branch: currentBranch ?? "main" })
          )}
        </button>
        {commitError && (
          <CommitErrorDialog
            message={commitError}
            onClose={() => setCommitError(null)}
          />
        )}
      </div>
    </div>
  );
}
