import { useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Lock,
  Search,
  FolderOpen,
  GitFork,
  FolderPlus,
  Circle,
  ArrowUp,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useBranchStore } from "@/stores/branch";
import { useStatus, useCommitHistory, useBranches } from "@/api/queries";
import { addLocalRepository, createCommit, stageFiles, unstageFiles } from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { useToastStore } from "@/stores/toast";
import type { CommitInfo, RepoInfo } from "@/types";

/* ─── Status helpers ─── */

const statusColors: Record<string, string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-danger",
  renamed: "text-primary",
  copied: "text-primary",
  untracked: "text-success",
  conflicted: "text-danger",
  ignored: "text-muted",
};

const statusLabels: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
  conflicted: "!",
  ignored: "I",
};

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
  const colorClass = statusColors[entry.status] ?? "text-muted";
  const label = statusLabels[entry.status] ?? "?";

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors select-none border-b border-border",
        isSelected
          ? "bg-primary text-white"
          : "hover:bg-black/5 dark:hover:bg-white/10",
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
      <span
        className={cn(
          "text-xs font-bold w-4 text-right shrink-0",
          isSelected ? "text-white" : colorClass,
        )}
      >
        {label}
      </span>
    </div>
  );
}

/* ─── Repo List View ─── */

interface GroupedRepos {
  label: string;
  repos: RepoInfo[];
}

