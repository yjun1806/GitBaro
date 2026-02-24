import { useState } from "react";
import {
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useBranches, useTokenValidation } from "@/api/queries";
import { gitFetch, gitPush, gitPull } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { SyncDropdown } from "./SyncDropdown";

interface SyncZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function SyncZone({ isOpen, onToggle, onClose }: SyncZoneProps) {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: tokenStatus, isLoading: isValidating } = useTokenValidation(activeAccountId, activeRepoPath);

  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [syncingAction, setSyncingAction] = useState<"fetch" | "push" | "pull" | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const isSyncing = syncingAction !== null;

  const headBranch = branches.find((b) => b.isHead);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;

  const canSync = tokenStatus?.valid === true && tokenStatus?.canPush === true;
  const syncDisabled = isSyncing || !activeAccountId || (!isValidating && !canSync);

  const syncError = (() => {
    if (!activeAccountId || isValidating || canSync) return null;
    if (!tokenStatus?.valid) {
      if (tokenStatus?.reason === "token_not_found") return { title: "Token missing", description: "Sign in again to continue" };
      if (tokenStatus?.reason === "network_error") return { title: "Network error", description: "Check your connection" };
      return { title: "Session expired", description: "Sign in again to sync" };
    }
    if (!tokenStatus?.canPush) {
      if (tokenStatus?.reason === "repo_not_found") return { title: "Repository not found", description: "No access to this repository" };
      return { title: "Read-only access", description: "No push permission for this repo" };
    }
    return null;
  })();

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["branches"] }),
      queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
      queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
    ]);

  const handleSync = async () => {
    if (!activeRepoPath || !activeAccountId || isSyncing) return;
    if (syncError) {
      addToast(`${syncError.title}: ${syncError.description}`, "error");
      return;
    }
    const action = behind > 0 ? "pull" : ahead > 0 ? "push" : "fetch";
    setSyncingAction(action);
    try {
      if (action === "pull") {
        await gitPull(activeRepoPath, activeAccountId);
        addToast("Pull completed successfully", "success");
      } else if (action === "push") {
        await gitPush(activeRepoPath, activeAccountId);
        addToast("Push completed successfully", "success");
      } else {
        await gitFetch(activeRepoPath, activeAccountId);
        addToast("Fetch completed", "success");
      }
      setLastFetchedAt(Math.floor(Date.now() / 1000));
      await invalidateAll();
    } catch (err) {
      const label = behind > 0 ? "Pull" : ahead > 0 ? "Push" : "Fetch";
      addToast(`${label} failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setSyncingAction(null);
    }
  };

  const handleFetch = async () => {
    if (!activeRepoPath || !activeAccountId || isSyncing) return;
    setSyncingAction("fetch");
    try {
      await gitFetch(activeRepoPath, activeAccountId);
      setLastFetchedAt(Math.floor(Date.now() / 1000));
      await invalidateAll();
      addToast("Fetch completed", "success");
    } catch (err) {
      addToast(`Fetch failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setSyncingAction(null);
    }
  };

  const handlePull = async (rebase = false) => {
    if (!activeRepoPath || !activeAccountId || isSyncing) return;
    setSyncingAction("pull");
    try {
      await gitPull(activeRepoPath, activeAccountId, rebase);
      setLastFetchedAt(Math.floor(Date.now() / 1000));
      await invalidateAll();
      addToast(rebase ? "Pull (rebase) completed" : "Pull completed successfully", "success");
    } catch (err) {
      addToast(`Pull failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setSyncingAction(null);
    }
  };

  const handlePush = async (force = false) => {
    if (!activeRepoPath || !activeAccountId || isSyncing) return;
    if (force) {
      addToast("Force pushing...", "info");
    }
    setSyncingAction("push");
    try {
      await gitPush(activeRepoPath, activeAccountId, force);
      await invalidateAll();
      addToast(force ? "Force push completed" : "Push completed successfully", "success");
    } catch (err) {
      addToast(`Push failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setSyncingAction(null);
    }
  };

  // State-driven visual
  const stateConfig = (() => {
    if (isSyncing) return {
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      label: syncingAction === "pull" ? "Pulling..." : syncingAction === "push" ? "Pushing..." : "Fetching...",
      accent: "text-primary",
      bg: "bg-primary/5 border-primary/20",
    };
    if (syncError) return {
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      label: syncError.title,
      accent: "text-danger",
      bg: "bg-danger/5 border-danger/20",
    };
    if (behind > 0) return {
      icon: <ArrowDown className="w-3.5 h-3.5" />,
      label: "Pull",
      accent: "text-primary",
      bg: "border-primary/20 hover:bg-primary/5",
    };
    if (ahead > 0) return {
      icon: <ArrowUp className="w-3.5 h-3.5" />,
      label: "Push",
      accent: "text-primary",
      bg: "border-primary/20 hover:bg-primary/5",
    };
    return {
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      label: "Fetch",
      accent: "text-muted-foreground",
      bg: "border-transparent hover:border-border hover:bg-accent",
    };
  })();

  const hasCount = !syncError && (ahead > 0 || behind > 0);

  return (
    <div className="relative flex items-center shrink-0 pr-2">
      {/* Split-button group */}
      <div className={cn(
        "flex items-center h-8 rounded-lg border transition-all",
        isOpen ? "border-primary/30 bg-primary/5 shadow-sm" : stateConfig.bg,
        syncDisabled && !syncError && "opacity-50",
      )}>
        {/* Main action */}
        <button
          onClick={handleSync}
          disabled={!syncError && syncDisabled}
          className={cn(
            "flex items-center gap-1.5 h-full pl-2.5 pr-2 rounded-l-lg transition-colors",
            !syncDisabled && !syncError && "hover:bg-accent",
            syncError && "cursor-pointer",
            stateConfig.accent,
          )}
        >
          {stateConfig.icon}
          <span className="text-[13px] font-semibold whitespace-nowrap">{stateConfig.label}</span>
          {hasCount && (
            <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 tabular-nums leading-none">
              {behind > 0 ? behind : ahead}
            </span>
          )}
        </button>

        {/* Divider + dropdown trigger */}
        <div className="w-px h-4 bg-border/60" />
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-7 h-full rounded-r-lg hover:bg-accent transition-colors"
        >
          <ChevronDown className={cn(
            "w-3 h-3 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )} />
        </button>
      </div>

      {isOpen && (
        <SyncDropdown
          ahead={ahead}
          behind={behind}
          lastFetchedAt={lastFetchedAt}
          disabled={syncDisabled}
          onFetch={handleFetch}
          onPull={handlePull}
          onPush={handlePush}
          onClose={onClose}
        />
      )}
    </div>
  );
}
