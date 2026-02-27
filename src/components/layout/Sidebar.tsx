import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  FolderOpen,
  GitFork,
  GitBranch,
  FolderPlus,
  Circle,
  ArrowUp,
  EllipsisVertical,
  Globe,
  Star,
  Trash2,
  HardDrive,
  Plus,
  Loader2,
  Lock,
  CloudOff,
  Archive,
  Building2,
  User,
  ShieldAlert,
  ShieldX,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useBranchStore } from "@/stores/branch";
import { useStatus, useCommitHistory, useCommitAvatars, useBranches, useBranchComparison, useSettings } from "@/api/queries";
import { addLocalRepository, cloneRepository, createCommit, stageFiles, unstageFiles, gitFetch, openInEditor, getRepoVisibility, getOwnerType, validateToken } from "@/api/commands";
import { CommitErrorDialog } from "@/components/commit/CommitErrorDialog";
import { BranchCompareSelector } from "@/components/history/BranchCompareSelector";
import { BranchCompareView } from "@/components/history/BranchCompareView";
import { MergeActionPanel } from "@/components/history/MergeActionPanel";
import { CloneDialog } from "@/components/repository/CloneDialog";
import { RepoHeaderContextMenu } from "@/components/repository/RepoHeaderContextMenu";
import { AccountSelectDialog } from "@/components/account/AccountSelectDialog";
import { useQueryClient } from "@tanstack/react-query";
import { cn, formatRelativeTime, getErrorMessage } from "@/lib/utils";
import { FileStatusBadge } from "@/lib/file-status";
import { groupFilesByDirectory } from "@/lib/group-files";
import { useToastStore } from "@/stores/toast";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import type { CommitInfo, RepoInfo } from "@/types";
import type { FileStatus } from "@/types";

/* ─── File Entry ─── */

function FileEntry({
  entry,
  isSelected,
  onClick,
  onDoubleClick,
  onToggleStage,
}: {
  entry: { path: string; status: string; staged: boolean; insertions?: number | null; deletions?: number | null; modifiedAt?: number | null };
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onToggleStage: () => void;
}) {
  const filename = entry.path.includes("/")
    ? entry.path.substring(entry.path.lastIndexOf("/") + 1)
    : entry.path;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors select-none border-b border-border",
        isSelected
          ? "bg-primary/10 text-primary font-semibold"
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
      <FileStatusBadge status={entry.status as FileStatus} />
      <span className="text-xs font-medium text-foreground truncate">{filename}</span>
      {(entry.insertions != null || entry.deletions != null) && (
        <span className="text-xs shrink-0">
          {entry.insertions != null && <span className="text-success">+{entry.insertions}</span>}
          {entry.insertions != null && entry.deletions != null && <span className="text-muted-foreground"> </span>}
          {entry.deletions != null && <span className="text-danger">-{entry.deletions}</span>}
        </span>
      )}
      <span className="flex-1" />
      {entry.modifiedAt != null && (
        <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(entry.modifiedAt)}</span>
      )}
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

function RepoContextMenu({
  accounts,
  currentAccountId,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onRemoveRepo,
  onClose,
}: {
  accounts: { id: string; username: string; avatarUrl: string }[];
  currentAccountId: string | null;
  isFavorite: boolean;
  onSelect: (accountId: string | null) => void;
  onToggleFavorite: () => void;
  onRemoveRepo: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

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
      <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t("repo.linkAccount")}
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
            <span className="text-xs font-medium text-primary shrink-0">{t("repo.default")}</span>
          )}
        </button>
      ))}
      {currentAccountId && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(null);
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors text-left"
        >
          <CloudOff className="w-3.5 h-3.5 shrink-0" />
          {t("repo.unlinkAccount")}
        </button>
      )}
      <div className="border-t border-border my-1" />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
          onClose();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
      >
        <Star className={cn("w-3.5 h-3.5 shrink-0", isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
        {isFavorite ? t("repo.unfavorite") : t("repo.favorite")}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemoveRepo();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-danger hover:bg-accent transition-colors text-left"
      >
        <Trash2 className="w-3.5 h-3.5 shrink-0" />
        {t("repo.removeFromList")}
      </button>
    </div>
  );
}

