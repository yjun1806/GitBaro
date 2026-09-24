import { useState, useCallback, useMemo, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ChevronDown, ChevronRight, GitBranch, Loader2 } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useSelectionStore } from "@/stores/selection";
import { useMergeState, useStatus } from "@/api/queries";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import {
  createCommit,
  stageFiles,
  unstageFiles,
  openInEditor,
  discardChanges,
  revealInFinder,
  addToGitignore,
  findConflictMarkers,
} from "@/api/commands";
import { CommitErrorDialog } from "@/components/commit/CommitErrorDialog";
import { FileEntry } from "@/components/commit/FileEntry";
import { FileContextMenu } from "@/components/commit/FileContextMenu";
import { MergeConflictBanner } from "@/components/conflict/MergeConflictBanner";
import { useQueryClient } from "@tanstack/react-query";
import { cn, getErrorMessage } from "@/lib/utils";
import { groupFilesByDirectory } from "@/lib/group-files";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useToastStore } from "@/stores/toast";
import { Dialog } from "@/components/ui/Dialog";
import { useCommitDraftStore, EMPTY_COMMIT_DRAFT } from "@/stores/commit-draft";
import {
  entryPaths,
  isSelectedEntry,
  resolveFileSelection,
  stageableEntries,
} from "@/lib/file-selection";
import type { StatusEntry } from "@/types";
import { isComposerCollapsed } from "./composer-state";
import { isFreshCommitFocus } from "./useStartCommit";
import { useCommitTarget } from "./useCommitTarget";
import { useUIStore } from "@/stores/ui";

/** Confirmation text for discarding `entry`, matching what the backend will do. */
function discardMessageKey(entry: StatusEntry): string {
  if (!entry.staged) {
    // "added" on the unstaged side is an intent-to-add (`git add -N`) file,
    // which the backend moves to the Trash like an untracked one.
    return entry.status === "untracked" || entry.status === "added"
      ? "changes.discardUntrackedMessage"
      : "changes.discardUnstagedMessage";
  }
  return entry.status === "added" || entry.status === "copied"
    ? "changes.discardAddedMessage"
    : "changes.discardStagedMessage";
}

