import { useState, useRef } from "react";
import { GitBranch, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useBranches, useStatus, useWorktrees } from "@/api/queries";
import { switchBranch, createBranch, stashPush, stashPop, removeWorktree, addLocalRepository } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { useClickOutside } from "./useToolbarDropdown";
import { BranchDropdown } from "./BranchDropdown";
import { CreateBranchDialog } from "@/components/branch/CreateBranchDialog";
import { SwitchBranchDialog } from "@/components/branch/SwitchBranchDialog";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";

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
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(activeRepoPath);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

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

  const handleOpenWorktree = async (path: string) => {
    try {
      const repo = await addLocalRepository(path);
      useRepositoryStore.getState().addRepo(repo);
      useRepositoryStore.getState().setActiveRepo(repo.path);
    } catch (err) {
      addToast(t("repo.failedToAdd", { error: getErrorMessage(err) }), "error");
    }
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

  return (
    <div ref={zoneRef} className="relative shrink-0 flex items-center pl-2">
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-lg border transition-all",
          isOpen
            ? "border-primary/30 bg-primary/5 shadow-sm"
            : "border-transparent hover:border-border hover:bg-accent",
        )}
      >
        <GitBranch className={cn(
          "w-3.5 h-3.5 shrink-0",
          isOpen ? "text-primary" : "text-muted-foreground",
        )} />
        <span className="text-sm font-semibold truncate max-w-[200px]">
          {currentBranch ?? t("branch.noBranch")}
        </span>

        {/* Ahead / Behind pills */}
        {hasChanges && (
          <div className="flex items-center gap-0.5 ml-0.5">
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

        <ChevronDown className={cn(
          "w-3 h-3 text-muted-foreground shrink-0 transition-transform",
          isOpen && "rotate-180",
        )} />
      </button>

      {isOpen && (
        <BranchDropdown
          branches={branches}
          currentBranch={currentBranch}
          worktrees={worktrees}
          onSwitch={handleSwitch}
          onCreateBranch={() => setShowCreateDialog(true)}
          onCreateWorktree={() => setShowWorktreeDialog(true)}
          onOpenWorktree={handleOpenWorktree}
          onRemoveWorktree={handleRemoveWorktree}
          onClose={onClose}
        />
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
          onClose={() => setShowWorktreeDialog(false)}
        />
      )}
    </div>
  );
}
