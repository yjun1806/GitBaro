import { useState, useRef } from "react";
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import { GitBranch, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useBranches, useHeadDetached, useRecentBranches, useStatus, useWorktrees } from "@/api/queries";
import {
  switchBranch,
  createBranch,
  deleteBranch,
  renameBranch,
  stashPush,
  stashPopByOid,
} from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { useSelectionStore } from "@/stores/selection";
import { cn, getErrorMessage } from "@/lib/utils";
import { useClickOutside, useToolbarDropdownContext } from "./useToolbarDropdown";
import { ActionButton } from "./ActionButton";
import { BranchDropdown } from "./BranchDropdown";
import { CreateBranchDialog } from "@/components/branch/CreateBranchDialog";
import { SwitchBranchDialog } from "@/components/branch/SwitchBranchDialog";
import { DeleteBranchDialog } from "@/components/branch/DeleteBranchDialog";
import { RenameBranchDialog } from "@/components/branch/RenameBranchDialog";
import { selectionAfterStashPushed } from "@/lib/stash-selection";
import { runWithStashedChanges } from "./run-with-stashed-changes";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { mainColumnLeft } from "@/components/layout/sidebar-layout";

/**
 * 툴바 오른쪽 [브랜치 · Merge · Stash] 묶음의 「브랜치」 버튼. 브랜치 패널을 여는 연결은
 * 이 파일이 맡는다(W5-T3는 `useOpenBranchPanel`만 새 패널로 바꾼다).
 */
export function BranchPanelButton() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const onOpenBranchPanel = useOpenBranchPanel();
  return (
    <ActionButton
      action="branch"
      icon={GitBranch}
      label={t("gitActions.branch")}
      disabled={!activeRepoPath}
      caret
      onClick={onOpenBranchPanel}
    />
  );
}

