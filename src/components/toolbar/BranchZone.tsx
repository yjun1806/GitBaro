import { useState, useRef, useEffect } from "react";
import { GitBranch, ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useBranches, useRecentBranches, useStatus, useWorktrees } from "@/api/queries";
import { switchBranch, createBranch, deleteBranch, renameBranch, stashPush, stashPop, removeWorktree, stopWorktreePreview, checkPreviewActive } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { useClickOutside } from "./useToolbarDropdown";
import { BranchDropdown } from "./BranchDropdown";
import { CreateBranchDialog } from "@/components/branch/CreateBranchDialog";
import { SwitchBranchDialog } from "@/components/branch/SwitchBranchDialog";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import { DeleteBranchDialog } from "@/components/branch/DeleteBranchDialog";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";

interface BranchZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function BranchZone({ isOpen, onToggle, onClose }: BranchZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  useClickOutside(zoneRef, onClose, isOpen);
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: recentBranchNames = [] } = useRecentBranches(activeRepoPath);
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(activeRepoPath);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const previewBranch = useUIStore((s) => s.previewBranch);
  const { isInWorktree, mainWorktree, worktreeByBranch } = useWorktreeContext(activeRepoPath, worktrees);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // 마운트 시 잔여 미리보기 정리
  useEffect(() => {
    if (!activeRepoPath) return;
    checkPreviewActive(activeRepoPath).then((active) => {
      if (active && !previewBranch) {
        stopWorktreePreview(activeRepoPath).then(() => invalidateAll()).catch(() => {});
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPath]);

  const headBranch = branches.find((b) => b.isHead);
  const currentBranch = headBranch?.name ?? null;
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;
  const hasChanges = ahead > 0 || behind > 0;
  const isDirty = statusFiles.length > 0;

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["branches"] }),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
      queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
      queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
    ]);

  const doSwitch = async (branchName: string) => {
    if (!activeRepoPath) return;
    await switchBranch(activeRepoPath, branchName);
    await invalidateAll();
    addToast(t("branch.switchedTo", { name: branchName }), "success");
  };

  const handleSwitch = async (branchName: string) => {
    if (!activeRepoPath || branchName === currentBranch) return;

    if (isDirty) {
      setPendingSwitch(branchName);
      return;
    }

    try {
      await doSwitch(branchName);
    } catch (err) {
      addToast(t("branch.failedToSwitch", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleSwitchConfirm = async (action: "leave" | "bring") => {
    if (!activeRepoPath || !pendingSwitch) return;
    setPendingSwitch(null);

    try {
      if (action === "leave") {
        await stashPush(activeRepoPath);
      }
      await doSwitch(pendingSwitch);
    } catch (err) {
      // stash 후 switch 실패 시 stash 복원 시도
      if (action === "leave") {
        try { await stashPop(activeRepoPath); } catch { /* ignore */ }
      }
      addToast(t("branch.failedToSwitch", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleCreate = async (name: string, fromBranch: string) => {
    if (!activeRepoPath) return;
    try {
      if (isDirty) {
        await stashPush(activeRepoPath);
      }
      await createBranch(activeRepoPath, name, fromBranch);
      await switchBranch(activeRepoPath, name);
      if (isDirty) {
        await stashPop(activeRepoPath);
      }
      await invalidateAll();
      addToast(t("branch.createdAndSwitched", { name }), "success");
      setShowCreateDialog(false);
    } catch (err) {
      addToast(t("branch.failedToCreate", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleOpenWorktree = (path: string) => {
    const parentPath = mainWorktree?.path ?? activeRepoPath ?? path;
    useRepositoryStore.getState().setActiveRepo(path, parentPath);
  };

  const handleRemoveWorktree = async (path: string) => {
    if (!activeRepoPath) return;
    try {
      await removeWorktree(activeRepoPath, path);
      await queryClient.invalidateQueries({ queryKey: ["worktrees"] });
      addToast(t("worktree.removed", { path: path.split("/").pop() }), "success");
    } catch (err) {
      addToast(t("worktree.failedToRemove", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleDelete = (branchName: string) => {
    setPendingDelete(branchName);
  };

  const handleDeleteConfirm = async () => {
    if (!activeRepoPath || !pendingDelete) return;
    const name = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteBranch(activeRepoPath, name);
      await invalidateAll();
      addToast(t("branch.deleted", { name }), "success");
    } catch (err) {
      addToast(t("branch.failedToDelete", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleRename = async (branchName: string) => {
    const newName = window.prompt(t("branch.contextMenu.rename"), branchName);
    if (!newName || newName === branchName || !activeRepoPath) return;
    try {
      await renameBranch(activeRepoPath, branchName, newName);
      await invalidateAll();
      addToast(t("branch.renamed", { old: branchName, new: newName }), "success");
    } catch (err) {
      addToast(t("branch.failedToRename", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleCompare = (branchName: string) => {
    // Navigate to compare view — delegate to branch store
    useUIStore.getState().setCompareBranch(branchName);
    onClose();
  };

  const handleMerge = (branchName: string) => {
    // Navigate to compare view with merge intent
    useUIStore.getState().setCompareBranch(branchName);
    onClose();
  };

  const handleCopyName = (branchName: string) => {
    navigator.clipboard.writeText(branchName);
    addToast(t("branch.copiedName"), "success");
  };

  return (
    <div ref={zoneRef} className={cn("relative shrink-0 flex items-center", isOpen && "z-50")}>
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-2 px-4 w-[220px] h-[52px] border-r border-border transition-colors text-left",
          isOpen ? "relative z-50 bg-surface" : "hover:bg-accent",
          isOpen ? "bg-accent" : "hover:bg-accent",
        )}
      >
        <GitBranch className="w-4 h-4 shrink-0 opacity-50" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground leading-tight">{t("branch.current")}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate max-w-[200px]">
              {currentBranch ?? t("branch.noBranch")}
            </p>
            {isInWorktree && (
              <span className="text-[10px] font-semibold text-info bg-info/10 px-1.5 py-0.5 rounded shrink-0">
                {t("branch.worktreeAbbrev")}
              </span>
            )}
            {hasChanges && (
              <div className="flex items-center gap-0.5">
                {ahead > 0 && (
                  <span className="inline-flex items-center gap-px text-[10px] font-semibold text-primary bg-primary/10 pl-1 pr-1.5 py-px rounded-full leading-tight tabular-nums">
                    <span className="opacity-70">{"\u2191"}</span>{ahead}
                  </span>
                )}
                {behind > 0 && (
                  <span className="inline-flex items-center gap-px text-[10px] font-semibold text-danger bg-danger/10 pl-1 pr-1.5 py-px rounded-full leading-tight tabular-nums">
                    <span className="opacity-70">{"\u2193"}</span>{behind}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {isInWorktree && mainWorktree && (
        <button
          onClick={() => handleOpenWorktree(mainWorktree.path)}
          className="flex items-center gap-1 h-[52px] px-3 border-r border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title={t("worktree.returnToMain")}
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{t("branch.mainLabel")}</span>
        </button>
      )}

      {isOpen && (
        <>
          {/* Backdrop — 전체 화면 (사이드바 포함) */}
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={onClose}
          />
          {/* Full-height panel — 사이드바 오른쪽, 툴바 아래부터 하단까지 */}
          <div
            className="fixed z-50 flex flex-col bg-popover border-r border-border shadow-2xl"
            style={{ left: sidebarWidth + 1, top: 52, bottom: 0, width: '28rem' }}
          >
            <BranchDropdown
              branches={branches}
              currentBranch={currentBranch}
              recentBranchNames={recentBranchNames}
              worktrees={worktrees}
              worktreeByBranch={worktreeByBranch}
              onSwitch={handleSwitch}
              onCreateBranch={() => setShowCreateDialog(true)}
              onCreateWorktree={() => setShowWorktreeDialog(true)}
              onOpenWorktree={handleOpenWorktree}
              onRemoveWorktree={handleRemoveWorktree}
              onDelete={handleDelete}
              onRename={handleRename}
              onCompare={handleCompare}
              onMerge={handleMerge}
              onCopyName={handleCopyName}
              onClose={onClose}
            />
          </div>
        </>
      )}

      {showCreateDialog && (
        <CreateBranchDialog
          branches={branches}
          currentBranch={currentBranch}
          onCreate={handleCreate}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {pendingSwitch && currentBranch && (
        <SwitchBranchDialog
          currentBranch={currentBranch}
          targetBranch={pendingSwitch}
          onConfirm={handleSwitchConfirm}
          onClose={() => setPendingSwitch(null)}
        />
      )}

      {showWorktreeDialog && (
        <CreateWorktreeDialog
          repoPath={activeRepoPath!}
          branches={branches}
          worktrees={worktrees}
          onClose={() => setShowWorktreeDialog(false)}
        />
      )}

      {pendingDelete && (
        <DeleteBranchDialog
          branchName={pendingDelete}
          isFullyMerged={branches.find((b) => b.name === pendingDelete)?.isFullyMerged ?? false}
          onConfirm={handleDeleteConfirm}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
