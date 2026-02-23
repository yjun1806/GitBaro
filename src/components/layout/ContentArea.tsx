import { useState, useRef, useEffect } from "react";
import {
  FileText,
  GitCommit,
  GitBranch,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Check,
} from "lucide-react";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useBranches, useStatus, useFileDiff } from "@/api/queries";
import { gitFetch, gitPush, gitPull } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { useToastStore } from "@/stores/toast";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { DeviceFlowDialog } from "@/components/account/DeviceFlowDialog";
import { DiffViewer } from "@/components/diff/DiffViewer";
import type { FileStatus } from "@/types";

/* ─── Branch Dropdown ─── */

function BranchDropdown({
  branches,
  currentBranch,
  onClose,
}: {
  branches: { name: string; isHead: boolean }[];
  currentBranch: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-lg z-50 py-1 max-h-80 overflow-y-auto"
    >
      {branches.length === 0 ? (
        <p className="text-sm text-muted text-center py-3">No branches</p>
      ) : (
        branches.map((branch) => (
          <button
            key={branch.name}
            onClick={() => onClose()}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
          >
            <GitBranch className="w-3.5 h-3.5 text-muted shrink-0" />
            <span className="text-sm truncate flex-1">{branch.name}</span>
            {branch.name === currentBranch && (
              <Check className="w-4 h-4 text-primary shrink-0" />
            )}
          </button>
        ))
      )}
    </div>
  );
}

/* ─── Account Dropdown ─── */

