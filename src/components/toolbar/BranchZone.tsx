import { useState, useRef } from "react";
import { GitBranch, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useBranches, useRecentBranches, useStatus, useWorktrees } from "@/api/queries";
import { switchBranch, createBranch, deleteBranch, renameBranch, stashPush, stashPop } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { useSelectionStore } from "@/stores/selection";
import { cn, getErrorMessage } from "@/lib/utils";
import { useClickOutside } from "./useToolbarDropdown";
import { BranchDropdown } from "./BranchDropdown";
import { CreateBranchDialog } from "@/components/branch/CreateBranchDialog";
import { SwitchBranchDialog } from "@/components/branch/SwitchBranchDialog";
import { DeleteBranchDialog } from "@/components/branch/DeleteBranchDialog";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { railFlowWidth } from "@/components/layout/RepoRail";

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
  const railMode = useUIStore((s) => s.railMode);
  const { worktreeByBranch } = useWorktreeContext(activeRepoPath, worktrees);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const headBranch = branches.find((b) => b.isHead);
  const currentBranch = headBranch?.name ?? null;
  const isSwitchingBranch = useUIStore((s) => s.isSwitchingBranch);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;
  const hasChanges = ahead > 0 || behind > 0;
  const isDirty = statusFiles.length > 0;

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["branches"] }),
      queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] }),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
      queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
      queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
    ]);

  // 브랜치가 바뀌면 이전 브랜치 기준의 파일·커밋 선택은 무효이므로 초기화한다.
  const clearBranchScopedSelection = () => {
    const { clearFileSelection, clearCommitSelection } = useSelectionStore.getState();
    clearFileSelection();
    clearCommitSelection();
  };

  const doSwitch = async (branchName: string) => {
    if (!activeRepoPath) return;
    const { setSwitchingBranch } = useUIStore.getState();
    setSwitchingBranch(true);
    try {
      await switchBranch(activeRepoPath, branchName);
      clearBranchScopedSelection();
      await invalidateAll();
      addToast(t("branch.switchedTo", { name: branchName }), "success");
    } finally {
      setSwitchingBranch(false);
    }
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
    const { setSwitchingBranch } = useUIStore.getState();
    setSwitchingBranch(true);
    try {
      if (isDirty) {
        await stashPush(activeRepoPath);
      }
      await createBranch(activeRepoPath, name, fromBranch);
      await switchBranch(activeRepoPath, name);
      if (isDirty) {
        await stashPop(activeRepoPath);
      }
      clearBranchScopedSelection();
      await invalidateAll();
      addToast(t("branch.createdAndSwitched", { name }), "success");
      setShowCreateDialog(false);
    } catch (err) {
      addToast(t("branch.failedToCreate", { error: getErrorMessage(err) }), "error");
    } finally {
      setSwitchingBranch(false);
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
    // 비교는 히스토리 탭의 비교 뷰에서 보이므로 그 탭으로 전환한다.
    useUIStore.getState().setCompareBranch(branchName);
    useUIStore.getState().setActiveTab("history");
    onClose();
  };

  const handleMerge = (branchName: string) => {
    // 머지 의도의 비교도 동일하게 히스토리 탭의 비교 뷰로 이동한다.
    useUIStore.getState().setCompareBranch(branchName);
    useUIStore.getState().setActiveTab("history");
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
          isOpen ? "relative z-50 bg-accent" : "hover:bg-accent",
        )}
      >
        {isSwitchingBranch ? (
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />
        ) : (
          <GitBranch className="w-4 h-4 shrink-0 opacity-50" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground leading-tight">{t("branch.current")}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate max-w-[200px]">
              {currentBranch ?? t("branch.noBranch")}
            </p>
            {hasChanges && (
              <div className="flex items-center gap-0.5">
                {ahead > 0 && (
                  <span className="inline-flex items-center gap-px text-[10px] font-semibold text-primary bg-primary/10 pl-1 pr-1.5 py-px rounded-full leading-tight tabular-nums">
                    <span className="opacity-70">{"↑"}</span>{ahead}
                  </span>
                )}
                {behind > 0 && (
                  <span className="inline-flex items-center gap-px text-[10px] font-semibold text-danger bg-danger/10 pl-1 pr-1.5 py-px rounded-full leading-tight tabular-nums">
                    <span className="opacity-70">{"↓"}</span>{behind}
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
            style={{ left: railFlowWidth(railMode) + sidebarWidth + 1, top: 52, bottom: 0, width: '28rem' }}
          >
            <BranchDropdown
              branches={branches}
              currentBranch={currentBranch}
              recentBranchNames={recentBranchNames}
              worktreeByBranch={worktreeByBranch}
              onSwitch={handleSwitch}
              onCreateBranch={() => setShowCreateDialog(true)}
              onOpenWorktree={openWorktree}
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
