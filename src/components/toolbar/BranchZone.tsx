import { useState } from "react";
import { GitBranch, ChevronDown } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useBranches } from "@/api/queries";
import { switchBranch, createBranch } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { BranchDropdown } from "./BranchDropdown";
import { CreateBranchDialog } from "@/components/branch/CreateBranchDialog";

interface BranchZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function BranchZone({ isOpen, onToggle, onClose }: BranchZoneProps) {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const headBranch = branches.find((b) => b.isHead);
  const currentBranch = headBranch?.name ?? null;
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;
  const hasChanges = ahead > 0 || behind > 0;

  const handleSwitch = async (branchName: string) => {
    if (!activeRepoPath || branchName === currentBranch) return;
    try {
      await switchBranch(activeRepoPath, branchName);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
      addToast(`Switched to ${branchName}`, "success");
    } catch (err) {
      addToast(`Failed to switch branch: ${getErrorMessage(err)}`, "error");
    }
  };

  const handleCreate = async (name: string, fromBranch: string) => {
    if (!activeRepoPath) return;
    try {
      await createBranch(activeRepoPath, name, fromBranch);
      await switchBranch(activeRepoPath, name);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
      ]);
      addToast(`Created and switched to ${name}`, "success");
      setShowCreateDialog(false);
    } catch (err) {
      addToast(`Failed to create branch: ${getErrorMessage(err)}`, "error");
    }
  };

  return (
    <div className="relative shrink-0 flex items-center pl-2">
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
        <span className="text-[13px] font-semibold truncate max-w-[200px]">
          {currentBranch ?? "No branch"}
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
          onSwitch={handleSwitch}
          onCreateBranch={() => setShowCreateDialog(true)}
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
    </div>
  );
}
