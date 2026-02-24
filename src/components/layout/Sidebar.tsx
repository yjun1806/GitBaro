import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ChevronUp,
  Search,
  FolderOpen,
  GitFork,
  GitBranch,
  FolderPlus,
  Circle,
  ArrowUp,
  Globe,
  HardDrive,
  Plus,
  Loader2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useBranchStore } from "@/stores/branch";
import { useStatus, useCommitHistory, useCommitAvatars, useBranches } from "@/api/queries";
import { addLocalRepository, createCommit, stageFiles, unstageFiles, gitFetch } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { FileStatusBadge } from "@/lib/file-status";
import { useToastStore } from "@/stores/toast";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import type { CommitInfo, RepoInfo } from "@/types";
import type { FileStatus } from "@/types";

/* ─── File Entry ─── */

function FileEntry({
  entry,
  isSelected,
  onClick,
  onToggleStage,
}: {
  entry: { path: string; status: string; staged: boolean };
  isSelected: boolean;
  onClick: () => void;
  onToggleStage: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors select-none border-b border-border",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent",
      )}
    >
      <input
        type="checkbox"
        className="w-3.5 h-3.5 shrink-0 cursor-pointer"
        checked={entry.staged}
        onChange={(e) => {
          e.stopPropagation();
          onToggleStage();
        }}
      />
      <span className="text-sm truncate flex-1">{entry.path}</span>
      <FileStatusBadge status={entry.status as FileStatus} />
    </div>
  );
}

/* ─── Repo List View ─── */

interface GroupedRepos {
  label: string;
  repos: RepoInfo[];
}

function extractOwnerFromRemoteUrl(url: string): string | null {
  // https://github.com/OWNER/REPO.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\//);
  if (httpsMatch) return httpsMatch[1];
  // git@github.com:OWNER/REPO.git
  const sshMatch = url.match(/github\.com:([^/]+)\//);
  if (sshMatch) return sshMatch[1];
  return null;
}

function groupReposByOwner(
  repos: RepoInfo[],
  accounts: { id: string; username: string }[],
): GroupedRepos[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a.username]));
  const groups = new Map<string, RepoInfo[]>();

  for (const repo of repos) {
    // 1. remote origin URL에서 owner/org 추출
    const originRemote = repo.remotes.find((r) => r.name === "origin");
    const owner = originRemote ? extractOwnerFromRemoteUrl(originRemote.url) : null;

    // 2. owner가 있으면 사용, 없으면 accountId 기반, 그것도 없으면 "Local"
    const key = owner
      ?? (repo.accountId ? (accountMap.get(repo.accountId) ?? "Other") : "Local");

    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, repo]);
  }

  return Array.from(groups.entries()).map(([label, repoList]) => ({
    label,
    repos: repoList,
  }));
}

function RepoAccountPicker({
  accounts,
  currentAccountId,
  onSelect,
  onClose,
}: {
  accounts: { id: string; username: string; avatarUrl: string }[];
  currentAccountId: string | null;
  onSelect: (accountId: string | null) => void;
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
      className="absolute right-1 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50 py-1"
    >
      <p className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        Link Account
      </p>
      {accounts.map((account) => (
        <button
          key={account.id}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(account.id);
          }}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left",
            account.id === currentAccountId
              ? "bg-primary/10 text-primary"
              : "hover:bg-accent",
          )}
        >
          <AccountAvatar account={account as any} size="xs" />
          <span className="truncate flex-1">{account.username}</span>
          {account.id === currentAccountId && (
            <span className="text-[11px] font-medium text-primary shrink-0">Default</span>
          )}
        </button>
      ))}
      {currentAccountId && (
        <>
          <div className="border-t border-border my-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(null);
            }}
            className="w-full px-3 py-1.5 text-sm text-danger hover:bg-accent transition-colors text-left"
          >
            Unlink account
          </button>
        </>
      )}
    </div>
  );
}

