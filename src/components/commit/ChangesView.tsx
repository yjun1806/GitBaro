import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useSelectionStore } from "@/stores/selection";
import { useCommitDraftStore } from "@/stores/commit-draft";
import { useFileReviewStates, useStatus } from "@/api/queries";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { createCommit, stageFiles, unstageFiles, openInEditor, discardChanges, revealInFinder, addToGitignore } from "@/api/commands";
import { CommitErrorDialog } from "@/components/commit/CommitErrorDialog";
import { FileEntry } from "@/components/commit/FileEntry";
import { FileContextMenu } from "@/components/commit/FileContextMenu";
import { MergeConflictBanner } from "@/components/conflict/MergeConflictBanner";
import { ReviewProgress } from "@/components/review";
import { TestEvidenceBadge } from "@/components/evidence";
import { WorkingTreeVerification } from "@/components/verify/WorkingTreeVerification";
import { useQueryClient } from "@tanstack/react-query";
import { cn, getErrorMessage } from "@/lib/utils";
import { groupFilesByDirectory } from "@/lib/group-files";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useToastStore } from "@/stores/toast";

export function ChangesView() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const currentBranch = useCurrentBranch();
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

  // Kept in a store so the verification panel in the content area can compare
  // the message being typed against the changed paths (V6 scope drift).
  const commitSummary = useCommitDraftStore((s) => s.summary);
  const commitDescription = useCommitDraftStore((s) => s.description);
  const setCommitSummary = useCommitDraftStore((s) => s.setSummary);
  const setCommitDescription = useCommitDraftStore((s) => s.setDescription);
  const resetCommitDraft = useCommitDraftStore((s) => s.reset);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);

  const handleConfirmDiscard = useCallback(async () => {
    if (!activeRepoPath || !discardTarget) return;
    const path = discardTarget;
    setDiscardTarget(null);
    try {
      await discardChanges(activeRepoPath, [path]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      addToast(t("changes.discardFailed", { error: getErrorMessage(err) }), "error");
    }
  }, [activeRepoPath, discardTarget, queryClient, addToast, t]);

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

  // 우클릭 메뉴 대상 파일 + 좌표
  const [fileMenu, setFileMenu] = useState<
    { entry: (typeof statusEntries)[number]; x: number; y: number } | null
  >(null);

  const refreshStatus = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]),
    [queryClient],
  );

  const handleToggleStage = useCallback(
    async (entry: (typeof statusEntries)[number]) => {
      if (!activeRepoPath) return;
      try {
        if (entry.staged) await unstageFiles(activeRepoPath, [entry.path]);
        else await stageFiles(activeRepoPath, [entry.path]);
        await refreshStatus();
      } catch (err) {
        const key = entry.staged ? "commit.unstageFailed" : "commit.stageFailed";
        addToast(t(key, { error: getErrorMessage(err) }), "error");
      }
    },
    [activeRepoPath, refreshStatus, addToast, t],
  );

  const handleRevealFile = useCallback(
    (path: string) => {
      if (!activeRepoPath) return;
      revealInFinder(`${activeRepoPath}/${path}`);
    },
    [activeRepoPath],
  );

  const handleAddToGitignore = useCallback(
    async (path: string) => {
      if (!activeRepoPath) return;
      try {
        await addToGitignore(activeRepoPath, path);
        await refreshStatus();
        addToast(t("changes.addedToGitignore", { path }), "success");
      } catch (err) {
        addToast(getErrorMessage(err), "error");
      }
    },
    [activeRepoPath, refreshStatus, addToast, t],
  );

  // Memoize the split so downstream group memos aren't invalidated by a new
  // array identity on every keystroke in the commit message inputs.
  const stagedFiles = useMemo(() => statusEntries.filter((e) => e.staged), [statusEntries]);
  const unstagedFiles = useMemo(
    () => statusEntries.filter((e) => !e.staged),
    [statusEntries],
  );
  const conflictCount = useMemo(
    () => statusEntries.filter((e) => e.status === "conflicted").length,
    [statusEntries],
  );

  const stagedGroups = useMemo(() => groupFilesByDirectory(stagedFiles), [stagedFiles]);
  const unstagedGroups = useMemo(() => groupFilesByDirectory(unstagedFiles), [unstagedFiles]);

  // V13 — how much of what is about to be committed has actually been read.
  const stagedPaths = useMemo(() => stagedFiles.map((e) => e.path), [stagedFiles]);
  const { data: stagedReviewStates = [] } = useFileReviewStates(
    activeRepoPath,
    stagedPaths,
    true,
  );

  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const toggleDirCollapse = useCallback((key: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Flat list of visible files for keyboard navigation
  const visibleFiles = useMemo(() => {
    const result: Array<{ entry: typeof statusEntries[number]; section: "staged" | "unstaged" }> = [];
    for (const group of stagedGroups) {
      const dirKey = `staged:${group.directory}`;
      if (!collapsedDirs.has(dirKey)) {
        for (const entry of group.files) {
          result.push({ entry, section: "staged" });
        }
      }
    }
    for (const group of unstagedGroups) {
      const dirKey = `unstaged:${group.directory}`;
      if (!collapsedDirs.has(dirKey)) {
        for (const entry of group.files) {
          result.push({ entry, section: "unstaged" });
        }
      }
    }
    return result;
  }, [stagedGroups, unstagedGroups, collapsedDirs]);

  // Map "section:path" -> nav index for O(1) lookup
  const navIdxMap = useMemo(() => {
    const map = new Map<string, number>();
    visibleFiles.forEach((item, i) => {
      map.set(`${item.section}:${item.entry.path}`, i);
    });
    return map;
  }, [visibleFiles]);

  const selectedVisibleIdx = visibleFiles.findIndex(
    (item) => item.entry.path === selectedFile,
  );

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: visibleFiles,
    onSelect: (item) => selectFile(item.entry.path, item.entry.staged),
    selectedIndex: selectedVisibleIdx,
    enabled: statusEntries.length > 0,
  });

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
      resetCommitDraft();
      clearFileSelection();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] }),
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
      {/* Merge/rebase recovery banner (abort / continue) */}
      <MergeConflictBanner repoPath={activeRepoPath} conflictCount={conflictCount} />
      {/* File list */}
      <div className="flex-1 overflow-y-auto bg-background" {...containerProps}>
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
                <ReviewProgress paths={stagedPaths} entries={stagedReviewStates} />
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
                  {!isCollapsed && group.files.map((entry) => {
                    const navIdx = navIdxMap.get(`staged:${entry.path}`) ?? -1;
                    return (
                      <FileEntry
                        key={`${entry.path}-staged`}
                        ref={navIdx >= 0 ? itemRef(navIdx) : undefined}
                        entry={entry}
                        isSelected={selectedFile === entry.path}
                        isHighlighted={activeIndex === navIdx && navIdx >= 0}
                        onClick={() => selectFile(entry.path, entry.staged)}
                        onDoubleClick={() => handleOpenInEditor(entry.path)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          selectFile(entry.path, entry.staged);
                          setFileMenu({ entry, x: e.clientX, y: e.clientY });
                        }}
                        onToggleStage={() => handleToggleStage(entry)}
                      />
                    );
                  })}
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
                  {!isCollapsed && group.files.map((entry) => {
                    const navIdx = navIdxMap.get(`unstaged:${entry.path}`) ?? -1;
                    return (
                      <FileEntry
                        key={`${entry.path}-unstaged`}
                        ref={navIdx >= 0 ? itemRef(navIdx) : undefined}
                        entry={entry}
                        isSelected={selectedFile === entry.path}
                        isHighlighted={activeIndex === navIdx && navIdx >= 0}
                        onClick={() => selectFile(entry.path, entry.staged)}
                        onDoubleClick={() => handleOpenInEditor(entry.path)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          selectFile(entry.path, entry.staged);
                          setFileMenu({ entry, x: e.clientX, y: e.clientY });
                        }}
                        onDiscard={
                          entry.status === "conflicted"
                            ? undefined
                            : () => setDiscardTarget(entry.path)
                        }
                        onToggleStage={() => handleToggleStage(entry)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Commit panel */}
      <div className="border-t border-border p-3 flex flex-col gap-2">
        {/* Two lines of "what is known about this change" directly above the
            commit button: what the rules found, then whether tests were run. */}
        <WorkingTreeVerification
          repoPath={activeRepoPath}
          staged
          draftMessage={commitSummary || null}
          onNavigate={(file) => selectFile(file, true)}
          className="overflow-hidden rounded-md border border-border bg-surface"
        />
        <TestEvidenceBadge repoPath={activeRepoPath} />
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
            t("commit.submit", { branch: currentBranch ?? "HEAD" })
          )}
        </button>
        {commitError && (
          <CommitErrorDialog
            message={commitError}
            onClose={() => setCommitError(null)}
          />
        )}
      </div>

      {discardTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDiscardTarget(null)}
        >
          <div
            className="w-[380px] max-w-[90vw] rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {t("changes.discardConfirmTitle")}
            </h3>
            <p className="mt-2 text-xs text-muted-foreground break-all">
              {t("changes.discardConfirmMessage", { file: discardTarget })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDiscardTarget(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors"
              >
                {t("changes.cancel")}
              </button>
              <button
                onClick={handleConfirmDiscard}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                {t("changes.discardConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 파일 우클릭 메뉴 */}
      {fileMenu && (
        <FileContextMenu
          staged={fileMenu.entry.staged}
          canDiscard={!fileMenu.entry.staged && fileMenu.entry.status !== "conflicted"}
          position={{ x: fileMenu.x, y: fileMenu.y }}
          onToggleStage={() => handleToggleStage(fileMenu.entry)}
          onOpenEditor={() => handleOpenInEditor(fileMenu.entry.path)}
          onReveal={() => handleRevealFile(fileMenu.entry.path)}
          onCopyPath={() => navigator.clipboard.writeText(fileMenu.entry.path)}
          onAddToGitignore={() => handleAddToGitignore(fileMenu.entry.path)}
          onDiscard={() => setDiscardTarget(fileMenu.entry.path)}
          onClose={() => setFileMenu(null)}
        />
      )}
    </div>
  );
}