function groupReposByAccount(
  repos: RepoInfo[],
  accounts: { id: string; username: string }[],
): GroupedRepos[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a.username]));
  const groups = new Map<string, RepoInfo[]>();

  for (const repo of repos) {
    const key = repo.accountId
      ? (accountMap.get(repo.accountId) ?? "Other")
      : "Other";
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, repo]);
  }

  return Array.from(groups.entries()).map(([label, repoList]) => ({
    label,
    repos: repoList,
  }));
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
  const accounts = useAccountStore((s) => s.accounts);

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
  const groups = groupReposByAccount(filtered, accounts);

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Filter + Add */}
      <div className="flex items-center gap-2 p-2 min-w-0">
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-black/20 border border-border">
          <Search className="w-3.5 h-3.5 text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-muted"
          />
        </div>
        <div className="relative shrink-0" ref={addRef}>
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm font-medium border border-border hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
          >
            Add
            <ChevronDown className="w-3 h-3" />
          </button>
          {addMenuOpen && (
            <div className="absolute right-0 top-full mt-1 min-w-48 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-lg z-50 py-1">
              <button
                onClick={handleAddLocal}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left whitespace-nowrap"
              >
                <FolderOpen className="w-4 h-4 text-muted shrink-0" />
                Add Local Repository...
              </button>
              <button
                onClick={() => setAddMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left whitespace-nowrap"
              >
                <GitFork className="w-4 h-4 text-muted shrink-0" />
                Clone Repository...
              </button>
              <button
                onClick={() => setAddMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left whitespace-nowrap"
              >
                <FolderPlus className="w-4 h-4 text-muted shrink-0" />
                Create New Repository...
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grouped repo list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {groups.length === 0 ? (
          <p className="text-sm text-muted text-center py-4">
            {repos.length === 0 ? "No repositories" : "No matches"}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="text-xs font-bold text-foreground px-3 py-1.5 truncate">
                {group.label}
              </p>
              {group.repos.map((repo) => (
                <button
                  key={repo.path}
                  onClick={() => onSelectRepo(repo.path)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors min-w-0",
                    repo.path === activeRepoPath
                      ? "bg-primary text-white"
                      : "hover:bg-black/5 dark:hover:bg-white/10",
                  )}
                >
                  <Lock className="w-3.5 h-3.5 shrink-0 opacity-50" />
                  <span className="text-sm truncate flex-1 min-w-0">{repo.name}</span>
                  {repo.isDirty && (
                    <Circle
                      className={cn(
                        "w-2.5 h-2.5 fill-current shrink-0",
                        repo.path === activeRepoPath
                          ? "text-white"
                          : "text-primary",
                      )}
                    />
                  )}
                </button>
              ))}
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
      await queryClient.invalidateQueries({ queryKey: ["status"] });
    } catch (err) {
      addToast(`Stage failed: ${getErrorMessage(err)}`, "error");
    }
  };

  const handleUnstageAll = async () => {
    if (!activeRepoPath || stagedFiles.length === 0) return;
    try {
      await unstageFiles(activeRepoPath, stagedFiles.map((e) => e.path));
      await queryClient.invalidateQueries({ queryKey: ["status"] });
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
      await queryClient.invalidateQueries({ queryKey: ["status"] });
      await queryClient.invalidateQueries({ queryKey: ["commitHistory"] });
    } catch (err) {
      addToast(`Commit failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* File list */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
        {statusEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted gap-2">
            <p className="text-sm">No local changes</p>
          </div>
        ) : (
          <>
            {/* Staged Changes */}
            {stagedFiles.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-border">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                    checked={true}
                    onChange={handleUnstageAll}
                  />
                  <span className="text-xs font-bold text-foreground flex-1">
                    Staged Changes
                  </span>
                  <span className="text-xs text-muted">{stagedFiles.length}</span>
                </div>
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
                        await queryClient.invalidateQueries({ queryKey: ["status"] });
                      } catch (err) {
                        addToast(`Unstage failed: ${getErrorMessage(err)}`, "error");
                      }
                    }}
                  />
                ))}
              </div>
            )}

            {/* Divider */}
            {stagedFiles.length > 0 && unstagedFiles.length > 0 && (
              <div className="border-b-2 border-border" />
            )}

            {/* Unstaged Changes */}
            {unstagedFiles.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-border">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                    checked={false}
                    onChange={handleStageAll}
                  />
                  <span className="text-xs font-bold text-foreground flex-1">
                    Changes
                  </span>
                  <span className="text-xs text-muted">{unstagedFiles.length}</span>
                </div>
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
                        await queryClient.invalidateQueries({ queryKey: ["status"] });
                      } catch (err) {
                        addToast(`Stage failed: ${getErrorMessage(err)}`, "error");
                      }
                    }}
                  />
                ))}
              </div>
            )}
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
            "bg-white dark:bg-black/20 outline-none",
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
            "bg-white dark:bg-black/20 outline-none resize-none",
            "focus:border-primary transition-colors",
          )}
        />
        <button
          onClick={handleCommit}
          className={cn(
            "w-full py-2 rounded-md text-sm font-medium",
            "bg-primary text-white hover:bg-primary-hover transition-colors",
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

  const headBranch = branches.find((b) => b.isHead);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;

  // 연동된 GitHub 계정의 이메일 → avatarUrl 매핑
  const accountAvatarMap = new Map(
    accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl]),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <p className="text-sm">Loading history...</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted">
        <p className="text-sm">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
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
                ? "bg-primary text-white"
                : "hover:bg-black/5 dark:hover:bg-white/5",
            )}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{commit.summary}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {(() => {
                  const avatarSrc =
                    accountAvatarMap.get(commit.author.email?.toLowerCase()) ||
                    commit.author.avatarUrl;
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
                          ? "bg-white/20 text-white"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {(commit.author.name ?? "?")[0].toUpperCase()}
                    </div>
                  );
                })()}
                <span className={cn("text-[11px] truncate", isActive ? "text-white/70" : "text-muted")}>
                  {commit.author.name}
                </span>
                <span className={cn("text-[11px] shrink-0 leading-none", isActive ? "text-white/50" : "text-zinc-400 dark:text-zinc-500")}>
                  •
                </span>
                <span className={cn("text-[11px] shrink-0", isActive ? "text-white/70" : "text-muted")}>
                  {formatRelativeTime(commit.timestamp)}
                </span>
              </div>
            </div>
            {isUnpushed && (
              <div
                className={cn(
                  "shrink-0 self-center flex items-center justify-center w-5 h-5 rounded-full",
                  isActive
                    ? "bg-white/20"
                    : "bg-primary/10",
                )}
              >
                <ArrowUp
                  strokeWidth={3}
                  className={cn(
                    "w-3 h-3",
                    isActive ? "text-white" : "text-primary",
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
  const [repoListOpen, setRepoListOpen] = useState(false);
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const changesCount = statusEntries.length;

  const handleSelectRepo = (path: string) => {
    setActiveRepo(path);
    setRepoListOpen(false);
  };

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden bg-surface">
      {/* Repo header — toggles repo list */}
      <button
        onClick={() => setRepoListOpen((v) => !v)}
        className="flex items-center gap-2 px-4 h-[52px] shrink-0 border-b border-border hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
        data-tauri-drag-region
      >
        <Lock className="w-4 h-4 shrink-0 opacity-50" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted leading-tight">Current Repository</p>
          <p className="text-sm font-semibold truncate">
            {activeRepo?.name ?? "Select a repository"}
          </p>
        </div>
        {repoListOpen ? (
          <ChevronUp className="w-4 h-4 text-muted shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted shrink-0" />
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
                    : "text-muted hover:text-foreground",
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
