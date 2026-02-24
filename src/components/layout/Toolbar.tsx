import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  RefreshCw,
  Upload,
  Download,
  GitBranch,
  Check,
  Plus,
  Settings,
  FolderOpen,
  GitFork,
  Search,
  FolderPlus,
} from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useBranchStore } from "@/stores/branch";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { cn } from "@/lib/utils";
import type { RepoInfo } from "@/types";

function ToolbarSection({
  label,
  children,
  onClick,
  className,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col justify-center px-4 py-1.5 min-w-0",
        "hover:bg-black/5 dark:hover:bg-white/10 transition-colors",
        className,
      )}
    >
      <span className="text-[11px] text-muted leading-tight">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">{children}</div>
    </button>
  );
}

function RepoDropdown({
  repos,
  activeRepoPath,
  onSelect,
  onClose,
  onAddLocal,
  onClone,
  onCreateNew,
}: {
  repos: RepoInfo[];
  activeRepoPath: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
  onAddLocal: () => void;
  onClone: () => void;
  onCreateNew: () => void;
}) {
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = repos.filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div
      ref={ref}
      className="absolute left-0 ml-2 top-full mt-2 w-80 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-lg z-50 overflow-hidden"
    >
      {/* Action buttons */}
      <div className="p-2 border-b border-border flex gap-1">
        <button
          onClick={() => { onAddLocal(); onClose(); }}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10 transition-colors border border-border"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Add Local</span>
        </button>
        <button
          onClick={() => { onClone(); onClose(); }}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10 transition-colors border border-border"
        >
          <GitFork className="w-3.5 h-3.5" />
          <span>Clone</span>
        </button>
        <button
          onClick={() => { onCreateNew(); onClose(); }}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10 transition-colors border border-border"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Search filter */}
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface border border-border">
          <Search className="w-3.5 h-3.5 text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter repositories"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* Repo list */}
      <div className="max-h-64 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted text-center py-3">
            {repos.length === 0 ? "No repositories" : "No matches"}
          </p>
        ) : (
          filtered.map((repo) => (
            <button
              key={repo.path}
              onClick={() => {
                onSelect(repo.path);
                onClose();
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 transition-colors text-left",
                repo.path === activeRepoPath
                  ? "bg-primary/10"
                  : "hover:bg-black/5 dark:hover:bg-white/10",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{repo.name}</p>
                <p className="text-xs text-muted truncate">{repo.path}</p>
              </div>
              {repo.path === activeRepoPath && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

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
      className="absolute left-0 ml-2 top-full mt-2 w-64 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-lg z-50 py-1 max-h-80 overflow-y-auto"
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
      className="absolute left-0 ml-2 top-full mt-2 w-64 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-lg z-50 py-1"
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-muted text-center py-3">No accounts</p>
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
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{account.username}</p>
              <p className="text-xs text-muted truncate">{account.email}</p>
            </div>
            {account.id === activeAccountId && (
              <Check className="w-4 h-4 text-primary shrink-0" />
            )}
          </button>
        ))
      )}

      <div className="my-1 border-t border-border" />

      <button
        onClick={onClose}
        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-sm"
      >
        <Plus className="w-4 h-4 text-muted" />
        <span>Add Account</span>
      </button>
      <button
        onClick={onClose}
        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-sm"
      >
        <Settings className="w-4 h-4 text-muted" />
        <span>Manage Accounts</span>
      </button>
    </div>
  );
}

export function Toolbar() {
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const repos = useRepositoryStore((s) => s.repos);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const currentBranch = useBranchStore((s) => s.currentBranch);
  const branches = useBranchStore((s) => s.branches);

  const currentAccount = accounts.find((a) => a.id === activeAccountId);

  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);

  const closeAll = () => {
    setAccountDropdownOpen(false);
    setRepoDropdownOpen(false);
    setBranchDropdownOpen(false);
  };

  const headBranch = branches.find((b) => b.isHead);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;

  return (
    <div
      className="flex items-stretch h-13 border-b border-border bg-surface select-none"
      data-tauri-drag-region
    >
      {/* Account */}
      <div className="relative border-r border-border">
        <ToolbarSection
          label="Account"
          onClick={() => {
            closeAll();
            setAccountDropdownOpen((v) => !v);
          }}
          className="h-full px-3"
        >
          {currentAccount ? (
            <>
              <AccountAvatar account={currentAccount} size="sm" />
              <span className="text-sm font-semibold truncate max-w-20">
                {currentAccount.username}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">Sign in</span>
          )}
          <ChevronDown className="w-3 h-3 text-muted shrink-0" />
        </ToolbarSection>
        {accountDropdownOpen && (
          <AccountDropdown onClose={() => setAccountDropdownOpen(false)} />
        )}
      </div>

      {/* Current Repository */}
      <div className="relative flex-1 border-r border-border">
        <ToolbarSection
          label="Current Repository"
          onClick={() => {
            closeAll();
            setRepoDropdownOpen((v) => !v);
          }}
          className="w-full h-full"
        >
          <span className="text-sm font-semibold truncate">
            {activeRepo?.name ?? "Select a repository"}
          </span>
          <ChevronDown className="w-3 h-3 text-muted shrink-0" />
        </ToolbarSection>
        {repoDropdownOpen && (
          <RepoDropdown
            repos={repos}
            activeRepoPath={activeRepoPath}
            onSelect={setActiveRepo}
            onClose={() => setRepoDropdownOpen(false)}
            onAddLocal={() => {/* TODO: open folder dialog */}}
            onClone={() => {/* TODO: open clone dialog */}}
            onCreateNew={() => {/* TODO: open create repo dialog */}}
          />
        )}
      </div>

      {/* Current Branch */}
      <div className="relative flex-1 border-r border-border">
        <ToolbarSection
          label="Current Branch"
          onClick={() => {
            closeAll();
            setBranchDropdownOpen((v) => !v);
          }}
          className="w-full h-full"
        >
          <GitBranch className="w-3.5 h-3.5 shrink-0" />
          <span className="text-sm font-semibold truncate">
            {currentBranch ?? "No branch"}
          </span>
          <ChevronDown className="w-3 h-3 text-muted shrink-0" />
        </ToolbarSection>
        {branchDropdownOpen && (
          <BranchDropdown
            branches={branches}
            currentBranch={currentBranch}
            onClose={() => setBranchDropdownOpen(false)}
          />
        )}
      </div>

      {/* Fetch / Push / Pull */}
      <div className="flex-1">
        <ToolbarSection
          label={behind > 0 ? "Pull Origin" : ahead > 0 ? "Push Origin" : "Fetch Origin"}
          className="w-full h-full"
        >
          {behind > 0 ? (
            <>
              <Download className="w-4 h-4 shrink-0" />
              <span className="text-sm font-semibold">Pull</span>
              <span className="bg-primary text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {behind}
              </span>
            </>
          ) : ahead > 0 ? (
            <>
              <Upload className="w-4 h-4 shrink-0" />
              <span className="text-sm font-semibold">Push</span>
              <span className="bg-primary text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {ahead}
              </span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 shrink-0" />
              <span className="text-sm font-semibold">Fetch</span>
            </>
          )}
        </ToolbarSection>
      </div>
    </div>
  );
}