/** 브랜치 패널을 연다. W5-T3의 브랜치 패널이 들어올 때까지는 왼쪽 브랜치 목록을 연다. */
function useOpenBranchPanel(): () => void {
  const { toggle } = useToolbarDropdownContext();
  return () => toggle("branch");
}

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
  const ownerRepoPath = useOwnerRepoPath();
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: isDetached = false } = useHeadDetached(activeRepoPath);
  const { data: recentBranchNames = [] } = useRecentBranches(activeRepoPath);
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(ownerRepoPath);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const sidebarWidth = useSidebarWidth();
  const railMode = useUIStore((s) => s.railMode);
  const { worktreeByBranch } = useWorktreeContext(activeRepoPath, worktrees);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<string | null>(null);

  const headBranch = branches.find((b) => b.isHead);
  const currentBranch = headBranch?.name ?? null;
  const isSwitchingBranch = useUIStore((s) => s.isSwitchingBranch);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;
  const hasChanges = ahead > 0 || behind > 0;
  const isDirty = statusFiles.length > 0;

  // Branch switches touch the working tree, the stash list and the reflog, so
  // everything derived from them is refetched — after failures too.
  const invalidateAll = () =>
    Promise.all(
      [
        "branches",
        "repoSyncStatus",
        "status",
        "commitHistory",
        "fileDiff",
        "stashList",
        "stashShow",
        "recentBranches",
        "worktrees",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );

  // 브랜치가 바뀌면 이전 브랜치 기준의 파일·커밋 선택은 무효이므로 초기화한다.
  const clearBranchScopedSelection = () => {
    const { clearFileSelection, clearCommitSelection } = useSelectionStore.getState();
    clearFileSelection();
    clearCommitSelection();
  };

  /**
   * Runs `action` with the changes (untracked files included) stashed and
   * pops that same stash afterwards — on success only when `popOnSuccess`.
   * Reports failures as toasts and returns true when the action succeeded.
   */
  const runStashed = async (
    repoPath: string,
    action: () => Promise<void>,
    options: { popOnSuccess: boolean; failureKey: "branch.failedToSwitch" | "branch.failedToCreate" },
  ): Promise<boolean> => {
    const outcome = await runWithStashedChanges({
      stash: () => stashPush(repoPath),
      restore: (oid) => stashPopByOid(repoPath, oid),
      action,
      popOnSuccess: options.popOnSuccess,
    });
    const leftInStash = outcome.status === "restoreFailed" || ("leftInStash" in outcome && outcome.leftInStash);
    if (leftInStash) {
      // The new entry is stash@{0}; keep the stash tab on the entry it showed.
      const { selectedStashIndex, selectStash } = useSelectionStore.getState();
      selectStash(selectionAfterStashPushed(selectedStashIndex));
    }
    switch (outcome.status) {
      case "done":
        return true;
      case "stashFailed":
        addToast(t("branch.failedToStash", { error: getErrorMessage(outcome.error) }), "error");
        return false;
      case "actionFailed": {
        const message = t(options.failureKey, { error: getErrorMessage(outcome.error) });
        addToast(
          outcome.leftInStash ? `${message} ${t("branch.changesKeptInStash")}` : message,
          "error",
        );
        return false;
      }
      case "restoreFailed":
        addToast(
          t("branch.changesRestoreFailed", { error: getErrorMessage(outcome.error) }),
          "warning",
        );
        return true;
    }
  };

  /**
   * "leave": stash the changes (they stay behind in the stash list) and
   * switch; if the switch fails, pop them back. "bring": git carries them over.
   */
  const switchTo = async (repoPath: string, branchName: string, mode: "leave" | "bring") => {
    const { setSwitchingBranch } = useUIStore.getState();
    setSwitchingBranch(true);
    try {
      let switched: boolean;
      if (mode === "leave") {
        switched = await runStashed(repoPath, () => switchBranch(repoPath, branchName), {
          popOnSuccess: false,
          failureKey: "branch.failedToSwitch",
        });
      } else {
        try {
          await switchBranch(repoPath, branchName);
          switched = true;
        } catch (err) {
          addToast(t("branch.failedToSwitch", { error: getErrorMessage(err) }), "error");
          switched = false;
        }
      }
      if (switched) {
        clearBranchScopedSelection();
        addToast(t("branch.switchedTo", { name: branchName }), "success");
      }
    } finally {
      await invalidateAll();
      setSwitchingBranch(false);
    }
  };

  const handleSwitch = async (branchName: string) => {
    if (!activeRepoPath || branchName === currentBranch) return;

    if (isDirty) {
      setPendingSwitch(branchName);
      return;
    }

    await switchTo(activeRepoPath, branchName, "bring");
  };

  const handleSwitchConfirm = async (action: "leave" | "bring") => {
    if (!activeRepoPath || !pendingSwitch) return;
    const target = pendingSwitch;
    setPendingSwitch(null);
    await switchTo(activeRepoPath, target, action);
  };

  const handleCreate = async (name: string, fromBranch: string) => {
    if (!activeRepoPath) return;
    const repoPath = activeRepoPath;
    const { setSwitchingBranch } = useUIStore.getState();
    setSwitchingBranch(true);
    try {
      const createAndSwitch = async () => {
        await createBranch(repoPath, name, fromBranch);
        await switchBranch(repoPath, name);
      };
      // A clean tree needs no stash round-trip.
      let created: boolean;
      if (isDirty) {
        created = await runStashed(repoPath, createAndSwitch, {
          popOnSuccess: true,
          failureKey: "branch.failedToCreate",
        });
      } else {
        try {
          await createAndSwitch();
          created = true;
        } catch (err) {
          addToast(t("branch.failedToCreate", { error: getErrorMessage(err) }), "error");
          created = false;
        }
      }
      if (created) {
        clearBranchScopedSelection();
        addToast(t("branch.createdAndSwitched", { name }), "success");
        setShowCreateDialog(false);
      }
    } finally {
      await invalidateAll();
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

  const handleRenameConfirm = async (oldName: string, newName: string) => {
    if (!activeRepoPath) return;
    try {
      await renameBranch(activeRepoPath, oldName, newName);
      addToast(t("branch.renamed", { old: oldName, new: newName }), "success");
      setPendingRename(null);
    } catch (err) {
      addToast(t("branch.failedToRename", { error: getErrorMessage(err) }), "error");
    } finally {
      await invalidateAll();
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
    <div
      ref={zoneRef}
      // 툴바가 좁으면 이 칸이 먼저 줄어든다(브랜치 이름은 말줄임). 오른쪽 git 작업·계정·설정이 잘리지 않게 한다.
      className={cn("relative w-[220px] min-w-[60px] shrink flex items-center", isOpen && "z-50")}
    >
      <button
        onClick={onToggle}
        title={currentBranch ?? undefined}
        className={cn(
          "flex items-center gap-2 px-4 w-full min-w-0 overflow-hidden h-[52px] border-r border-border transition-colors text-left",
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
              {currentBranch ?? (isDetached ? t("branch.detachedHead") : t("branch.noBranch"))}
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
            style={{ left: mainColumnLeft(railMode, sidebarWidth), top: 52, bottom: 0, width: '28rem' }}
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
              onRename={setPendingRename}
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

      {pendingSwitch && (
        <SwitchBranchDialog
          currentBranch={currentBranch ?? t("branch.detachedHead")}
          targetBranch={pendingSwitch}
          onConfirm={handleSwitchConfirm}
          onClose={() => setPendingSwitch(null)}
        />
      )}

      {pendingRename && (
        <RenameBranchDialog
          branchName={pendingRename}
          branches={branches}
          onRename={(newName) => handleRenameConfirm(pendingRename, newName)}
          onClose={() => setPendingRename(null)}
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
