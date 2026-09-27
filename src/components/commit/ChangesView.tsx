import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryView, useSetHistoryView } from "@/components/graph/useHistoryView";
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Count } from "@/components/ui/marks";
import { SectionLabel } from "@/components/ui/PanelHeader";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useSelectionStore } from "@/stores/selection";
import { useMergeState, useStatus } from "@/api/queries";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { createCommit, stageFiles, unstageFiles } from "@/api/commands";
import { CommitErrorDialog } from "@/components/commit/CommitErrorDialog";
import { FileEntry } from "@/components/commit/FileEntry";
import { MergeConflictBanner } from "@/components/conflict/MergeConflictBanner";
import { useQueryClient } from "@tanstack/react-query";
import { cn, getErrorMessage } from "@/lib/utils";
import { groupFilesByDirectory } from "@/lib/group-files";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useToastStore } from "@/stores/toast";
import { useCommitDraftStore, EMPTY_COMMIT_DRAFT } from "@/stores/commit-draft";
import {
  entryPaths,
  isSelectedEntry,
  resolveFileSelection,
  stageableEntries,
} from "@/lib/file-selection";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { canCommit, isComposerCollapsed } from "./composer-state";
import { isFreshWorkingFocus } from "./useOpenWorkingChanges";
import { RepoWorkSwitcher } from "./WorkSwitcher";
import { CommitComposer } from "./CommitComposer";
import { useCommitTarget } from "./useCommitTarget";
import { useUIStore } from "@/stores/ui";
import { useWorkingFileMenu } from "./useWorkingFileMenu";
import { useOpenFileInEditor } from "@/hooks/useOpenFileInEditor";

/**
 * 스테이징 목록과 커밋 입력. 체크아웃하지 않고 다른 브랜치를 보는 중에는 그리지 않고 안내를
 * 둔다 — 커밋 안 한 변경과 스테이징은 체크아웃한 작업 트리의 것이라, 보는 브랜치와 섞이면
 * 어느 브랜치에 커밋하는지 헷갈린다.
 */
export function ChangesView() {
  const { target } = useHistoryView();
  if (target !== null) return <ViewingComposerNote />;
  return <ChangesViewBody />;
}

function ViewingComposerNote() {
  const { t } = useTranslation();
  const setView = useSetHistoryView();
  return (
    <div className="flex flex-col h-full">
      <RepoWorkSwitcher mode="working" />
      <EmptyState
        title={t("historyView.composerHidden")}
        action={
          <Button size="sm" variant="secondary" onClick={() => setView(null)}>
            {t("historyView.backToCurrent")}
          </Button>
        }
      />
    </div>
  );
}

