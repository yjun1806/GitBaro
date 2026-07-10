import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Search,
  FolderOpen,
  GitFork,
  GitBranch,
  FolderPlus,
  Circle,
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
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { addLocalRepository, cloneRepository, getRepoVisibility, getOwnerType, validateToken } from "@/api/commands";
import { CloneDialog } from "@/components/repository/CloneDialog";
import { AccountSelectDialog } from "@/components/account/AccountSelectDialog";
import { cn, getErrorMessage } from "@/lib/utils";
import { extractOwnerFromRemoteUrl, groupReposByOwner, type GroupedRepos } from "@/lib/group-repos";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useToastStore } from "@/stores/toast";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { RepoSyncIndicator } from "@/components/repository/RepoSyncIndicator";
import { useRepoSyncStatuses } from "@/api/queries";
import type { GitHubAccount, RepoInfo } from "@/types";

/* ─── RepoContextMenu ─── */

function RepoContextMenu({
  accounts,
  currentAccountId,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onRemoveRepo,
  onClose,
}: {
  accounts: GitHubAccount[];
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
          <AccountAvatar account={account} size="xs" />
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
        <Star className={cn("w-3.5 h-3.5 shrink-0", isFavorite ? "fill-warning text-warning" : "text-muted-foreground")} />
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

/* ─── RepoListView ─── */

export interface RepoListViewProps {
  onSelectRepo: (path: string) => void;
}

export function RepoListView({ onSelectRepo }: RepoListViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const repos = useRepositoryStore((s) => s.repos);
  const repoPaths = useMemo(() => repos.map((r) => r.path), [repos]);
  const { data: syncMap } = useRepoSyncStatuses(repoPaths);
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
  }, [accounts, addRepo, onSelectRepo, addToast, t]);

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

  // Flat list of visible repos for keyboard navigation
  const flatItems = useMemo(() => {
    const result: RepoInfo[] = [];
    for (const group of groups) {
      if (!collapsedGroups.includes(group.label)) {
        for (const repo of group.repos) {
          result.push(repo);
        }
      }
    }
    return result;
  }, [groups, collapsedGroups]);

  const selectedRepoIdx = flatItems.findIndex((r) => r.path === activeRepo?.path);

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: flatItems,
    onSelect: (repo) => onSelectRepo(repo.path),
    selectedIndex: selectedRepoIdx,
  });

  useEffect(() => {
    const state = useRepositoryStore.getState();
    for (const repo of repos) {
      const hasRemote = repo.remotes.length > 0;
      if (hasRemote && repo.accountId && !state.repoVisibility[repo.path]) {
        getRepoVisibility(repo.path, repo.accountId)
          .then((v) => {
            useRepositoryStore.getState().setRepoVisibility(repo.path, v);
          })
          .catch(() => {
            // visibility fetch is non-critical
          });
      }
    }
  }, [repos]);

  useEffect(() => {
    const state = useRepositoryStore.getState();
    const anyAccountId = accounts[0]?.id;
    if (!anyAccountId) return;

    for (const group of groups) {
      if (group.label === "Local" || state.ownerTypes[group.label]) continue;
      getOwnerType(group.label, anyAccountId)
        .then((res) => {
          useRepositoryStore.getState().setOwnerType(group.label, res.ownerType);
        })
        .catch(() => {
          // ownerType fetch is non-critical
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1" {...containerProps}>
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
                    return <Star className="w-3.5 h-3.5 text-warning fill-warning shrink-0" />;
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
              {!collapsedGroups.includes(group.label) && (
                <div className="flex flex-col gap-0.5 ml-3 pl-3 border-l border-border/50">
                  {group.repos.map((repo) => {
                    const navIdx = flatItems.indexOf(repo);
                    const isActive = repo.path === activeRepo?.path;
                    const linkedAccount = repo.accountId
                      ? accounts.find((a) => a.id === repo.accountId)
                      : null;
                    const isPickerOpen = accountPickerRepo === repo.path;
                    const hasRemote = repo.remotes.length > 0;
                    // 신선한 dirty 값(전체 레포 배치 조회) 우선, 없으면 스토어 값
                    const isDirty = syncMap?.[repo.path]?.isDirty ?? repo.isDirty;
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
                          ref={navIdx >= 0 ? itemRef(navIdx) : undefined}
                          onClick={() => onSelectRepo(repo.path)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors min-w-0 rounded-md",
                            isActive
                              ? "bg-primary/10 text-primary font-semibold"
                              : !isActive && activeIndex === navIdx && navIdx >= 0
                                ? "bg-accent ring-1 ring-primary/30"
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
                                  ? "bg-warning/10"
                                  : visibility?.isFork
                                    ? "bg-info/10"
                                    : "bg-success/10",
                          )}>
                            <RepoIcon
                              className={cn(
                                "w-3.5 h-3.5",
                                isActive
                                  ? "text-primary/70"
                                  : !hasRemote
                                    ? "text-muted-foreground"
                                    : visibility?.isPrivate
                                      ? "text-warning"
                                      : visibility?.isFork
                                        ? "text-info"
                                        : "text-success",
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
                                <ShieldX className={cn("w-3 h-3 shrink-0", "text-danger")} />
                                <span className={cn("text-xs font-medium", "text-danger")}>
                                  {t("repo.accountNoAccess")}
                                </span>
                              </div>
                            )}
                            {!isValidating && permission && permission.valid && !permission.canPush && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <ShieldAlert className={cn("w-3 h-3 shrink-0", "text-warning")} />
                                <span className={cn("text-xs font-medium", "text-warning")}>
                                  {t("repo.accountReadOnly")}
                                </span>
                              </div>
                            )}
                          </div>
                          {/* State indicators + actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            <RepoSyncIndicator status={syncMap?.[repo.path]} variant="badge" />
                            {isDirty && (
                              <Circle
                                className={cn(
                                  "w-2 h-2 fill-current shrink-0",
                                  isActive ? "text-warning/70" : "text-warning",
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
                </div>
              )}
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