function AccountDropdown({
  onClose,
  onSignIn,
}: {
  onClose: () => void;
  onSignIn: () => void;
}) {
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-lg z-50 py-1"
    >
      {accounts.length === 0 ? (
        <div className="px-3 py-2">
          <p className="text-sm text-muted">No accounts linked</p>
          <button
            onClick={() => {
              onClose();
              onSignIn();
            }}
            className="mt-2 w-full py-1.5 rounded-md text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            Sign in to GitHub
          </button>
        </div>
      ) : (
        <>
          {accounts.map((account) => (
            <button
              key={account.id}
              onClick={() => {
                setActiveAccount(account.id);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
            >
              <AccountAvatar account={account} size="sm" />
              <span className="text-sm truncate flex-1">{account.username}</span>
              {account.id === activeAccountId && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </button>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <button
              onClick={() => {
                onClose();
                onSignIn();
              }}
              className="w-full px-3 py-2 text-sm text-muted hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
            >
              Add another account
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Fetch Dropdown ─── */

function FetchDropdown({
  onFetch,
  onClose,
}: {
  onFetch: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-lg z-50 py-1"
    >
      <button
        onClick={() => {
          onFetch();
          onClose();
        }}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
      >
        <RefreshCw className="w-4 h-4 text-muted shrink-0" />
        <div>
          <p className="text-sm font-medium">Fetch origin</p>
          <p className="text-xs text-muted">Fetch the latest changes from origin</p>
        </div>
      </button>
    </div>
  );
}

/* ─── Right Panel Header ─── */

function RightPanelHeader() {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);

  const { data: branches = [] } = useBranches(activeRepoPath);

  const headBranch = branches.find((b) => b.isHead);
  const currentBranch = headBranch?.name ?? null;
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;

  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [fetchDropdownOpen, setFetchDropdownOpen] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const currentAccount = accounts.find((a) => a.id === activeAccountId);

  const handleSync = async () => {
    if (!activeRepoPath || !activeAccountId || isSyncing) return;
    setIsSyncing(true);
    try {
      if (behind > 0) {
        await gitPull(activeRepoPath, activeAccountId);
        addToast("Pull completed successfully", "success");
      } else if (ahead > 0) {
        await gitPush(activeRepoPath, activeAccountId);
        addToast("Push completed successfully", "success");
      } else {
        await gitFetch(activeRepoPath, activeAccountId);
        addToast("Fetch completed", "success");
      }
      setLastFetchedAt(Math.floor(Date.now() / 1000));
      await queryClient.invalidateQueries({ queryKey: ["branches"] });
    } catch (err) {
      const action = behind > 0 ? "Pull" : ahead > 0 ? "Push" : "Fetch";
      addToast(`${action} failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFetch = async () => {
    if (!activeRepoPath || !activeAccountId || isSyncing) return;
    setIsSyncing(true);
    try {
      await gitFetch(activeRepoPath, activeAccountId);
      setLastFetchedAt(Math.floor(Date.now() / 1000));
      await queryClient.invalidateQueries({ queryKey: ["branches"] });
      addToast("Fetch completed", "success");
    } catch (err) {
      addToast(`Fetch failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      className="flex items-center h-[52px] border-b border-border bg-surface select-none"
      data-tauri-drag-region
    >
      {/* Branch selector */}
      <div className="relative flex-1 min-w-0">
        <button
          onClick={() => {
            setBranchDropdownOpen((v) => !v);
            setAccountDropdownOpen(false);
          }}
          className="flex items-center gap-2 px-4 h-[52px] w-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
        >
          <GitBranch className="w-4 h-4 shrink-0 opacity-50" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-muted leading-tight">Current Branch</p>
            <p className="text-sm font-semibold truncate">
              {currentBranch ?? "No branch"}
            </p>
          </div>
          {branchDropdownOpen ? (
            <ChevronUp className="w-4 h-4 text-muted shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted shrink-0" />
          )}
        </button>
        {branchDropdownOpen && (
          <BranchDropdown
            branches={branches}
            currentBranch={currentBranch}
            onClose={() => setBranchDropdownOpen(false)}
          />
        )}
      </div>

      {/* Push / Pull / Fetch */}
      <div className="shrink-0 flex items-center border-l border-border">
        {/* Main sync button */}
        <button
          onClick={handleSync}
          disabled={isSyncing || !activeAccountId}
          className="flex items-center gap-2.5 px-6 h-[52px] min-w-[180px] hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {behind > 0 ? (
            <ArrowDown className={cn("w-4 h-4 shrink-0", isSyncing && "animate-pulse")} />
          ) : ahead > 0 ? (
            <ArrowUp className={cn("w-4 h-4 shrink-0", isSyncing && "animate-pulse")} />
          ) : (
            <RefreshCw className={cn("w-4 h-4 shrink-0", isSyncing && "animate-spin")} />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold whitespace-nowrap">
              {behind > 0 ? "Pull origin" : ahead > 0 ? "Push origin" : "Fetch origin"}
            </p>
            <p className="text-[11px] text-muted leading-tight whitespace-nowrap">
              {lastFetchedAt
                ? `Last fetched ${formatRelativeTime(lastFetchedAt)}`
                : "Never fetched"}
            </p>
          </div>
          {(ahead > 0 || behind > 0) && (
            <span className="flex items-center gap-0.5 bg-zinc-500/20 dark:bg-zinc-500/30 text-xs font-medium rounded-full px-2 py-0.5 leading-none">
              {behind > 0 ? behind : ahead}
              {behind > 0 ? (
                <ArrowDown className="w-3 h-3" />
              ) : (
                <ArrowUp className="w-3 h-3" />
              )}
            </span>
          )}
        </button>

        {/* Fetch dropdown toggle — only show when Push/Pull is active */}
        {(ahead > 0 || behind > 0) && (
          <div className="relative border-l border-border">
            <button
              onClick={() => {
                setFetchDropdownOpen((v) => !v);
                setBranchDropdownOpen(false);
                setAccountDropdownOpen(false);
              }}
              disabled={isSyncing || !activeAccountId}
              className="flex items-center justify-center w-10 h-[52px] hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <ChevronDown className="w-3.5 h-3.5 text-muted" />
            </button>
            {fetchDropdownOpen && (
              <FetchDropdown
                onFetch={handleFetch}
                onClose={() => setFetchDropdownOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Account */}
      <div className="relative shrink-0 border-l border-border">
        <button
          onClick={() => {
            setAccountDropdownOpen((v) => !v);
            setBranchDropdownOpen(false);
          }}
          className="flex flex-col justify-center px-4 py-1.5 h-[52px] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <span className="text-[11px] text-muted leading-tight">Current Account</span>
          <div className="flex items-center gap-1.5 min-w-0">
            {currentAccount ? (
              <>
                <AccountAvatar account={currentAccount} size="xs" isActive />
                <span className="text-[13px] font-semibold truncate">{currentAccount.username}</span>
              </>
            ) : (
              <>
                <div className="w-4 h-4 rounded-full bg-muted/20 flex items-center justify-center shrink-0">
                  <span className="text-[9px] text-muted">?</span>
                </div>
                <span className="text-[13px] font-semibold text-muted">Sign in</span>
              </>
            )}
          </div>
        </button>
        {accountDropdownOpen && (
          <AccountDropdown
            onClose={() => setAccountDropdownOpen(false)}
            onSignIn={() => setShowLoginDialog(true)}
          />
        )}
      </div>

      {showLoginDialog && (
        <DeviceFlowDialog onClose={() => setShowLoginDialog(false)} />
      )}
    </div>
  );
}

/* ─── Empty / Placeholder States ─── */

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted gap-3">
      <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center">
        <Icon className="w-8 h-8" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs mt-1">{description}</p>
      </div>
    </div>
  );
}

function DiffContent({ filePath, staged }: { filePath: string; staged: boolean }) {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: diff, isLoading, isError } = useFileDiff(activeRepoPath, filePath, staged);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);

  const fileStatus: FileStatus =
    statusEntries.find((e) => e.path === filePath)?.status ?? "modified";

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted">
        Loading diff...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-danger">
        Failed to load diff
      </div>
    );
  }

  return <DiffViewer diff={diff ?? null} status={fileStatus} />;
}

function CommitDetailPlaceholder({ commitId }: { commitId: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
        <GitCommit className="w-4 h-4 text-muted shrink-0" />
        <span className="text-sm font-mono">{commitId.slice(0, 8)}</span>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center text-muted">
        <p className="text-sm">Commit details will render here</p>
      </div>
    </div>
  );
}

/* ─── ContentArea (main export) ─── */

interface ContentAreaProps {
  activeTab: "changes" | "history";
  selectedFile: string | null;
  selectedFileStaged: boolean;
  selectedCommitId: string | null;
}

export function ContentArea({
  activeTab,
  selectedFile,
  selectedFileStaged,
  selectedCommitId,
}: ContentAreaProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Right panel header: Branch + Push/Pull + Account */}
      <RightPanelHeader />

      {/* Diff / Detail content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === "changes" ? (
          selectedFile ? (
            <DiffContent filePath={selectedFile} staged={selectedFileStaged} />
          ) : (
            <EmptyState
              icon={FileText}
              title="No file selected"
              description="Select a changed file to view its diff"
            />
          )
        ) : selectedCommitId ? (
          <CommitDetailPlaceholder commitId={selectedCommitId} />
        ) : (
          <EmptyState
            icon={GitCommit}
            title="No commit selected"
            description="Select a commit to view its details"
          />
        )}
      </div>
    </div>
  );
}