function RepoListView({
  onSelectRepo,
}: {
  onSelectRepo: (path: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const repos = useRepositoryStore((s) => s.repos);
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const updateRepoAccount = useRepositoryStore((s) => s.updateRepoAccount);
  const accounts = useAccountStore((s) => s.accounts);
  const [accountPickerRepo, setAccountPickerRepo] = useState<string | null>(null);

  const addToast = useToastStore((s) => s.addToast);

  const handleAddLocal = useCallback(async () => {
    setAddMenuOpen(false);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const dirPath = typeof selected === "string" ? selected : selected;
      const repoInfo = await addLocalRepository(dirPath);
      addRepo(repoInfo);
      onSelectRepo(repoInfo.path);
    } catch (err) {
      addToast(`Failed to add repository: ${getErrorMessage(err)}`, "error");
    }
  }, [addRepo, onSelectRepo, addToast]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = repos.filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = groupReposByOwner(filtered, accounts);

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Filter + Add */}
      <div className="flex items-center gap-2 p-2 min-w-0">
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-card border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="relative shrink-0" ref={addRef}>
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent transition-colors"
            title="Add repository"
          >
            <Plus className="w-4 h-4" />
          </button>
          {addMenuOpen && (
            <div className="absolute right-0 top-full mt-1 min-w-48 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
              <button
                onClick={handleAddLocal}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left whitespace-nowrap"
              >
                <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                Add Local Repository...
              </button>
              <button
                onClick={() => setAddMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left whitespace-nowrap"
              >
                <GitFork className="w-4 h-4 text-muted-foreground shrink-0" />
                Clone Repository...
              </button>
              <button
                onClick={() => setAddMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left whitespace-nowrap"
              >
                <FolderPlus className="w-4 h-4 text-muted-foreground shrink-0" />
                Create New Repository...
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grouped repo list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <Search className="w-6 h-6 opacity-40" />
            <p className="text-sm">
              {repos.length === 0 ? "No repositories" : "No matches"}
            </p>
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.label} className={cn(groupIndex > 0 && "mt-3")}>
              {/* Group header */}
              <div className="flex items-center gap-2 px-2 py-1.5">
                {group.label === "Local" ? (
                  <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate">
                  {group.label}
                </span>
                <span className="text-[11px] text-muted-foreground/60 tabular-nums">
                  {group.repos.length}
                </span>
              </div>
              {/* Repo items */}
              <div className="flex flex-col gap-0.5">
                {group.repos.map((repo) => {
                  const isActive = repo.path === activeRepoPath;
                  const linkedAccount = repo.accountId
                    ? accounts.find((a) => a.id === repo.accountId)
                    : null;
                  const isPickerOpen = accountPickerRepo === repo.path;
                  return (
                    <div key={repo.path} className="relative">
                      <button
                        onClick={() => onSelectRepo(repo.path)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors min-w-0 rounded-md",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent",
                        )}
                      >
                        <GitFork className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "opacity-70" : "opacity-40",
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{repo.name}</p>
                          {repo.currentBranch && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <GitBranch className={cn(
                                "w-3 h-3 shrink-0",
                                isActive ? "text-primary-foreground/60" : "text-muted-foreground",
                              )} />
                              <span className={cn(
                                "text-[11px] truncate",
                                isActive ? "text-primary-foreground/60" : "text-muted-foreground",
                              )}>
                                {repo.currentBranch}
                              </span>
                            </div>
                          )}
                        </div>
                        {repo.isDirty && (
                          <Circle
                            className={cn(
                              "w-2 h-2 fill-current shrink-0",
                              isActive ? "text-primary-foreground/70" : "text-primary",
                            )}
                          />
                        )}
                        {/* Account avatar button */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAccountPickerRepo(isPickerOpen ? null : repo.path);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              setAccountPickerRepo(isPickerOpen ? null : repo.path);
                            }
                          }}
                          className={cn(
                            "shrink-0 rounded-full transition-opacity",
                            isActive ? "hover:opacity-80" : "hover:opacity-70",
                          )}
                          title={linkedAccount ? linkedAccount.username : "Set account"}
                        >
                          {linkedAccount ? (
                            <AccountAvatar account={linkedAccount} size="xs" />
                          ) : (
                            <div className={cn(
                              "w-5 h-5 rounded-full border-2 border-dashed flex items-center justify-center",
                              isActive
                                ? "border-primary-foreground/40 text-primary-foreground/40"
                                : "border-muted-foreground/40 text-muted-foreground/40",
                            )}>
                              <Plus className="w-2.5 h-2.5" />
                            </div>
                          )}
                        </div>
                      </button>
                      {/* Account picker dropdown */}
                      {isPickerOpen && (
                        <RepoAccountPicker
                          accounts={accounts}
                          currentAccountId={repo.accountId}
                          onSelect={(accountId) => {
                            updateRepoAccount(repo.path, accountId);
                            setAccountPickerRepo(null);
                          }}
                          onClose={() => setAccountPickerRepo(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Changes Tab ─── */

function ChangesView({
  selectedFile,
  onSelectFile,
}: {
  selectedFile: string | null;
  onSelectFile: (path: string, staged: boolean) => void;
}) {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const currentBranch = useBranchStore((s) => s.currentBranch);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const queryClient = useQueryClient();

  const addToast = useToastStore((s) => s.addToast);
  const [commitSummary, setCommitSummary] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);

  const stagedFiles = statusEntries.filter((e) => e.staged);
  const unstagedFiles = statusEntries.filter((e) => !e.staged);

  const handleStageAll = async () => {
    if (!activeRepoPath || unstagedFiles.length === 0) return;
    try {
      await stageFiles(activeRepoPath, unstagedFiles.map((e) => e.path));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      addToast(`Stage failed: ${getErrorMessage(err)}`, "error");
    }
  };

  const handleUnstageAll = async () => {
    if (!activeRepoPath || stagedFiles.length === 0) return;
    try {
      await unstageFiles(activeRepoPath, stagedFiles.map((e) => e.path));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      addToast(`Unstage failed: ${getErrorMessage(err)}`, "error");
    }
  };

  const handleCommit = async () => {
    if (!activeRepoPath || !commitSummary.trim() || stagedFiles.length === 0) return;
    setIsCommitting(true);
    try {
      const message = commitDescription.trim()
        ? `${commitSummary.trim()}\n\n${commitDescription.trim()}`
        : commitSummary.trim();
      await createCommit(activeRepoPath, message, false, activeAccountId);
      setCommitSummary("");
      setCommitDescription("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      addToast(`Commit failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* File list */}
      <div className="flex-1 overflow-y-auto bg-background">
        {statusEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">No local changes</p>
          </div>
        ) : (
          <>
            {/* Staged Changes header */}
            {stagedFiles.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-border sticky top-0 z-10">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={true}
                  onChange={handleUnstageAll}
                />
                <span className="text-xs font-bold text-foreground flex-1">
                  Staged Changes
                </span>
                <span className="text-xs text-muted-foreground">{stagedFiles.length}</span>
              </div>
            )}
            {/* Staged file entries */}
            {stagedFiles.map((entry) => (
              <FileEntry
                key={`${entry.path}-staged`}
                entry={entry}
                isSelected={selectedFile === entry.path}
                onClick={() => onSelectFile(entry.path, entry.staged)}
                onToggleStage={async () => {
                  if (!activeRepoPath) return;
                  try {
                    await unstageFiles(activeRepoPath, [entry.path]);
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ["status"] }),
                      queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
                    ]);
                  } catch (err) {
                    addToast(`Unstage failed: ${getErrorMessage(err)}`, "error");
                  }
                }}
              />
            ))}

            {/* Changes header */}
            {unstagedFiles.length > 0 && (
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-border sticky bottom-0 z-10",
                stagedFiles.length > 0 ? "top-[29px]" : "top-0",
              )}>
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={false}
                  onChange={handleStageAll}
                />
                <span className="text-xs font-bold text-foreground flex-1">
                  Changes
                </span>
                <span className="text-xs text-muted-foreground">{unstagedFiles.length}</span>
              </div>
            )}
            {/* Unstaged file entries */}
            {unstagedFiles.map((entry) => (
              <FileEntry
                key={`${entry.path}-unstaged`}
                entry={entry}
                isSelected={selectedFile === entry.path}
                onClick={() => onSelectFile(entry.path, entry.staged)}
                onToggleStage={async () => {
                  if (!activeRepoPath) return;
                  try {
                    await stageFiles(activeRepoPath, [entry.path]);
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ["status"] }),
                      queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
                    ]);
                  } catch (err) {
                    addToast(`Stage failed: ${getErrorMessage(err)}`, "error");
                  }
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Commit panel */}
      <div className="border-t border-border p-3 flex flex-col gap-2">
        <input
          type="text"
          placeholder="Summary (required)"
          value={commitSummary}
          onChange={(e) => setCommitSummary(e.target.value)}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md border border-border",
            "bg-card outline-none",
            "focus:border-primary transition-colors",
          )}
        />
        <textarea
          placeholder="Description"
          rows={3}
          value={commitDescription}
          onChange={(e) => setCommitDescription(e.target.value)}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md border border-border",
            "bg-card outline-none resize-none",
            "focus:border-primary transition-colors",
          )}
        />
        {activeAccount && (
          <div className="flex items-center gap-1.5 px-1">
            {activeAccount.avatarUrl ? (
              <img
                src={activeAccount.avatarUrl}
                alt={activeAccount.username}
                className="w-4 h-4 rounded-full shrink-0 object-cover"
              />
            ) : (
              <div className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[8px] font-bold shrink-0">
                {activeAccount.username[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <span className="text-[11px] text-muted-foreground truncate">
              {activeAccount.username}
              {activeAccount.email ? ` <${activeAccount.email}>` : ""}
            </span>
          </div>
        )}
        <button
          onClick={handleCommit}
          className={cn(
            "w-full py-2 rounded-md text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover transition-colors",
            (stagedFiles.length === 0 || !commitSummary.trim() || isCommitting) &&
              "opacity-50 cursor-not-allowed",
          )}
          disabled={stagedFiles.length === 0 || !commitSummary.trim() || isCommitting}
        >
          Commit to <strong>{currentBranch ?? "main"}</strong>
        </button>
      </div>
    </div>
  );
}

/* ─── History Tab ─── */

function HistoryView({
  selectedCommitId,
  onSelectCommit,
}: {
  selectedCommitId: string | null;
  onSelectCommit: (id: string) => void;
}) {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const { data: commits = [], isLoading } = useCommitHistory(activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: githubAvatarMap = {} } = useCommitAvatars(activeRepoPath);

  const headBranch = branches.find((b) => b.isHead);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;

  // 연동된 GitHub 계정의 이메일 → avatarUrl 매핑
  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading history...</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {commits.map((commit: CommitInfo, index: number) => {
        const isActive = selectedCommitId === commit.id;
        const isUnpushed = index < ahead;
        return (
          <div
            key={commit.id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCommit(commit.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelectCommit(commit.id);
            }}
            className={cn(
              "flex items-start gap-3 px-3 py-2.5 border-b border-border cursor-pointer transition-colors select-none",
              "focus:outline-none",
              isActive
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{commit.summary}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {(() => {
                  const emailKey = commit.author.email?.toLowerCase() ?? "";
                  const avatarSrc =
                    accountAvatarMap.get(emailKey) ||   // 1: logged-in account
                    githubAvatarMap[emailKey] ||        // 2: GitHub API
                    commit.author.avatarUrl;            // 3: Gravatar fallback
                  return avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt={commit.author.name ?? ""}
                      className="w-3.5 h-3.5 rounded-full shrink-0 object-cover"
                    />
                  ) : (
                    <div
                      className={cn(
                        "w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0",
                        "text-[8px] font-bold",
                        isActive
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {(commit.author.name ?? "?")[0].toUpperCase()}
                    </div>
                  );
                })()}
                <span className={cn("text-[11px] truncate", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {commit.author.name}
                </span>
                <span className={cn("text-[11px] shrink-0 leading-none", isActive ? "text-primary-foreground/50" : "text-muted-foreground")}>
                  •
                </span>
                <span className={cn("text-[11px] shrink-0", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {formatRelativeTime(commit.timestamp)}
                </span>
              </div>
            </div>
            {isUnpushed && (
              <div
                className={cn(
                  "shrink-0 self-center flex items-center justify-center w-5 h-5 rounded-full",
                  isActive
                    ? "bg-primary-foreground/20"
                    : "bg-primary/10",
                )}
              >
                <ArrowUp
                  strokeWidth={3}
                  className={cn(
                    "w-3 h-3",
                    isActive ? "text-primary-foreground" : "text-primary",
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Sidebar (main export) ─── */

// 세션 내 이미 fetch한 저장소를 추적 (앱 재시작 시 초기화)
const fetchedRepos = new Set<string>();

export function Sidebar({
  selectedFile,
  onSelectFile,
  selectedCommitId,
  onSelectCommit,
}: {
  selectedFile: string | null;
  onSelectFile: (path: string, staged: boolean) => void;
  selectedCommitId: string | null;
  onSelectCommit: (id: string) => void;
}) {
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const changesCount = statusEntries.length;
  const queryClient = useQueryClient();
  const [isFetching, setIsFetching] = useState(false);

  const handleSelectRepo = (path: string) => {
    // 레포 전환
    setActiveRepo(path);
    // store에서 최신 상태를 직접 읽어 대표계정 전환 (클로저 stale 방지)
    const latestRepos = useRepositoryStore.getState().repos;
    const repo = latestRepos.find((r) => r.path === path);
    if (repo?.accountId) {
      setActiveAccount(repo.accountId);
    }
    setRepoListOpen(false);

    // 세션 내 아직 fetch하지 않은 저장소라면 백그라운드로 fetch
    const hasRemote = repo?.remotes && repo.remotes.length > 0;
    if (repo?.accountId && hasRemote && !fetchedRepos.has(path)) {
      setIsFetching(true);
      gitFetch(path, repo.accountId)
        .then(() => {
          fetchedRepos.add(path);
          queryClient.invalidateQueries({ queryKey: ["branches"] });
          queryClient.invalidateQueries({ queryKey: ["commitHistory"] });
          queryClient.invalidateQueries({ queryKey: ["status"] });
        })
        .catch(() => {
          // fetch 실패는 무시 (네트워크 문제 등)
        })
        .finally(() => {
          setIsFetching(false);
        });
    }
  };

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden bg-surface">
      {/* Repo header — toggles repo list */}
      <button
        onClick={() => setRepoListOpen(!repoListOpen)}
        className="flex items-center gap-2 px-4 h-[52px] shrink-0 border-b border-border hover:bg-accent transition-colors text-left"
        data-tauri-drag-region
      >
        <GitFork className="w-4 h-4 shrink-0 opacity-50" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground leading-tight">Current Repository</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">
              {activeRepo?.name ?? "Select a repository"}
            </p>
            {isFetching && (
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
            )}
          </div>
        </div>
        {repoListOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {repoListOpen ? (
        /* ─── Repo list view ─── */
        <RepoListView onSelectRepo={handleSelectRepo} />
      ) : (
        /* ─── Changes / History view ─── */
        <>
          {/* Tab bar */}
          <div className="flex items-center border-b border-border">
            {(["changes", "history"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors",
                  activeTab === tab
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{tab === "changes" ? "Changes" : "History"}</span>
                {tab === "changes" && changesCount > 0 && (
                  <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded-full leading-none">
                    {changesCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === "changes" ? (
              <ChangesView
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
              />
            ) : (
              <HistoryView
                selectedCommitId={selectedCommitId}
                onSelectCommit={onSelectCommit}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