function ChangesViewBody() {
  const { t } = useTranslation();
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
  const workingFocusAt = useUIStore((s) => s.workingFocusAt);
  const setWorkingFocusAt = useUIStore((s) => s.setWorkingFocusAt);
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
  // 행 동작(스테이지·되돌리기·.gitignore)과 우클릭 메뉴·확인 창. 크게 보는 diff 옆 목록도 같은 것을 쓴다.
  const fileMenu = useWorkingFileMenu(activeRepoPath);

  const openFileInEditor = useOpenFileInEditor();
  const handleOpenInEditor = (entry: { path: string; status: string }) => {
    if (!activeRepoPath) return;
    openFileInEditor(activeRepoPath, entry.path, entry.status !== "deleted");
  };

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
    if (!activeRepoPath || !canCommit(commitSummary, stagedFiles.length, mergeState)) return;
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

  // 「작업 중인 변경」으로 왔으면 파일 목록으로 포커스를 옮긴다(목록이 보일 때만). 요약 칸이 아니다 —
  // 이동한 것뿐이고, 무엇을 커밋할지는 목록을 보고 고른다.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (collapsed || !isFreshWorkingFocus(workingFocusAt, Date.now())) return;
    listRef.current?.focus();
    setWorkingFocusAt(null);
  }, [workingFocusAt, collapsed, setWorkingFocusAt]);

  return (
    <div className="flex flex-col h-full">
      <RepoWorkSwitcher mode="working" />
      {/* Merge/rebase recovery banner (abort / continue) */}
      <MergeConflictBanner repoPath={activeRepoPath} conflictCount={conflictCount} />
      {collapsed ? (
        // 변경이 없으면 목록과 커밋 입력 대신 짧은 「변경 없음」만 둔다. 파일이 바뀌면 다시 나타난다.
        <div className="flex-1 flex flex-col min-h-0" data-testid="changes-empty">
          <EmptyState icon={CheckCircle2} title={t("changes.noChangesShort")} description={t("changes.noChangesHint")} />
        </div>
      ) : (
      <>
      {/* File list */}
      <div ref={listRef} data-testid="changes-file-list" className="flex-1 overflow-y-auto" {...containerProps}>
        {statusEntries.length === 0 ? (
          <div className="h-full flex flex-col">
            <EmptyState title={t("changes.noChanges")} />
          </div>
        ) : (
          <>
            {/* Staged Changes header */}
            {stagedFiles.length > 0 && (
              <div className="flex items-center gap-2 pl-3 h-8 sticky top-0 z-10 bg-(--acc-faint) border-b border-(--line)">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={true}
                  aria-label={t("changes.checkbox.unstageAll")}
                  onChange={handleUnstageAll}
                />
                <SectionLabel
                  title={t("commit.stagedChanges")}
                  trailing={<Count value={stagedFiles.length} tone="muted" />}
                  className="flex-1"
                />
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
                      className="flex items-center gap-1.5 pl-6 pr-3 h-7 border-b border-border/50 cursor-pointer select-none hover:bg-accent/50 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-[11.5px] font-medium text-muted-foreground flex-1 truncate">
                        {group.directory || t("changes.rootFiles")}
                      </span>
                      <Count value={group.files.length} tone="muted" />
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
                        onDoubleClick={() => handleOpenInEditor(entry)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          selectFile(entry.path, entry.staged);
                          fileMenu.openMenu(entry, contextMenuPoint(e));
                        }}
                        onDiscard={() => fileMenu.askDiscard(entry)}
                        onToggleStage={() => void fileMenu.toggleStage(entry)}
                      />
                    );
                  })}
                </div>
              );
            })}

            {/* Changes header */}
            {unstagedFiles.length > 0 && (
              <div className={cn(
                "flex items-center gap-2 pl-3 h-8 sticky z-10 bg-(--acc-faint) border-b border-(--line)",
                stagedFiles.length > 0 ? "top-8 border-t border-t-(--line)" : "top-0",
              )}>
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={false}
                  disabled={stageableUnstagedFiles.length === 0}
                  aria-label={t("changes.checkbox.stageAll")}
                  onChange={handleStageAll}
                />
                <SectionLabel
                  title={t("commit.unstaged")}
                  trailing={<Count value={unstagedFiles.length} tone="muted" />}
                  className="flex-1"
                />
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
                      className="flex items-center gap-1.5 pl-6 pr-3 h-7 border-b border-border/50 cursor-pointer select-none hover:bg-accent/50 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-[11.5px] font-medium text-muted-foreground flex-1 truncate">
                        {group.directory || t("changes.rootFiles")}
                      </span>
                      <Count value={group.files.length} tone="muted" />
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
                        onDoubleClick={() => handleOpenInEditor(entry)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          selectFile(entry.path, entry.staged);
                          fileMenu.openMenu(entry, contextMenuPoint(e));
                        }}
                        onDiscard={
                          entry.status === "conflicted"
                            ? undefined
                            : () => fileMenu.askDiscard(entry)
                        }
                        onToggleStage={() => void fileMenu.toggleStage(entry)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Commit composer: 한 줄 요약 + 「설명 추가」 + 「<브랜치>에 커밋」. */}
      <CommitComposer
        summary={commitSummary}
        description={commitDescription}
        onSummaryChange={setCommitSummary}
        onDescriptionChange={setCommitDescription}
        branchLabel={currentBranch ?? "HEAD"}
        targetTitle={[
          t("commit.target", { branch: target.branchText, worktree: target.worktreeText }),
          activeAccount
            ? t("commit.author", {
                name: activeAccount.email
                  ? `${activeAccount.username} <${activeAccount.email}>`
                  : activeAccount.username,
              })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        canCommit={canCommit(commitSummary, stagedFiles.length, mergeState)}
        isCommitting={isCommitting}
        onCommit={() => void handleCommit()}
      />
      {commitError && (
        <CommitErrorDialog
          message={commitError}
          onClose={() => setCommitError(null)}
        />
      )}
      </>
      )}

      {fileMenu.element}
    </div>
  );
}