export function ChangesView() {
  const { t } = useTranslation();
  const discardTitleId = useId();
  const conflictStageTitleId = useId();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const currentBranch = useCurrentBranch();
  // 커밋 작성자는 동기화·merge와 같은 저장소 계정이다.
  const activeAccountId = useRepoAccountId();
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const { data: statusData } = useStatus(activeRepoPath);
  const statusEntries = useMemo(() => statusData ?? [], [statusData]);
  const { data: mergeState } = useMergeState(activeRepoPath);
  const target = useCommitTarget();
  const summaryRef = useRef<HTMLInputElement | null>(null);
  const commitFocusAt = useUIStore((s) => s.commitFocusAt);
  const setCommitFocusAt = useUIStore((s) => s.setCommitFocusAt);
  const collapsed = isComposerCollapsed(
    statusData ? statusData.length : null,
    mergeState !== undefined && mergeState !== null,
  );
  const queryClient = useQueryClient();

  const selectedFile = useSelectionStore((s) => s.selectedFile);
  const selectedFileStaged = useSelectionStore((s) => s.selectedFileStaged);
  const selectFile = useSelectionStore((s) => s.selectFile);
  const clearFileSelection = useSelectionStore((s) => s.clearFileSelection);
  const selection = useMemo(
    () => (selectedFile ? { path: selectedFile, staged: selectedFileStaged } : null),
    [selectedFile, selectedFileStaged],
  );

  const addToast = useToastStore((s) => s.addToast);

  // 스테이징·언스테이징으로 파일이 다른 섹션으로 옮겨 가면 선택도 따라가고,
  // 외부(CLI 등)에서 커밋되어 파일이 사라지면 선택을 초기화한다.
  useEffect(() => {
    if (!selection || !statusData) return;
    const next = resolveFileSelection(statusData, selection);
    if (!next) clearFileSelection();
    else if (next !== selection) selectFile(next.path, next.staged);
  }, [statusData, selection, selectFile, clearFileSelection]);

  // 커밋 메시지 초안은 저장소별로 보관한다(탭을 옮겨도 남고, 다른 저장소로 새지 않는다).
  const draft =
    useCommitDraftStore((s) => (activeRepoPath ? s.drafts[activeRepoPath] : undefined)) ??
    EMPTY_COMMIT_DRAFT;
  const setDraft = useCommitDraftStore((s) => s.setDraft);
  const clearDraft = useCommitDraftStore((s) => s.clearDraft);
  const commitSummary = draft.summary;
  const commitDescription = draft.description;
  const setCommitSummary = (summary: string) => {
    if (activeRepoPath) setDraft(activeRepoPath, { summary });
  };
  const setCommitDescription = (description: string) => {
    if (activeRepoPath) setDraft(activeRepoPath, { description });
  };

  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<StatusEntry | null>(null);
  const [conflictStageTarget, setConflictStageTarget] = useState<StatusEntry | null>(null);

  const handleConfirmDiscard = useCallback(async () => {
    if (!activeRepoPath || !discardTarget) return;
    const target = discardTarget;
    setDiscardTarget(null);
    try {
      await discardChanges(activeRepoPath, entryPaths([target]), target.staged);
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

  const applyToggleStage = useCallback(
    async (entry: StatusEntry) => {
      if (!activeRepoPath) return;
      try {
        if (entry.staged) await unstageFiles(activeRepoPath, entryPaths([entry]));
        else await stageFiles(activeRepoPath, entryPaths([entry]));
        await refreshStatus();
      } catch (err) {
        const key = entry.staged ? "commit.unstageFailed" : "commit.stageFailed";
        addToast(t(key, { error: getErrorMessage(err) }), "error");
      }
    },
    [activeRepoPath, refreshStatus, addToast, t],
  );

  // 충돌 파일을 스테이징하면 해결된 것으로 처리된다. 충돌 마커가 남아 있으면 먼저 확인한다.
  const handleToggleStage = useCallback(
    async (entry: StatusEntry) => {
      if (!activeRepoPath) return;
      if (!entry.staged && entry.status === "conflicted") {
        try {
          const marked = await findConflictMarkers(activeRepoPath, [entry.path]);
          if (marked.length > 0) {
            setConflictStageTarget(entry);
            return;
          }
        } catch (err) {
          addToast(t("commit.stageFailed", { error: getErrorMessage(err) }), "error");
          return;
        }
      }
      await applyToggleStage(entry);
    },
    [activeRepoPath, applyToggleStage, addToast, t],
  );

  const handleConfirmConflictStage = useCallback(async () => {
    if (!conflictStageTarget) return;
    const target = conflictStageTarget;
    setConflictStageTarget(null);
    await applyToggleStage(target);
  }, [conflictStageTarget, applyToggleStage]);

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
  const stageableUnstagedFiles = useMemo(() => stageableEntries(unstagedFiles), [unstagedFiles]);
  const conflictCount = useMemo(
    () => statusEntries.filter((e) => e.status === "conflicted").length,
    [statusEntries],
  );

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

  const selectedVisibleIdx = visibleFiles.findIndex((item) =>
    isSelectedEntry(item.entry, selection),
  );

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: visibleFiles,
    onSelect: (item) => selectFile(item.entry.path, item.entry.staged),
    selectedIndex: selectedVisibleIdx,
    enabled: statusEntries.length > 0,
  });

  const handleStageAll = async () => {
    // 충돌 파일은 제외한다 — 스테이징하면 충돌 마커가 든 채 해결된 것으로 처리된다.
    if (!activeRepoPath || stageableUnstagedFiles.length === 0) return;
    try {
      await stageFiles(activeRepoPath, entryPaths(stageableUnstagedFiles));
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
      await unstageFiles(activeRepoPath, entryPaths(stagedFiles));
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
    const repoPath = activeRepoPath;
    setIsCommitting(true);
    try {
      const message = commitDescription.trim()
        ? `${commitSummary.trim()}\n\n${commitDescription.trim()}`
        : commitSummary.trim();
      await createCommit(repoPath, message, false, activeAccountId);
      clearDraft(repoPath);
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

  // 「커밋하기」를 누르고 왔으면 요약 칸으로 포커스를 옮긴다(입력이 보일 때만).
  useEffect(() => {
    if (collapsed || !isFreshCommitFocus(commitFocusAt, Date.now())) return;
    summaryRef.current?.focus();
    setCommitFocusAt(null);
  }, [commitFocusAt, collapsed, setCommitFocusAt]);

  return (
    <div className="flex flex-col h-full">
      {/* Merge/rebase recovery banner (abort / continue) */}
      <MergeConflictBanner repoPath={activeRepoPath} conflictCount={conflictCount} />
      {collapsed ? (
        // 변경이 없으면 목록과 커밋 입력 대신 짧은 「변경 없음」만 둔다. 파일이 바뀌면 다시 나타난다.
        <div
          className="flex-1 flex flex-col items-center justify-center gap-1.5 px-4 text-center text-muted-foreground"
          data-testid="changes-empty"
        >
          <CheckCircle2 className="w-5 h-5 text-(--faint)" aria-hidden="true" />
          <p className="text-[12.5px] font-semibold text-(--fg2)">{t("changes.noChangesShort")}</p>
          <p className="text-[11.5px]">{t("changes.noChangesHint")}</p>
        </div>
      ) : (
      <>
      {/* File list */}
      <div className="flex-1 overflow-y-auto" {...containerProps}>
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
                  aria-label={t("changes.checkbox.unstageAll")}
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
                  {!isCollapsed && group.files.map((entry) => {
                    const navIdx = navIdxMap.get(`staged:${entry.path}`) ?? -1;
                    return (
                      <FileEntry
                        key={`${entry.path}-staged`}
                        ref={navIdx >= 0 ? itemRef(navIdx) : undefined}
                        entry={entry}
                        isSelected={isSelectedEntry(entry, selection)}
                        isHighlighted={activeIndex === navIdx && navIdx >= 0}
                        onClick={() => selectFile(entry.path, entry.staged)}
                        onDoubleClick={() => handleOpenInEditor(entry.path)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          selectFile(entry.path, entry.staged);
                          setFileMenu({ entry, x: e.clientX, y: e.clientY });
                        }}
                        onDiscard={() => setDiscardTarget(entry)}
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
                  disabled={stageableUnstagedFiles.length === 0}
                  aria-label={t("changes.checkbox.stageAll")}
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
                        isSelected={isSelectedEntry(entry, selection)}
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
                            : () => setDiscardTarget(entry)
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
        {/* 어느 브랜치·워크트리에 커밋하는지 늘 밝힌다. */}
        <p className="flex items-center gap-1 min-w-0 text-[11.5px] text-muted-foreground" data-testid="commit-target">
          <GitBranch className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {t("commit.target", {
              branch: target.branchText,
              worktree: target.worktreeText,
            })}
          </span>
        </p>
        <input
          ref={summaryRef}
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
      </>
      )}

      {discardTarget && (
        <Dialog
          onClose={() => setDiscardTarget(null)}
          closeOnBackdrop
          labelledBy={discardTitleId}
          className="w-[380px] max-w-[90vw] rounded-xl border border-border bg-card p-5 shadow-xl"
        >
            <h3 id={discardTitleId} className="text-sm font-semibold text-foreground">
              {t("changes.discardConfirmTitle")}
            </h3>
            <p className="mt-2 text-xs text-muted-foreground break-all">
              {t(discardMessageKey(discardTarget), { file: discardTarget.path })}
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
        </Dialog>
      )}

      {conflictStageTarget && (
        <Dialog
          onClose={() => setConflictStageTarget(null)}
          closeOnBackdrop
          labelledBy={conflictStageTitleId}
          className="w-[380px] max-w-[90vw] rounded-xl border border-border bg-card p-5 shadow-xl"
        >
          <h3 id={conflictStageTitleId} className="text-sm font-semibold text-foreground">
            {t("changes.conflictMarkersTitle")}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground break-all">
            {t("changes.conflictMarkersMessage", { file: conflictStageTarget.path })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setConflictStageTarget(null)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors"
            >
              {t("changes.cancel")}
            </button>
            <button
              onClick={handleConfirmConflictStage}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
            >
              {t("changes.conflictMarkersConfirm")}
            </button>
          </div>
        </Dialog>
      )}

      {/* 파일 우클릭 메뉴 */}
      {fileMenu && (
        <FileContextMenu
          staged={fileMenu.entry.staged}
          canDiscard={fileMenu.entry.status !== "conflicted"}
          position={{ x: fileMenu.x, y: fileMenu.y }}
          onToggleStage={() => handleToggleStage(fileMenu.entry)}
          onOpenEditor={() => handleOpenInEditor(fileMenu.entry.path)}
          onReveal={() => handleRevealFile(fileMenu.entry.path)}
          onCopyPath={() => navigator.clipboard.writeText(fileMenu.entry.path)}
          onAddToGitignore={() => handleAddToGitignore(fileMenu.entry.path)}
          onDiscard={() => setDiscardTarget(fileMenu.entry)}
          onClose={() => setFileMenu(null)}
        />
      )}
    </div>
  );
}
