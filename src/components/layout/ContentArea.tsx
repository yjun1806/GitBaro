import { useState, useRef, useEffect } from "react";
import {
  FileText,
  GitCommit,
  GitBranch,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Upload,
  Download,
  Check,
} from "lucide-react";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useBranches, useStatus, useFileDiff } from "@/api/queries";
import { AccountAvatar } from "@/components/account/AccountAvatar";
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

function AccountDropdown({ onClose }: { onClose: () => void }) {
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
          <button className="mt-2 w-full py-1.5 rounded-md text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-colors">
            Sign in to GitHub
          </button>
        </div>
      ) : (
        accounts.map((account) => (
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
        ))
      )}
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

  const currentAccount = accounts.find((a) => a.id === activeAccountId);

  return (
    <div
      className="flex items-center h-[52px] border-b border-border bg-surface select-none"
      data-tauri-drag-region
    >
      {/* Branch selector */}
      <div className="relative w-[230px] shrink-0">
        <button
          onClick={() => {
            setBranchDropdownOpen((v) => !v);
            setAccountDropdownOpen(false);
          }}
          className="flex flex-col justify-center px-4 py-1.5 h-full w-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <span className="text-[11px] text-muted leading-tight">Current Branch</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <GitBranch className="w-3.5 h-3.5 shrink-0" />
            <span className="text-sm font-semibold truncate">
              {currentBranch ?? "No branch"}
            </span>
            {branchDropdownOpen ? (
              <ChevronUp className="w-3 h-3 text-muted shrink-0" />
            ) : (
              <ChevronDown className="w-3 h-3 text-muted shrink-0" />
            )}
          </div>
        </button>
        {branchDropdownOpen && (
          <BranchDropdown
            branches={branches}
            currentBranch={currentBranch}
            onClose={() => setBranchDropdownOpen(false)}
          />
        )}
      </div>

      {/* Fetch / Push / Pull */}
      <button className="w-[230px] shrink-0 flex flex-col justify-center items-center px-4 py-1.5 h-full border-l border-border hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
        {behind > 0 ? (
          <>
            <span className="text-[11px] text-muted leading-tight">Pull Origin</span>
            <div className="flex items-center gap-1.5">
              <Download className="w-4 h-4 shrink-0" />
              <span className="bg-primary text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {behind}
              </span>
            </div>
          </>
        ) : ahead > 0 ? (
          <>
            <span className="text-[11px] text-muted leading-tight">Push Origin</span>
            <div className="flex items-center gap-1.5">
              <Upload className="w-4 h-4 shrink-0" />
              <span className="bg-primary text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {ahead}
              </span>
            </div>
          </>
        ) : (
          <>
            <span className="text-[11px] text-muted leading-tight">Fetch Origin</span>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4 shrink-0" />
            </div>
          </>
        )}
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Account */}
      <div className="relative w-[230px] shrink-0 border-l border-border">
        <button
          onClick={() => {
            setAccountDropdownOpen((v) => !v);
            setBranchDropdownOpen(false);
          }}
          className="flex items-center gap-2.5 px-4 h-[52px] w-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          {currentAccount ? (
            <>
              <AccountAvatar account={currentAccount} size="sm" isActive />
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] text-muted leading-tight">GitHub Account</span>
                <span className="text-sm font-semibold truncate">{currentAccount.username}</span>
              </div>
            </>
          ) : (
            <>
              <div className="w-6 h-6 rounded-full bg-muted/20 flex items-center justify-center shrink-0">
                <span className="text-xs text-muted">?</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] text-muted leading-tight">GitHub Account</span>
                <span className="text-sm font-semibold text-muted">Sign in</span>
              </div>
            </>
          )}
        </button>
        {accountDropdownOpen && (
          <AccountDropdown onClose={() => setAccountDropdownOpen(false)} />
        )}
      </div>
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