function RepoListView({
  onSelectRepo,
}: {
  onSelectRepo: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const repos = useRepositoryStore((s) => s.repos);
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const removeRepo = useRepositoryStore((s) => s.removeRepo);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const updateRepoAccount = useRepositoryStore((s) => s.updateRepoAccount);
  const repoVisibility = useRepositoryStore((s) => s.repoVisibility);
  const ownerTypes = useRepositoryStore((s) => s.ownerTypes);
  const accounts = useAccountStore((s) => s.accounts);
  const [accountPickerRepo, setAccountPickerRepo] = useState<string | null>(null);

  const repoPermissions = useRepositoryStore((s) => s.repoPermissions);
  const setRepoPermission = useRepositoryStore((s) => s.setRepoPermission);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const addToast = useToastStore((s) => s.addToast);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showAccountSelectDialog, setShowAccountSelectDialog] = useState(false);
  const [pendingLocalRepo, setPendingLocalRepo] = useState<{ path: string; repoInfo: RepoInfo } | null>(null);
  const [validatingRepo, setValidatingRepo] = useState<string | null>(null);
  const collapsedGroups = useRepositoryStore((s) => s.collapsedGroups);
  const toggleGroupCollapsed = useRepositoryStore((s) => s.toggleGroupCollapsed);
  const favoriteRepos = useRepositoryStore((s) => s.favoriteRepos);
  const toggleFavorite = useRepositoryStore((s) => s.toggleFavorite);

  const handleClone = useCallback(async (params: { url: string; localPath: string; accountId: string | null }) => {
    const repoInfo = await cloneRepository(params.url, params.localPath, params.accountId ?? undefined);
    const repoWithAccount = params.accountId ? { ...repoInfo, accountId: params.accountId } : repoInfo;
    addRepo(repoWithAccount);
    onSelectRepo(repoInfo.path);
    setShowCloneDialog(false);
    addToast(t("clone.success"), "success");
  }, [addRepo, onSelectRepo, addToast, t]);

  const handleAddLocal = useCallback(async () => {
    setAddMenuOpen(false);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const dirPath = typeof selected === "string" ? selected : selected;
      const repoInfo = await addLocalRepository(dirPath);

      if (accounts.length >= 2) {
        setPendingLocalRepo({ path: dirPath, repoInfo });
        setShowAccountSelectDialog(true);
      } else {
        const accountId = accounts.length === 1 ? accounts[0].id : null;
        addRepo({ ...repoInfo, accountId });
        onSelectRepo(repoInfo.path);
      }
    } catch (err) {
      addToast(t("repo.failedToAdd", { error: getErrorMessage(err) }), "error");
    }
  }, [accounts, addRepo, onSelectRepo, addToast]);

  const handleAccountSelectForRepo = useCallback((accountId: string | null) => {
    if (pendingLocalRepo) {
      addRepo({ ...pendingLocalRepo.repoInfo, accountId });
      onSelectRepo(pendingLocalRepo.repoInfo.path);
    }
    setShowAccountSelectDialog(false);
    setPendingLocalRepo(null);
  }, [pendingLocalRepo, addRepo, onSelectRepo]);

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
  const favRepos = filtered.filter((r) => favoriteRepos.includes(r.path));
  const nonFavFiltered = filtered.filter((r) => !favoriteRepos.includes(r.path));
  const ownerGroups = groupReposByOwner(nonFavFiltered, accounts);

  const groups: GroupedRepos[] = favRepos.length > 0
    ? [{ label: t("repo.favorites"), repos: favRepos }, ...ownerGroups]
    : ownerGroups;

  // Fetch GitHub visibility for repos with remotes + linked accounts
  useEffect(() => {
    const state = useRepositoryStore.getState();
    for (const repo of repos) {
      const hasRemote = repo.remotes.length > 0;
      if (hasRemote && repo.accountId && !state.repoVisibility[repo.path]) {
        getRepoVisibility(repo.path, repo.accountId)
          .then((v) => {
            useRepositoryStore.getState().setRepoVisibility(repo.path, v);
          })
          .catch((err) => {
            console.warn(`[visibility] ${repo.name}:`, err);
          });
      }
    }
  }, [repos]);

  // Fetch owner type (org vs user) for each group label
  useEffect(() => {
    const state = useRepositoryStore.getState();
    // Find any accountId to use as auth
    const anyAccountId = accounts[0]?.id;
    if (!anyAccountId) return;

    for (const group of groups) {
      if (group.label === "Local" || state.ownerTypes[group.label]) continue;
      getOwnerType(group.label, anyAccountId)
        .then((res) => {
          useRepositoryStore.getState().setOwnerType(group.label, res.ownerType);
        })
        .catch((err) => {
          console.warn(`[ownerType] ${group.label}:`, err);
        });
    }
  }, [groups, accounts]);

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Filter + Add */}
      <div className="flex items-center gap-2 p-2 min-w-0">
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-card border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder={t("common.filter")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="relative shrink-0" ref={addRef}>
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent transition-colors"
            title={t("repo.addRepository")}
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
                {t("repo.addLocal")}
              </button>
              <button
                onClick={() => { setAddMenuOpen(false); setShowCloneDialog(true); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left whitespace-nowrap"
              >
                <GitFork className="w-4 h-4 text-muted-foreground shrink-0" />
                {t("repo.cloneRepo")}
              </button>
              <button
                onClick={() => setAddMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left whitespace-nowrap"
              >
                <FolderPlus className="w-4 h-4 text-muted-foreground shrink-0" />
                {t("repo.createNew")}
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
              {repos.length === 0 ? t("repo.noRepos") : t("repo.noMatches")}
            </p>
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.label} className={cn(groupIndex > 0 && "mt-3")}>
              {/* Group header */}
              <button
                onClick={() => toggleGroupCollapsed(group.label)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded-md transition-colors"
              >
                <ChevronDown className={cn(
                  "w-3 h-3 text-muted-foreground shrink-0 transition-transform",
                  collapsedGroups.includes(group.label) && "-rotate-90",
                )} />
                {(() => {
                  if (group.label === t("repo.favorites")) {
                    return <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />;
                  }
                  if (group.label === "Local") {
                    return <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                  }
                  const ot = ownerTypes[group.label];
                  if (ot === "Organization") {
                    return <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                  }
                  if (ot === "User") {
                    return <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                  }
                  return <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                })()}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate text-left">
                  {group.label}
                </span>
                <span className="text-xs text-muted-foreground/60 tabular-nums">
                  {group.repos.length}
                </span>
              </button>
              {/* Repo items — indented under group header */}
              {!collapsedGroups.includes(group.label) && <div className="flex flex-col gap-0.5 ml-3 pl-3 border-l border-border/50">
                {group.repos.map((repo) => {
                  const isActive = repo.path === activeRepo?.path;
                  const linkedAccount = repo.accountId
                    ? accounts.find((a) => a.id === repo.accountId)
                    : null;
                  const isPickerOpen = accountPickerRepo === repo.path;
                  const hasRemote = repo.remotes.length > 0;
                  const visibility = repoVisibility[repo.path];
                  const permission = repoPermissions[repo.path];
                  const isValidating = validatingRepo === repo.path;
                  const isFavGroup = group.label === t("repo.favorites");
                  const repoOwner = isFavGroup
                    ? (() => {
                        const origin = repo.remotes.find((r) => r.name === "origin");
                        return origin ? extractOwnerFromRemoteUrl(origin.url) : null;
                      })()
                    : null;
                  // Icon: Lock=private, GitFork=fork, Globe=public, HardDrive=local
                  const RepoIcon = !hasRemote
                    ? HardDrive
                    : visibility?.isPrivate
                      ? Lock
                      : visibility?.isFork
                        ? GitFork
                        : Globe;
                  return (
                    <div key={repo.path} className="relative">
                      <button
                        onClick={() => onSelectRepo(repo.path)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors min-w-0 rounded-md",
                          isActive
                            ? "bg-primary/10 text-primary font-semibold"
                            : "hover:bg-accent",
                        )}
                      >
                        <div className={cn(
                          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                          isActive
                            ? "bg-primary/15"
                            : !hasRemote
                              ? "bg-muted"
                              : visibility?.isPrivate
                                ? "bg-amber-500/10"
                                : visibility?.isFork
                                  ? "bg-blue-500/10"
                                  : "bg-emerald-500/10",
                        )}>
                          <RepoIcon
                            className={cn(
                              "w-3.5 h-3.5",
                              isActive
                                ? "text-primary/70"
                                : !hasRemote
                                  ? "text-muted-foreground"
                                  : visibility?.isPrivate
                                    ? "text-amber-600 dark:text-amber-400"
                                    : visibility?.isFork
                                      ? "text-blue-600 dark:text-blue-400"
                                      : "text-emerald-600 dark:text-emerald-400",
                            )}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate leading-tight">
                            {repoOwner ? `${repoOwner}/${repo.name}` : repo.name}
                          </p>
                          {repo.currentBranch && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <GitBranch className={cn(
                                "w-3 h-3 shrink-0",
                                isActive ? "text-primary/50" : "text-muted-foreground/70",
                              )} />
                              <span className={cn(
                                "text-xs truncate leading-tight",
                                isActive ? "text-primary/50" : "text-muted-foreground/70",
                              )}>
                                {repo.currentBranch}
                              </span>
                            </div>
                          )}
                          {/* Permission warning */}
                          {isValidating && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Loader2 className="w-3 h-3 shrink-0 text-muted-foreground animate-spin" />
                              <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
                            </div>
                          )}
                          {!isValidating && permission && !permission.valid && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <ShieldX className={cn("w-3 h-3 shrink-0", isActive ? "text-red-500" : "text-danger")} />
                              <span className={cn("text-xs font-medium", isActive ? "text-red-500" : "text-danger")}>
                                {t("repo.accountNoAccess")}
                              </span>
                            </div>
                          )}
                          {!isValidating && permission && permission.valid && !permission.canPush && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <ShieldAlert className={cn("w-3 h-3 shrink-0", "text-amber-500")} />
                              <span className={cn("text-xs font-medium", "text-amber-500")}>
                                {t("repo.accountReadOnly")}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* State indicators + actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {repo.isDirty && (
                            <Circle
                              className={cn(
                                "w-2 h-2 fill-current shrink-0",
                                isActive ? "text-amber-300" : "text-amber-500",
                              )}
                            />
                          )}
                          {visibility?.isArchived && (
                            <Archive
                              className={cn(
                                "w-3.5 h-3.5 shrink-0",
                                isActive ? "text-primary/50" : "text-muted-foreground/60",
                              )}
                            />
                          )}
                          {hasRemote && !repo.accountId && (
                            <CloudOff
                              className={cn(
                                "w-3.5 h-3.5 shrink-0",
                                isActive ? "text-primary/40" : "text-muted-foreground/50",
                              )}
                            />
                          )}
                          {/* Account avatar (passive) */}
                          {linkedAccount && (
                            <div className="shrink-0 flex items-center" title={linkedAccount.username}>
                              <AccountAvatar account={linkedAccount} size="xs" />
                            </div>
                          )}
                          {/* Context menu trigger */}
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
                              "shrink-0 w-5 h-5 flex items-center justify-center rounded cursor-pointer transition-colors",
                              isActive
                                ? "text-primary/60 hover:text-primary"
                                : "text-muted-foreground/50 hover:text-foreground hover:bg-accent",
                            )}
                          >
                            <EllipsisVertical className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </button>
                      {/* Context menu dropdown */}
                      {isPickerOpen && (
                        <RepoContextMenu
                          accounts={accounts}
                          currentAccountId={repo.accountId}
                          isFavorite={favoriteRepos.includes(repo.path)}
                          onToggleFavorite={() => toggleFavorite(repo.path)}
                          onSelect={async (accountId: string | null) => {
                            updateRepoAccount(repo.path, accountId);
                            setAccountPickerRepo(null);
                            if (accountId) {
                              setValidatingRepo(repo.path);
                              try {
                                const result = await validateToken(accountId, repo.path);
                                setRepoPermission(repo.path, { valid: result.valid, canPush: result.canPush, reason: result.reason });
                              } catch {
                                // validation failure is non-critical
                              } finally {
                                setValidatingRepo(null);
                              }
                            } else {
                              setRepoPermission(repo.path, null);
                            }
                          }}
                          onRemoveRepo={() => {
                            setAccountPickerRepo(null);
                            removeRepo(repo.path);
                          }}
                          onClose={() => setAccountPickerRepo(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>}
            </div>
          ))
        )}
      </div>
      {showCloneDialog && (
        <CloneDialog
          accounts={accounts}
          selectedAccountId={activeAccountId}
          onAccountChange={setActiveAccount}
          onClone={handleClone}
          onClose={() => setShowCloneDialog(false)}
        />
      )}
      {showAccountSelectDialog && (
        <AccountSelectDialog
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSelect={handleAccountSelectForRepo}
          onClose={() => handleAccountSelectForRepo(null)}
        />
      )}
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
  const { t } = useTranslation();
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
  const [commitError, setCommitError] = useState<string | null>(null);

  const handleOpenInEditor = async (filePath: string) => {
    if (!activeRepoPath) return;
    try {
      await openInEditor(activeRepoPath, filePath);
    } catch (err) {
      const msg = getErrorMessage(err);
      if (msg.includes("No default editor") || msg.includes("Unknown editor")) {
        addToast(t("settings.editorNotSet"), "warning");
      } else {
        addToast(t("error.generic"), "error");
      }
    }
  };

  const stagedFiles = statusEntries.filter((e) => e.staged);
  const unstagedFiles = statusEntries.filter((e) => !e.staged);

  const stagedGroups = useMemo(() => groupFilesByDirectory(stagedFiles), [stagedFiles]);
  const unstagedGroups = useMemo(() => groupFilesByDirectory(unstagedFiles), [unstagedFiles]);

  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const toggleDirCollapse = useCallback((key: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleStageAll = async () => {
    if (!activeRepoPath || unstagedFiles.length === 0) return;
    try {
      await stageFiles(activeRepoPath, unstagedFiles.map((e) => e.path));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]);
    } catch (err) {
      addToast(t("commit.stageFailed", { error: getErrorMessage(err) }), "error");
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
      addToast(t("commit.unstageFailed", { error: getErrorMessage(err) }), "error");
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
      setCommitError(getErrorMessage(err));
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
            <p className="text-sm">{t("changes.noChanges")}</p>
          </div>
        ) : (
          <>
            {/* Staged Changes header */}
            {stagedFiles.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b border-border sticky top-0 z-10">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={true}
                  onChange={handleUnstageAll}
                />
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex-1">
                  {t("commit.stagedChanges")}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{stagedFiles.length}</span>
              </div>
            )}
            {/* Staged file entries (grouped by directory) */}
            {stagedGroups.map((group) => {
              const dirKey = `staged:${group.directory}`;
              const isCollapsed = collapsedDirs.has(dirKey);
              return (
                <div key={dirKey}>
                  {stagedGroups.length > 1 && (
                    <div
                      onClick={() => toggleDirCollapse(dirKey)}
                      className="flex items-center gap-1.5 pl-6 pr-3 py-1 border-b border-border/50 cursor-pointer select-none hover:bg-accent/50 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-[11px] font-medium text-muted-foreground flex-1 truncate">
                        {group.directory || t("changes.rootFiles")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">{group.files.length}</span>
                    </div>
                  )}
                  {!isCollapsed && group.files.map((entry) => (
                    <FileEntry
                      key={`${entry.path}-staged`}
                      entry={entry}
                      isSelected={selectedFile === entry.path}
                      onClick={() => onSelectFile(entry.path, entry.staged)}
                      onDoubleClick={() => handleOpenInEditor(entry.path)}
                      onToggleStage={async () => {
                        if (!activeRepoPath) return;
                        try {
                          await unstageFiles(activeRepoPath, [entry.path]);
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ["status"] }),
                            queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
                          ]);
                        } catch (err) {
                          addToast(t("commit.unstageFailed", { error: getErrorMessage(err) }), "error");
                        }
                      }}
                    />
                  ))}
                </div>
              );
            })}

            {/* Changes header */}
            {unstagedFiles.length > 0 && (
              <div className={cn(
                "flex items-center gap-2 px-3 py-2 bg-muted border-b border-border sticky z-10",
                stagedFiles.length > 0 ? "top-[33px] border-t border-t-border" : "top-0",
              )}>
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                  checked={false}
                  onChange={handleStageAll}
                />
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex-1">
                  {t("commit.unstaged")}
                </span>
                <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{unstagedFiles.length}</span>
              </div>
            )}
            {/* Unstaged file entries (grouped by directory) */}
            {unstagedGroups.map((group) => {
              const dirKey = `unstaged:${group.directory}`;
              const isCollapsed = collapsedDirs.has(dirKey);
              return (
                <div key={dirKey}>
                  {unstagedGroups.length > 1 && (
                    <div
                      onClick={() => toggleDirCollapse(dirKey)}
                      className="flex items-center gap-1.5 pl-6 pr-3 py-1 border-b border-border/50 cursor-pointer select-none hover:bg-accent/50 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-[11px] font-medium text-muted-foreground flex-1 truncate">
                        {group.directory || t("changes.rootFiles")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">{group.files.length}</span>
                    </div>
                  )}
                  {!isCollapsed && group.files.map((entry) => (
                    <FileEntry
                      key={`${entry.path}-unstaged`}
                      entry={entry}
                      isSelected={selectedFile === entry.path}
                      onClick={() => onSelectFile(entry.path, entry.staged)}
                      onDoubleClick={() => handleOpenInEditor(entry.path)}
                      onToggleStage={async () => {
                        if (!activeRepoPath) return;
                        try {
                          await stageFiles(activeRepoPath, [entry.path]);
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ["status"] }),
                            queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
                          ]);
                        } catch (err) {
                          addToast(t("commit.stageFailed", { error: getErrorMessage(err) }), "error");
                        }
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Commit panel */}
      <div className="border-t border-border p-3 flex flex-col gap-2">
        <input
          type="text"
          placeholder={t("commit.summary")}
          value={commitSummary}
          onChange={(e) => setCommitSummary(e.target.value)}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md border border-border",
            "bg-card outline-none",
            "focus:border-primary transition-colors",
          )}
        />
        <textarea
          placeholder={t("commit.description")}
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
            <span className="text-xs text-muted-foreground truncate">
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
          {isCommitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("commit.committing")}
            </span>
          ) : (
            t("commit.submit", { branch: currentBranch ?? "main" })
          )}
        </button>
        {commitError && (
          <CommitErrorDialog
            message={commitError}
            onClose={() => setCommitError(null)}
          />
        )}
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
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const { data: commits = [], isLoading } = useCommitHistory(activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: githubAvatarMap = {} } = useCommitAvatars(activeRepoPath);
  const compareBranch = useUIStore((s) => s.compareBranch);
  const setCompareBranch = useUIStore((s) => s.setCompareBranch);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const headBranch = branches.find((b) => b.isHead);
  const currentBranchName = headBranch?.name ?? null;
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const { data: comparisonData } = useBranchComparison(
    activeRepoPath,
    currentBranchName,
    compareBranch,
  );

  // 연동된 GitHub 계정의 이메일 → avatarUrl 매핑
  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("history.loadingHistory")}</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("history.noCommits")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background">
      {/* Branch compare selector */}
      {branches.length > 1 && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <BranchCompareSelector
            branches={branches}
            currentBranch={currentBranchName}
            compareBranch={compareBranch}
            onSelect={setCompareBranch}
          />
        </div>
      )}

      {/* Compare view or normal commit list */}
      {compareBranch && activeRepoPath && currentBranchName ? (
        <>
          <BranchCompareView
            repoPath={activeRepoPath}
            baseBranch={currentBranchName}
            compareBranch={compareBranch}
            selectedCommitId={selectedCommitId}
            onSelectCommit={onSelectCommit}
          />
          <MergeActionPanel
            repoPath={activeRepoPath}
            compareBranch={compareBranch}
            currentBranch={currentBranchName}
            behindCount={comparisonData?.behindCount ?? 0}
            isDirty={statusEntries.length > 0}
          />
        </>
      ) : (
      <div className="flex-1 overflow-y-auto">
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
                ? "bg-primary/10 text-primary font-semibold"
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
                          ? "bg-primary/20 text-primary"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {(commit.author.name ?? "?")[0].toUpperCase()}
                    </div>
                  );
                })()}
                <span className={cn("text-xs truncate", isActive ? "text-primary/70" : "text-muted-foreground")}>
                  {commit.author.name}
                </span>
                <span className={cn("text-xs shrink-0 leading-none", isActive ? "text-primary/50" : "text-muted-foreground")}>
                  •
                </span>
                <span className={cn("text-xs shrink-0", isActive ? "text-primary/70" : "text-muted-foreground")}>
                  {formatRelativeTime(commit.timestamp)}
                </span>
              </div>
            </div>
            {isUnpushed && (
              <div
                className={cn(
                  "shrink-0 self-center flex items-center justify-center w-5 h-5 rounded-full",
                  isActive
                    ? "bg-primary/20"
                    : "bg-primary/10",
                )}
              >
                <ArrowUp
                  strokeWidth={3}
                  className={cn(
                    "w-3 h-3",
                    isActive ? "text-primary" : "text-primary",
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
      </div>
      )}
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
  const { t } = useTranslation();
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const repoVisibility = useRepositoryStore((s) => s.repoVisibility);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const changesCount = statusEntries.length;
  const queryClient = useQueryClient();
  const [isFetching, setIsFetching] = useState(false);
  const [repoMenuPos, setRepoMenuPos] = useState<{ x: number; y: number } | null>(null);
  const { data: settingsData = null } = useSettings();
  const removeRepo = useRepositoryStore((s) => s.removeRepo);

  const hasRemote = activeRepo ? activeRepo.remotes.length > 0 : false;
  const activeVisibility = activeRepoPath ? repoVisibility[activeRepoPath] : undefined;
  const RepoHeaderIcon = !activeRepo
    ? GitFork
    : !hasRemote
      ? HardDrive
      : activeVisibility?.isPrivate
        ? Lock
        : activeVisibility?.isFork
          ? GitFork
          : Globe;

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
        onContextMenu={(e) => {
          if (activeRepo) {
            e.preventDefault();
            setRepoMenuPos({ x: e.clientX, y: e.clientY });
          }
        }}
        className="flex items-center gap-2 px-4 h-[52px] shrink-0 border-b border-border hover:bg-accent transition-colors text-left"
      >
        <RepoHeaderIcon className="w-4 h-4 shrink-0 opacity-50" />
        <div className="flex-1 min-w-0" data-tauri-drag-region>
          <p className="text-xs text-muted-foreground leading-tight">{t("repo.currentRepo")}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">
              {activeRepo?.name ?? t("repo.selectRepo")}
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
      {repoMenuPos && activeRepo && (
        <RepoHeaderContextMenu
          repo={activeRepo}
          settings={settingsData}
          position={repoMenuPos}
          onRemove={() => {
            removeRepo(activeRepo.path);
            setRepoMenuPos(null);
          }}
          onClose={() => setRepoMenuPos(null)}
        />
      )}

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
                  "relative flex-1 flex items-center justify-center gap-1.5 px-3 h-[35px] text-sm font-medium transition-colors",
                  activeTab === tab
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{tab === "changes" ? t("changes.title") : t("history.title")}</span>
                {tab === "changes" && changesCount > 0 && (
                  <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded-full leading-none">
                    {changesCount}
                  </span>
                )}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
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
